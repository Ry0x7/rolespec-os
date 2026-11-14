import { z } from "zod"

/**
 * Shared pieces of the profile-rating structured output. Mirrors the ATS
 * analysis shape (`overallScore` / `scores` / `issues` / `suggestions`) so the
 * LinkedIn and portfolio ratings render through one UI.
 */

export const ratingIssueSchema = z.object({
  severity: z.enum(["critical", "warning", "info"]),
  message: z.string(),
  category: z.string(),
})

export const ratingSuggestionsSchema = z.object({
  items: z.array(z.string()),
})

export const scoreSchema = z.number().min(0).max(100)

export type RatingIssue = z.infer<typeof ratingIssueSchema>
export type RatingSuggestions = z.infer<typeof ratingSuggestionsSchema>

/**
 * Competitor benchmark attached to a rating. Declared structurally (rather than
 * inferred from the LinkedIn zod schema) so `rating.service.ts` can type the
 * persisted column without importing a feature module.
 */
export type RatingBenchmark = {
  /** Role + seniority inferred from the profile, e.g. "Senior Frontend Engineer". */
  role: string
  /** Estimated standing versus typical candidates competing for that role. */
  percentile: number
  /** 1-2 sentence honest comparison narrative. */
  summary: string
  /** Typical category scores of STRONG competing profiles. */
  benchmarkScores: {
    headline: number
    about: number
    experienceImpact: number
    skillsKeywords: number
    completeness: number
  }
  /** Where this profile beats typical competitors — may be empty. */
  advantages: string[]
  /** Where competitors typically beat this profile. */
  gaps: string[]
}
