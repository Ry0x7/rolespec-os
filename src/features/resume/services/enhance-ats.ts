import { z } from "zod"

import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import type { GroundedKeywords } from "@/shared/lib/evidence-grounding"
import { HUMAN_VOICE_LEXICON } from "@/shared/lib/prompts/human-voice"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"
import { ATS_SCORE_WEIGHTS } from "./ats-analyze"
import { findMatchingSectionId } from "../lib/match-issue-section"
import type { Section } from "../hooks/use-resume-store"

// ─── Structured output ──────────────────────────────────────────────────────

/** Hard ceiling on how many suggestions (rewrites + removals) one run may propose. */
export const MAX_ENHANCE_SUGGESTIONS = 8

export const atsEnhanceSuggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        /** Must be one of the target ids supplied in the prompt. */
        targetId: z.string().min(1),
        /**
         * `remove` proposes dropping the bullet instead of rewriting it. A flat
         * enum plus a nullable `suggested` on purpose — providers handle a
         * discriminated union poorly in structured output, so the "suggested
         * present and non-empty iff rewrite" rule is enforced in the action's
         * post-processing rather than here.
         *
         * Nullable, NOT optional/defaulted: OpenAI's strict structured outputs
         * reject a schema whose `required` misses any property, and both
         * `.optional()` and `.default()` drop the key from `required`. A null
         * `action` still means "rewrite" — `normalizeSuggestions()` below
         * applies that default before the caller ever sees it.
         */
        action: z.enum(["rewrite", "remove"]).nullable(),
        suggested: z.string().nullable(),
        reason: z.string().min(1),
      })
    )
    .max(MAX_ENHANCE_SUGGESTIONS),
})

/** One suggestion after the wire nulls are normalised away. */
export interface ATSEnhanceSuggestion {
  targetId: string
  action: "rewrite" | "remove"
  /** Present for a rewrite, absent for a removal. */
  suggested?: string
  reason: string
}

export interface ATSEnhanceSuggestions {
  suggestions: ATSEnhanceSuggestion[]
}

/**
 * Turns the wire shape into the shape the caller has always seen: a missing
 * action is a rewrite, and a missing `suggested` is absent rather than null.
 */
function normalizeSuggestions(
  object: z.infer<typeof atsEnhanceSuggestionsSchema>
): ATSEnhanceSuggestions {
  return {
    suggestions: object.suggestions.map((suggestion) => ({
      targetId: suggestion.targetId,
      action: suggestion.action ?? "rewrite",
      ...(suggestion.suggested === null ? {} : { suggested: suggestion.suggested }),
      reason: suggestion.reason,
    })),
  }
}

/** Which resume field a target is — drives the length rules. */
export type EnhanceTargetField = "summary" | "bullet" | "skills"

export interface EnhanceTarget {
  targetId: string
  field: EnhanceTargetField
  text: string
  /** Human label for the prompt, e.g. "Experience — Acme / Senior Engineer". */
  label?: string
}

export interface ATSFindingIssue {
  severity: "critical" | "warning" | "info"
  category: string
  message: string
  section?: string
  suggestion?: string
}

export interface ATSFindingSuggestion {
  category: string
  title: string
  description: string
  priority: "high" | "medium" | "low"
}

/** The five category scores the ATS analysis produces, each 0-100. */
export interface ATSEnhanceScores {
  formatting: number
  /** `null` for a quality analysis — there is no keyword sub-score to show. */
  keywords: number | null
  impact: number
  completeness: number
  readability: number
}

export interface ATSEnhanceInput {
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
  targets: EnhanceTarget[]
  issues: ATSFindingIssue[]
  suggestions: ATSFindingSuggestion[]
  /** Latest weighted overall score, 0-100. Optional — older callers omit it. */
  overallScore?: number
  /** Latest per-category scores. Optional — older callers omit them. */
  scores?: ATSEnhanceScores
  /**
   * The analyzer's missing keywords, already partitioned against the
   * candidate's own text by `groundKeywords()`. The service never receives a
   * raw missing-keyword list any more: a requirement the resume cannot back is
   * a DO-NOT-CLAIM instruction here, not a suggestion to work in.
   */
  groundedKeywords?: GroundedKeywords
  jobDescription?: string
  targetRole?: string
  targetCompany?: string
  /**
   * Narrows the run to one resume section ("Fix with Enhance" on an ATS
   * issue). Requires `sections` so the id can be checked and issues matched.
   */
  focus?: EnhanceFocus
  /** The resume's sections — only read when `focus` is set. */
  sections?: readonly Pick<Section, "id" | "title" | "type">[]
}

