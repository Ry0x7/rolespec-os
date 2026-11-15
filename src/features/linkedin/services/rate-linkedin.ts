import { z } from "zod"

import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import {
  ratingIssueSchema,
  ratingSuggestionsSchema,
  scoreSchema,
} from "@/shared/lib/rating/schemas"
import { PROFILE_RATING_MAX_TEXT_LENGTH } from "@/shared/lib/rating/constants"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"

// ─── Zod schema for LinkedIn rating structured output ───────────────────────

/** How the profile stacks up against strong candidates competing for the role. */
export const linkedinBenchmarkSchema = z.object({
  role: z.string(),
  percentile: scoreSchema,
  summary: z.string(),
  benchmarkScores: z.object({
    headline: scoreSchema,
    about: scoreSchema,
    experienceImpact: scoreSchema,
    skillsKeywords: scoreSchema,
    completeness: scoreSchema,
  }),
  advantages: z.array(z.string()),
  gaps: z.array(z.string()),
})

export const linkedinRatingSchema = z.object({
  overallScore: scoreSchema,
  scores: z.object({
    headline: scoreSchema,
    about: scoreSchema,
    experienceImpact: scoreSchema,
    skillsKeywords: scoreSchema,
    completeness: scoreSchema,
  }),
  issues: z.array(ratingIssueSchema),
  suggestions: ratingSuggestionsSchema,
  benchmark: linkedinBenchmarkSchema,
})

export type LinkedInBenchmark = z.infer<typeof linkedinBenchmarkSchema>
export type LinkedInRatingResult = z.infer<typeof linkedinRatingSchema>

/** Optional extra material the caller attached alongside the profile export. */
export interface LinkedInRatingContext {
  resumeText?: string
}

// ─── Main LinkedIn rating function ──────────────────────────────────────────

export async function analyzeLinkedIn(
  text: string,
  /** Owner of the request, recorded with the call's token usage. */
  userId: string,
  context?: LinkedInRatingContext
): Promise<LinkedInRatingResult> {
  const profileText = text.slice(0, PROFILE_RATING_MAX_TEXT_LENGTH)
  const resumeText = context?.resumeText?.trim()
  const hasExtraContext = Boolean(resumeText)

  const promptParts = [
    `LinkedIn profile text:\n${fenceUntrusted("LINKEDIN_PROFILE", profileText)}`,
  ]
  if (resumeText) {
    promptParts.push(
      `Candidate's resume (additional context):\n${fenceUntrusted("RESUME", resumeText)}`
    )
  }

  const { object } = await generateObjectTracked({
    schema: linkedinRatingSchema,
    tracking: {
      feature: AI_USAGE_FEATURES.LINKEDIN_RATING,
      surface: "app",
      userId,
    },
    system: [
      "You are an expert LinkedIn profile reviewer for job seekers. Evaluate a profile and return an actionable rating.",
      "",
      "OUTPUT FORMAT: Respond with ONLY a valid JSON object using EXACTLY these camelCase field names — no uppercase keys, no extra fields, no markdown:",
      "{",
      '  "overallScore": 68,',
      '  "scores": { "headline": 60, "about": 70, "experienceImpact": 65, "skillsKeywords": 75, "completeness": 80 },',
      '  "issues": [{ "severity": "warning", "message": "Headline is just a job title with no specialisation or value", "category": "Headline" }],',
      '  "suggestions": { "items": ["Rewrite the headline as role + specialisation + outcome", "Add metrics to the two most recent roles"] },',
      '  "benchmark": { "role": "Senior Account Executive", "percentile": 42, "summary": "Stronger territory depth than most, but the experience section reads as duties where competitors show outcomes.", "benchmarkScores": { "headline": 80, "about": 82, "experienceImpact": 85, "skillsKeywords": 80, "completeness": 88 }, "advantages": ["Consistent multi-year quota attainment"], "gaps": ["No quantified impact in the two most recent roles"] }',
      "}",
      "",
      "severity must be one of: critical, warning, info. Every score is 0-100.",
      "",
      UNTRUSTED_CONTENT_RULES,
      "",
      hasExtraContext
        ? "IMPORTANT INPUT LIMITATION: the LinkedIn input is text extracted from LinkedIn's 'Save profile as PDF' export. It contains no photo, banner, recommendations, engagement metrics or connection count, and section order may be flattened. Never comment on or penalise anything you cannot see there. The candidate HAS attached their resume below — that context IS available to you and must inform the rating, the issues and the benchmark. But the scores still rate the LinkedIn profile itself: when the attached resume reveals experience, projects or skills the profile fails to showcase, that is a gap and an issue to raise, never a score boost."
        : "IMPORTANT INPUT LIMITATION: the input is text extracted from LinkedIn's 'Save profile as PDF' export. It contains no photo, banner, recommendations, engagement metrics or connection count, and section order may be flattened. Never comment on or penalise anything you cannot see, and do not penalise a profile for content the export simply omits.",
      "",
      "CRITICAL FAIRNESS REQUIREMENTS — scores MUST NEVER depend on: the person's name, gender, school or university name, GPA, city or location, or any personal demographic. Evaluate ONLY the substance and presentation of the professional content.",
      "",
      "Be fair and encouraging, not punitive. Reserve scores below 40 for sections that are genuinely missing or empty.",
      "",
      "Score each category 0-100:",
      "",
      "HEADLINE: is the headline more than a bare job title? Reward role + specialisation + the value delivered, and relevant keywords a recruiter would search.",
      "",
      "ABOUT: the quality of the summary narrative — a clear first-person story covering who they are, what they specialise in, notable results, and what they are looking for. Penalise an empty or one-line about section, and buzzword soup with no substance.",
      "",
      "EXPERIENCE IMPACT: do roles describe quantified achievements (numbers, percentages, scale, outcomes) rather than lists of duties? Reward strong action verbs and concrete results. Penalise copy-pasted job descriptions and titles with no body text.",
      "",
      "SKILLS AND KEYWORDS: presence and relevance of role-specific skills, tools, credentials, licenses and competencies (technical or otherwise) across the profile, and whether they match the roles the person appears to target.",
      "",
      "COMPLETENESS: which sections are present and filled — headline, about, experience, education, skills, certifications, projects, licenses. More filled, relevant sections score higher.",
      "",
      "The overall score is a weighted average: about (25%) + experienceImpact (25%) + headline (20%) + skillsKeywords (15%) + completeness (15%).",
      "",
      "Every issue must be specific and name a concrete fix. Return 3-8 suggestions, each a single actionable sentence.",
      "",
      "BENCHMARK: also compare this profile against the competition.",
      "- role: infer the candidate's target role AND seniority from the profile (e.g. 'Mid-level Data Analyst'). Do not invent a role the profile does not support.",
      "- benchmarkScores: for each category, the score a STRONG profile competing for that same role typically achieves. These describe the competition, not this candidate.",
      "- percentile: an honest estimate of where this profile stands against the pool of candidates competing for that role, where 50 is the median. Be critical rather than flattering — most profiles are not above the 70th percentile.",
      "- advantages: concrete things this profile genuinely does better than typical competitors. Return an empty array rather than inventing one.",
      "- gaps: concrete things typical competitors do better than this profile.",
      "- summary: 1-2 honest sentences comparing this profile to that competition.",
    ].join("\n"),
    prompt: promptParts.join("\n\n"),
  })

  return object
}
