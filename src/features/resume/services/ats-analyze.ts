import { z } from "zod"

import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import { logger } from "@/shared/lib/logger"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"
import { serializeSections } from "../lib/serialize-sections"
import { checkParseCompatibility } from "./ats-parse-check"
import type { Section } from "../hooks/use-resume-store"

export { serializeSections }

const log = logger("ats-analyze")

// ─── Zod schema for ATS analysis structured output ──────────────────────────

const atsAnalysisSchema = z.object({
  overallScore: z.number().min(0).max(100),
  scores: z.object({
    formatting: z.number().min(0).max(100),
    keywords: z.number().min(0).max(100),
    impact: z.number().min(0).max(100),
    completeness: z.number().min(0).max(100),
    readability: z.number().min(0).max(100),
  }),
  issues: z.array(
    z.object({
      severity: z.enum(["critical", "warning", "info"]),
      category: z.string(),
      message: z.string(),
      section: z.string(),
      suggestion: z.string(),
    })
  ),
  suggestions: z.array(
    z.object({
      category: z.string(),
      title: z.string(),
      description: z.string(),
      priority: z.enum(["high", "medium", "low"]),
    })
  ),
  missingKeywords: z.array(z.string()).describe(
    "Keywords from the job description that are not present in the resume. Empty array if no job description provided."
  ),
})

/**
 * Which question the analysis answers:
 * - `job-match` — how well does this resume match one specific job description?
 * - `quality` — is this a strong resume, independent of any job? Used for a
 *   Master Resume, which by definition has no job target.
 */
export type AnalysisMode = "quality" | "job-match"

/**
 * The per-category scores as callers see them. `keywords` is `null` in quality
 * mode: with no job description there is nothing to match against, so the
 * model's placeholder number is replaced rather than stored as if it meant
 * something.
 */
export type ATSSubScores = Omit<
  z.infer<typeof atsAnalysisSchema>["scores"],
  "keywords"
> & {
  keywords: number | null
}

export type ATSAnalysisResult = Omit<
  z.infer<typeof atsAnalysisSchema>,
  "scores"
> & {
  mode: AnalysisMode
  scores: ATSSubScores
}

// ─── Main ATS analysis function ─────────────────────────────────────────────

const MAX_RESUME_TEXT_LENGTH = 6000

/**
 * The weighting the system prompt documents. Models routinely emit an
 * `overallScore` that does not match it, so the value is recomputed here and
 * the model's own number is discarded.
 */
export const ATS_SCORE_WEIGHTS = {
  keywords: 0.3,
  impact: 0.3,
  formatting: 0.2,
  completeness: 0.1,
  readability: 0.1,
} as const

/**
 * Quality mode has no job description, so there is nothing to match keywords
 * against — `scores.keywords` is meaningless there and carries no weight. The
 * 30% it holds in job-match is redistributed to the job-independent signals.
 */
export const QUALITY_SCORE_WEIGHTS = {
  impact: 0.35,
  readability: 0.25,
  formatting: 0.2,
  completeness: 0.2,
} as const

/** Weighted average of the sub-scores, rounded and clamped to 0-100. */
export function computeOverallScore(
  scores: ATSAnalysisResult["scores"],
  mode: AnalysisMode = "job-match"
): number {
  const weighted =
    mode === "quality"
      ? scores.impact * QUALITY_SCORE_WEIGHTS.impact +
        scores.readability * QUALITY_SCORE_WEIGHTS.readability +
        scores.formatting * QUALITY_SCORE_WEIGHTS.formatting +
        scores.completeness * QUALITY_SCORE_WEIGHTS.completeness
      : // job-match always carries a numeric keyword score; the fallback only
        // keeps the arithmetic finite if a quality-mode `null` reaches here.
        (scores.keywords ?? 0) * ATS_SCORE_WEIGHTS.keywords +
        scores.impact * ATS_SCORE_WEIGHTS.impact +
        scores.formatting * ATS_SCORE_WEIGHTS.formatting +
        scores.completeness * ATS_SCORE_WEIGHTS.completeness +
        scores.readability * ATS_SCORE_WEIGHTS.readability
  return Math.min(100, Math.max(0, Math.round(weighted)))
}