/** One section a focused Enhance run is limited to, addressed by id. */
export interface EnhanceFocus {
  sectionId: string
}

/**
 * Applies a focus to the run's inputs: only targets inside the section (target
 * ids are `<sectionId>::...`), and only the issues that match that section —
 * or every issue when none do, so the model still has findings to act on.
 * Throws when the section id is blank or not one of the resume's sections.
 */
export function applyEnhanceFocus(
  focus: EnhanceFocus,
  sections: readonly Pick<Section, "id" | "title" | "type">[] | undefined,
  targets: EnhanceTarget[],
  issues: ATSFindingIssue[]
): { targets: EnhanceTarget[]; issues: ATSFindingIssue[] } {
  const sectionId = focus.sectionId.trim()
  if (!sectionId || !sections?.some((section) => section.id === sectionId)) {
    throw new Error("Enhance focus section is not part of this resume.")
  }
  const prefix = `${sectionId}::`
  const matchedIssues = issues.filter(
    (issue) => findMatchingSectionId(sections, issue.section) === sectionId
  )
  return {
    targets: targets.filter((target) => target.targetId.startsWith(prefix)),
    issues: matchedIssues.length > 0 ? matchedIssues : issues,
  }
}

// ─── Prompt caps ────────────────────────────────────────────────────────────

/** The editor caps the summary field at 500 characters. */
export const MAX_SUMMARY_LENGTH = 500
export const MAX_BULLET_LENGTH = 220
/** One skills category rendered as a comma-separated list. */
export const MAX_SKILLS_LENGTH = 600

const MAX_JOB_DESCRIPTION_LENGTH = 1500
/** Both targets are free-text fields; neither may grow into the prompt. */
const MAX_TARGET_LENGTH = 200
const MAX_MISSING_KEYWORDS = 20
const MAX_MISSING_KEYWORD_LENGTH = 60
const MAX_ATS_FINDINGS = 12

function bulletList(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n")
}

function capKeywords(keywords: readonly string[] | undefined): string[] {
  return (keywords ?? [])
    .map((keyword) => keyword?.trim())
    .filter((keyword): keyword is string => Boolean(keyword))
    .slice(0, MAX_MISSING_KEYWORDS)
    .map((keyword) => keyword.slice(0, MAX_MISSING_KEYWORD_LENGTH))
}

/** The score the rewrites are aiming the resume at. */
export const ATS_TARGET_SCORE = 95

/** Category order in the prompt: heaviest weight first. */
const SCORE_CATEGORY_ORDER = [
  "keywords",
  "impact",
  "formatting",
  "completeness",
  "readability",
] as const satisfies readonly (keyof ATSEnhanceScores)[]

/**
 * Renders the current ATS scores plus the real scoring weights, so the model can
 * spend its rewrites on the weakest heavily-weighted categories. Weights come
 * from `ATS_SCORE_WEIGHTS` so the prompt can never drift from the scorer.
 */
function formatScoreSection(scores: ATSEnhanceScores, overallScore?: number): string {
  const lines = [
    "Current ATS score for this resume — the rewrites are graded against it:",
  ]
  if (typeof overallScore === "number") {
    lines.push(`- Overall: ${overallScore}/100`)
  }
  for (const category of SCORE_CATEGORY_ORDER) {
    const value = scores[category]
    // A quality analysis has no keyword sub-score; omit the line rather than
    // showing the model a number that does not exist.
    if (value === null) continue
    lines.push(
      `- ${category}: ${value}/100 (weight ${Math.round(
        ATS_SCORE_WEIGHTS[category] * 100
      )}%)`
    )
  }
  lines.push(
    `The overall score is the weighted average of those categories. Identify the weakest categories that carry the heaviest weights — a point gained there moves the overall score the most — and prioritise rewrites that raise them. Aim to push the post-rewrite overall score to ${ATS_TARGET_SCORE}+ WITHOUT breaking the GROUNDING rule: never invent numbers, metrics or facts to chase a score. Grounding outranks the score every time; leave a category low rather than fabricate anything.`
  )
  return lines.join("\n")
}

// ─── Main generator ─────────────────────────────────────────────────────────

/**
 * Asks the model for a handful of targeted rewrites that address the latest ATS
 * analysis. Returns the raw (schema-valid) model output — the caller resolves
 * `targetId`s and enforces the length caps.
 */