export async function analyzeResumeATS(
  sections: Section[],
  options: {
    targetRole?: string | null
    jobDescription?: string | null
    /**
     * Which question to answer. Callers pass this explicitly — `job-match`
     * requires a non-empty `jobDescription` and throws without one.
     */
    mode: AnalysisMode
    /** Owner of the request, recorded with the call's token usage. */
    userId: string
  }
): Promise<ATSAnalysisResult> {
  const mode = options.mode
  const hasJobDescription = !!options.jobDescription?.trim()
  if (mode === "job-match" && !hasJobDescription) {
    throw new Error("job-match analysis requires a job description")
  }

  const resumeText = serializeSections(sections).slice(0, MAX_RESUME_TEXT_LENGTH)

  const promptParts = [`Resume:\n${fenceUntrusted("RESUME", resumeText)}`]

  if (options.targetRole) {
    promptParts.push(`Target role: ${options.targetRole}`)
  }

  if (mode === "job-match" && options.jobDescription) {
    // Capped like the resume text above — the job description is caller-supplied
    // and must not be able to dominate the prompt.
    const jobDescription = options.jobDescription.slice(0, MAX_RESUME_TEXT_LENGTH)
    promptParts.push(
      `Job description to match against:\n${fenceUntrusted("JOB_DESCRIPTION", jobDescription)}`
    )
  }

  const { object } = await generateObjectTracked({
    schema: atsAnalysisSchema,
    tracking: {
      feature: AI_USAGE_FEATURES.RESUME_ATS_SCAN,
      surface: "app",
      userId: options.userId,
    },
    system: [
      "You are an expert ATS (Applicant Tracking System) analyst. Evaluate resumes for ATS compatibility and candidate quality.",
      "",
      "OUTPUT FORMAT: Respond with ONLY a valid JSON object using EXACTLY these camelCase field names — no uppercase keys, no extra fields, no markdown:",
      '{',
      '  "overallScore": 75,',
      '  "scores": { "formatting": 80, "keywords": 70, "impact": 75, "completeness": 90, "readability": 85 },',
      '  "issues": [{ "severity": "warning", "category": "Keywords", "message": "Missing patient scheduling", "section": "Skills", "suggestion": "Add patient scheduling to skills section" }],',
      '  "suggestions": [{ "category": "Keywords", "title": "Add missing skills", "description": "Include patient scheduling and care coordination", "priority": "high" }],',
      '  "missingKeywords": ["patient scheduling", "care coordination"]',
      '}',
      "",
      "severity must be one of: critical, warning, info. priority must be one of: high, medium, low.",
      "",
      UNTRUSTED_CONTENT_RULES,
      "",
      "CRITICAL FAIRNESS REQUIREMENTS — scores MUST NEVER depend on: candidate name, gender, school or university name, GPA or academic grades, city or location, or any personal demographic. Evaluate ONLY on: hard skills and credentials relevant to the target role (technical, clinical, instructional, trade, financial, or otherwise), the complexity and real-world impact of the work or projects described, work experience, certifications and licenses, and ATS formatting quality.",
      "",
      "Score each category 0-100 the way widely-deployed applicant tracking systems (Workday, Greenhouse, Lever, Taleo, iCIMS) and the recruiters reading their candidate view actually behave. Do NOT score like a human resume coach reading a PDF — score like a parser plus a recruiter skimming the parsed record.",
      "",
      mode === "quality"
        ? "NO TARGET JOB: this resume is being reviewed on its own merits, not against a job posting. There is no job description and none is coming. Do NOT penalize the resume for missing keywords, do NOT suggest adding keywords, and do NOT raise keyword issues or keyword suggestions. Return missingKeywords as an empty array. Set scores.keywords to 50 — that number is replaced with null before anything reads it and carries no weight in the overall score, so do not reason about it.\n\nInstead, diagnose what makes this a strong or weak resume for any employer, and prefer a concrete, actionable diagnosis over score commentary. Focus on:\n- IMPACT: bullets that state outcomes instead of duties, quantified results where the field produces figures, strong front-loaded action verbs, and bullets that are vague, duplicated across roles, or say nothing an employer can evaluate.\n- CLARITY AND CONCISION: long paragraph bullets, filler, buzzwords, and sentences that need re-reading.\n- CONSISTENCY: tense (past for prior roles, present for the current one), date formats, punctuation, capitalization, and bullet phrasing that drift between entries.\n- STRUCTURE AND COMPLETENESS: a missing or generic summary, thin or empty sections, missing dates or locations, missing contact channels, and sections a reader would expect for this career but cannot find.\n- READABILITY: scan-ability of the parsed record in a six-second read.\n\nNEVER invent achievements, employers, tools, credentials or numbers, and never assume a metric the resume does not state. If a bullet needs a metric it does not have, say so and ask the candidate to supply it (for example: \"add the team size or the percentage improvement if you have it\") rather than writing a number yourself."
        : "KEYWORDS: real ATSes do exact and near-exact token matching, not semantic understanding. Score against the job description's EXACT terminology: 'JavaScript' does not match 'JS', 'Registered Nurse' does not match 'RN', 'Certified Public Accountant' does not match 'CPA' unless both forms appear, and a plural or hyphenation difference is only a near match. Weight the job-title match heavily — a resume whose most recent role title (or summary headline) matches the JD's job title scores far higher than one that does not. Hard skills (tools, languages, platforms, certifications, licenses, credentials, methodologies, regulations and standards, equipment, domain nouns) count for much more than soft skills ('team player', 'communication'), which barely move the score. Keywords must appear in the resume body text to count; do not credit skills you merely infer. If no job description is provided, score against the target role's standard terminology instead, and be conservative. List every missing term in missingKeywords using the job description's EXACT phrasing, verbatim, not your paraphrase.",
      "",
      "FORMATTING: score only what survives plain-text extraction. Standard section headings that parsers field-map ('Work Experience' / 'Professional Experience' / 'Experience', 'Education', 'Skills', 'Certifications', 'Projects') score high; invented or decorative headings ('My Journey', 'What I Bring') fail field mapping and score low. Work history must read reverse-chronological with a parseable date on every entry ('Jan 2024 - Present', '01/2024 - 04/2026'); missing, ambiguous or inconsistent date formats are a heavy deduction because the parser drops the whole employment record. Contact details must be plain text at the top of the document, never inside a header/footer (most parsers discard those). Tables, multi-column layouts, text boxes, graphics, icons and images either scramble reading order or vanish entirely — deduct hard for any signal of them. Clean, single-level '-' bullets parse best.",
      "",
      "IMPACT: this is what the recruiter sees in the ATS candidate view during a roughly six-second scan, so front-loaded, quantified bullets win. Judge scope, responsibility and outcomes AGAINST THE NORMS OF THE CANDIDATE'S OWN FIELD — never against software-industry norms unless the target role is a software or technical one.",
      "- Work that is routine, low-responsibility or clearly practice/coursework for the field scores LOW (0-40); work carrying real responsibility, scale or measurable outcomes scores HIGH (60-100).",
      "- ONLY IF the resume evidently targets a software or technical career (judge from titles, skills and projects — never from the absence of links): tutorial projects (todo lists, calculators, basic CRUD apps, weather apps using public APIs) score LOW, while complex systems with real-world impact (full-stack apps with auth and databases, ML/AI applications, real-time systems, microservices, significant open source contributions) score HIGH; and software projects on such a resume score 15-20 points lower without a GitHub link or live demo URL.",
      "- For every other field, judge the equivalent evidence of scope and outcome: healthcare (patient loads, acuity, unit size, quality or readmission metrics, charge or preceptor duties), sales (quota attainment, revenue closed, pipeline, territory size), education (class sizes, test-score or graduation gains, curriculum built, students supported), trades and operations (safety records, uptime, throughput, crew size, jobs completed, compliance audits passed), finance and accounting (budgets or portfolios managed, cost savings, audit or close cycles, accuracy rates), hospitality and service (covers served, guest-satisfaction scores, staff supervised, revenue managed).",
      "- In every other field, judge project and portfolio evidence by that field's OWN norms — case studies, publications, licenses and certifications, client or patient outcomes, revenue, headcount, safety records — and NEVER deduct for a missing repository, demo or portfolio link: a missing link is not a defect for a nurse, teacher, salesperson, tradesperson, accountant or hospitality candidate, and portfolio links must not be expected there.",
      "- Quantified achievements (numbers, percentages, scale, dollar or time savings) raise the score; bullets that lead with the outcome and the number raise it most. A qualitative outcome still beats a bare duty when the field does not produce figures.",
      "- Bullets that only describe duties ('Responsible for...', 'Worked on...') instead of results score LOW.",
      "",
      "COMPLETENESS: score the knockout and screening signals a real ATS workflow keys on, because a missing field silently removes a candidate from filtered searches. Every experience and education entry needs a start AND end date (or an explicit 'Present'). Unexplained gaps of roughly six months or more between roles get flagged by recruiters reading the parsed timeline. Recognized working patterns are NOT unexplained gaps and must not be deducted for: contract, per-diem, PRN, travel nursing, locum, seasonal, adjunct, substitute, apprenticeship, deployment and other assignment-based work legitimately produce short, gapped or overlapping dated entries. Location must be present (city and state/country) — recruiters filter on it and the work-authorization/relocation question is answered here, not by the candidate's demographics. Both an email address and a phone number must be present: ATSes require both contact channels and a record missing one is often unreachable or auto-rejected. All essential sections must be present and filled (contact, summary, experience or projects, education, skills), and any link a bullet claims must actually appear.",
      "",
      "READABILITY: score for the recruiter's six-second scan of the parsed record. Bullets should be one to two lines, lead with a strong action verb, and stay under about 250 characters — long paragraph bullets get truncated or mangled in the ATS candidate view. Reward clear concise language, appropriate resume length, consistent tense (past for prior roles, present for the current one), and no jargon or acronym overload. The acronym deduction applies only to invented, internal-to-one-employer or unexplained shorthand: standard industry credentials, licenses and terms of art (RN, BSN, ACLS, PALS, CPA, GAAP, CDL, OSHA, HIPAA, PMP, IEP, CFA, SHRM-CP, ServSafe and their equivalents) are expected vocabulary and must NEVER be penalized. A dense wall of text scores low even if it parses cleanly.",
      "",
      mode === "quality"
        ? "The overall score is a weighted average: impact (35%) + readability (25%) + formatting (20%) + completeness (20%). scores.keywords is ignored entirely."
        : "The overall score is a weighted average: keywords (30%) + impact (30%) + formatting (20%) + completeness (10%) + readability (10%).",
      "",
      "Be specific and actionable. Every issue must name the exact section it applies to (use the section's own heading as it appears in the resume) and give a concrete fix.",
      "",
      mode === "quality"
        ? "Return an empty missingKeywords array — there is no job description to draw keywords from."
        : "If a job description is provided: identify important keywords, technologies, certifications, and qualifications from it that are missing from the resume and include them in missingKeywords. If no job description is provided, return an empty missingKeywords array.",
    ].join("\n"),
    prompt: promptParts.join("\n\n"),
  })

  // Deterministic parse-compatibility findings lead the list: they are certain
  // where the model's are judgement calls. Best-effort — a bug in the checker
  // must never cost the user their analysis.
  let parseIssues: ATSAnalysisResult["issues"] = []
  try {
    parseIssues = checkParseCompatibility(sections)
  } catch (error) {
    log.warn("parse compatibility check failed", { error })
  }

  // The model is told the weighting but does not reliably apply it — recompute
  // so the headline number always matches the sub-scores it is shown next to.
  return {
    ...object,
    mode,
    issues: [...parseIssues, ...object.issues],
    // Quality mode has no job description, so the model's keyword number is a
    // placeholder with no meaning. Nulled here so nothing downstream — and no
    // persisted row — can mistake it for a real sub-score.
    scores:
      mode === "quality"
        ? { ...object.scores, keywords: null }
        : object.scores,
    // There is nothing to match against in quality mode, so any keyword the
    // model volunteered would be its own invention about a job that does not
    // exist. Dropped regardless of what it returned.
    missingKeywords: mode === "quality" ? [] : object.missingKeywords,
    overallScore: computeOverallScore(object.scores, mode),
  }
}