export async function generateATSEnhanceSuggestions(
  input: ATSEnhanceInput
): Promise<ATSEnhanceSuggestions> {
  const promptParts: string[] = []

  const focused = input.focus
    ? applyEnhanceFocus(input.focus, input.sections, input.targets, input.issues)
    : { targets: input.targets, issues: input.issues }

  if (input.targetRole) {
    promptParts.push(`Target role: ${input.targetRole.slice(0, MAX_TARGET_LENGTH)}`)
  }
  if (input.targetCompany) {
    promptParts.push(`Target company: ${input.targetCompany.slice(0, MAX_TARGET_LENGTH)}`)
  }

  const jobDescription = input.jobDescription?.trim().slice(0, MAX_JOB_DESCRIPTION_LENGTH)
  if (jobDescription) {
    promptParts.push(
      `Target job description — tailor the wording toward the requirements, responsibilities and vocabulary it uses:\n${fenceUntrusted(
        "JOB_DESCRIPTION",
        jobDescription
      )}`
    )
  }

  if (input.scores) {
    promptParts.push(formatScoreSection(input.scores, input.overallScore))
  }

  const issues = focused.issues.slice(0, MAX_ATS_FINDINGS)
  if (issues.length > 0) {
    promptParts.push(
      `ATS issues found on this resume:\n${issues
        .map(
          (issue) =>
            `- [${issue.severity}/${issue.category}${issue.section ? ` @ ${issue.section}` : ""}] ${issue.message}${
              issue.suggestion ? ` (fix: ${issue.suggestion})` : ""
            }`
        )
        .join("\n")}`
    )
  }

  const atsSuggestions = input.suggestions.slice(0, MAX_ATS_FINDINGS)
  if (atsSuggestions.length > 0) {
    promptParts.push(
      `ATS improvement suggestions:\n${atsSuggestions
        .map((s) => `- [${s.priority}/${s.category}] ${s.title}: ${s.description}`)
        .join("\n")}`
    )
  }

  const supportedKeywords = capKeywords(input.groundedKeywords?.supported)
  const ambiguousKeywords = capKeywords(input.groundedKeywords?.ambiguous)
  const unsupportedKeywords = capKeywords(input.groundedKeywords?.unsupported)

  if (
    supportedKeywords.length > 0 ||
    ambiguousKeywords.length > 0 ||
    unsupportedKeywords.length > 0
  ) {
    const sections = [
      "ATS keywords the target job asks for, already checked against this candidate's own resume text. The classification is authoritative — do not second-guess it from the job description.",
    ]

    if (supportedKeywords.length > 0) {
      sections.push(
        `SUPPORTED (the resume backs these — surface them where they genuinely fit, without keyword-stuffing):\n${bulletList(
          supportedKeywords
        )}`
      )
    }

    if (ambiguousKeywords.length > 0) {
      sections.push(
        `NEEDS CONFIRMATION (only partial evidence). You may keep the related evidence the resume already contains, but you must NOT assert the requirement itself as the candidate's experience:\n${bulletList(
          ambiguousKeywords
        )}`
      )
    }

    if (unsupportedKeywords.length > 0) {
      sections.push(
        `DO NOT CLAIM (nothing in this resume supports them). These MUST NOT appear in any rewritten text in any form, however strongly the job description asks for them. Adding one is a false statement on a job application:\n${bulletList(
          unsupportedKeywords
        )}`
      )
    }

    promptParts.push(sections.join("\n\n"))
  }

  promptParts.push(
    `Enhanceable resume text. Each entry is "<targetId> | <field> | <label>" followed by its current text:\n${fenceUntrusted(
      "RESUME_TARGETS",
      focused.targets
        .map(
          (target) =>
            `${target.targetId} | ${target.field} | ${target.label ?? "—"}\n${target.text}`
        )
        .join("\n\n")
    )}`
  )

  const { object } = await generateObjectTracked({
    schema: atsEnhanceSuggestionsSchema,
    tracking: {
      feature: AI_USAGE_FEATURES.RESUME_ENHANCE,
      surface: "app",
      userId: input.userId,
    },
    system: [
      "You are an expert resume writer. You are given a resume's enhanceable text plus the findings of an ATS analysis of that same resume. Rewrite only the pieces of text where a rewrite would measurably address a finding.",
      "",
      UNTRUSTED_CONTENT_RULES,
      "",
      'OUTPUT FORMAT: Respond with ONLY a valid JSON object using EXACTLY this camelCase shape — no extra fields, no markdown: { "suggestions": [{ "targetId": "<one of the supplied target ids>", "action": "rewrite" | "remove", "suggested": "<the rewritten text, or null when action is remove>", "reason": "<why, referencing the ATS finding it addresses or why the bullet does not align>" }] }',
      "EVERY field above is required on every suggestion — never omit a key. Use null for `suggested` instead of leaving it out.",
      "",
      `Return AT MOST ${MAX_ENHANCE_SUGGESTIONS} suggestions in total (rewrites and removals combined), at most one per targetId, ordered by impact. Prefer the highest-severity findings. Do NOT invent target ids. Do NOT return a suggestion that is identical to the current text. If nothing needs changing, return an empty array.`,
      "",
      "Every `reason` field is one short sentence that names the ATS finding it addresses (e.g. the missing keyword, the weak-impact issue, the readability suggestion). No generic praise. The `reason` field is your justification to the user — it is NOT part of the rewritten text and must never be confused with the why-it-mattered clause that belongs inside a bullet.",
      'The `reason` is written for the resume owner: never quote or mention a target id, section id, item id or bullet index such as "b0" — refer to the bullet by its content instead.',
      "",
      "GROUNDING — THIS IS THE MOST IMPORTANT RULE: use ONLY facts present in the target text and context. NEVER invent specific numbers, percentages, dollar amounts, team sizes, dates, employers or technologies that the input does not contain. Quantify only where a figure is already given or plainly implied; otherwise phrase the impact without a number rather than guessing one.",
      "GROUNDING AND THE JOB DESCRIPTION: a requirement in the job description is evidence about the EMPLOYER, never about the candidate. A skill, technology, tool, certification or responsibility may only appear in a rewrite if the candidate's own text already shows it. Anything listed under DO NOT CLAIM is barred outright; leave the gap visible rather than filling it.",
      "",
      'REMOVAL: you may also propose dropping bloat. Use `action: "remove"` ONLY for bullet targets — their ids contain "::b" — and ONLY when the bullet is clearly irrelevant to the target role or job description: an unrelated duty, filler with no substance, or content already covered by another bullet. Set `suggested` to null for a removal, and make the `reason` name why that bullet does not align with the target role.',
      "REMOVAL GUARDRAILS: never propose removing a bullet that carries a keyword from the job description or the SUPPORTED list, and never one that carries a quantified result. Never propose so many removals that an experience item is left with fewer than 2 bullets. A removal must not regress ATS completeness — if dropping the bullet would strip the only evidence of a required skill, responsibility, date or scope, keep it. Prefer a rewrite over a removal whenever the content is salvageable; removal is the last resort for text that cannot be made relevant.",
      'REMOVAL SCOPE: removal applies to bullets only. NEVER use `action: "remove"` on a summary or skills target.',
      "",
      "STYLE: write every rewritten bullet in the Action–Result–Reason framework — open with the Action (a strong action verb plus what was done), then the Result (the outcome it produced), then the Reason (why it mattered: the purpose, relevance or business value). Start bullets with strong, varied action verbs. Plain professional English, active voice, no first-person pronouns in bullets, no buzzword filler such as 'results-driven professional' or 'synergy'. Use ATS-friendly wording: real skill, credential and tool names, no tables, no special characters beyond ordinary punctuation.",
      HUMAN_VOICE_LEXICON,
      "ARR AND GROUNDING: the Result clause obeys the grounding rule above — state the Result qualitatively when the source gives no figure; never invent numbers for it. The Reason clause must likewise come from the target text or the supplied context, never from assumption.",
      "",
      `SUMMARY TARGETS: 2-3 sentences, at most ${MAX_SUMMARY_LENGTH} characters.`,
      `BULLET TARGETS: ONE single-line bullet of at most ${MAX_BULLET_LENGTH} characters, written in the Action–Result–Reason framework. The complete bullet MUST fit inside ${MAX_BULLET_LENGTH} characters — if it will not, drop the Reason (why-it-mattered) clause and keep Action and Result; never drop the Result to keep the Reason. Do NOT prefix it with "-", "•" or any other bullet glyph.`,
      "SUMMARY AND SKILLS TARGETS are NOT bullets: do not apply the Action–Result–Reason framework to them.",
      `SKILLS TARGETS: return the SAME comma-separated list, in the same order, with relevant keywords from the SUPPORTED list appended at the end — at most ${MAX_SKILLS_LENGTH} characters. NEVER remove or rename an existing skill (the removal action above is for bullets only and must never be used here). Append ONLY from the SUPPORTED list: appending a skill is a claim of experience, so nothing from NEEDS CONFIRMATION or DO NOT CLAIM may be added here. No categories, no prose, no bullet glyphs — just the list.`,
    ].join("\n"),
    prompt: promptParts.join("\n\n"),
  })

  return normalizeSuggestions(object)
}
