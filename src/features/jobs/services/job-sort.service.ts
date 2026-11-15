/**
 * The `/jobs` list order.
 *
 * "Needs action" is the default because the tracker's job is to answer "what do
 * I do next?" rather than "what did I touch last". It reads the urgency
 * `describeNextStep` already decided, so the two never disagree.
 *
 * Lives beside the follow-up filter's param parsing rather than in the hook,
 * because `/jobs/page.tsx` is a server component and applies the same order
 * before the rows are ever sent.
 */

import type { OpportunityConfidenceLevel } from "@/features/discovery/services/opportunity-confidence.service"

export type JobSortValue =
  | "NEEDS_ACTION"
  | "RECENT"
  | "CONFIDENCE"
  | "SAVED_NEWEST"
  | "SAVED_OLDEST"
  | "DEADLINE"
  | "MATCH_SCORE"

/** `/jobs?sort=recent` — a non-default value the page honours. */
export const RECENT_SORT_PARAM = "recent"

/** `/jobs?sort=confidence` — so every option the control offers can be linked to. */
export const CONFIDENCE_SORT_PARAM = "confidence"

/** `/jobs?sort=saved-newest` — the day the user saved the job, newest first. */
export const SAVED_NEWEST_SORT_PARAM = "saved-newest"

/** `/jobs?sort=saved-oldest` — oldest saves first, the order a clean-up pass reads. */
export const SAVED_OLDEST_SORT_PARAM = "saved-oldest"

/** `/jobs?sort=deadline` — closest deadline first, rows without one last. */
export const DEADLINE_SORT_PARAM = "deadline"

/** `/jobs?sort=match` — highest stored match score first. */
export const MATCH_SORT_PARAM = "match"

export function parseJobSortParam(param: string | undefined): JobSortValue {
  if (param === RECENT_SORT_PARAM) return "RECENT"
  if (param === CONFIDENCE_SORT_PARAM) return "CONFIDENCE"
  if (param === SAVED_NEWEST_SORT_PARAM) return "SAVED_NEWEST"
  if (param === SAVED_OLDEST_SORT_PARAM) return "SAVED_OLDEST"
  if (param === DEADLINE_SORT_PARAM) return "DEADLINE"
  if (param === MATCH_SORT_PARAM) return "MATCH_SCORE"
  return "NEEDS_ACTION"
}

export const JOB_SORT_OPTIONS: { value: JobSortValue; label: string }[] = [
  { value: "NEEDS_ACTION", label: "Needs action" },
  { value: "RECENT", label: "Recently updated" },
  { value: "CONFIDENCE", label: "Confidence" },
  { value: "DEADLINE", label: "Deadline" },
  { value: "MATCH_SCORE", label: "Match score" },
  { value: "SAVED_NEWEST", label: "Newest saved" },
  { value: "SAVED_OLDEST", label: "Oldest saved" },
]

/** HIGH first, UNKNOWN last: the order a "which postings are real?" pass reads. */
const CONFIDENCE_RANK: Record<OpportunityConfidenceLevel, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
  UNKNOWN: 3,
}

/** What the two orders compare. Structural so the server and the hook share it. */
export interface JobSortable {
  /** Only read as the saved orders' tiebreak, so equal save times stay put. */
  id: string
  /** `JobApplication.createdAt` — the day the user saved the job. */
  createdAt: Date
  updatedAt: Date
  nextStep: { urgency: number }
  /** Only read by the "Confidence" order; a row without one ranks as UNKNOWN. */
  confidence?: { level: OpportunityConfidenceLevel }
  /** Optional calendar deadline (`Job.deadline`); absent sorts last under Deadline. */
  deadline?: Date | null
  /** Optional stored resume-match score (0–100); absent ranks as -1 under Match. */
  matchScore?: number | null
}

/** A new array, ordered. Never mutates the input. */
export function sortJobRows<T extends JobSortable>(rows: T[], sort: JobSortValue): T[] {
  return [...rows].sort((a, b) => {
    if (sort === "SAVED_NEWEST" || sort === "SAVED_OLDEST") {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      if (diff !== 0) return sort === "SAVED_OLDEST" ? diff : -diff
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    }
    if (sort === "CONFIDENCE") {
      const rankA = CONFIDENCE_RANK[a.confidence?.level ?? "UNKNOWN"]
      const rankB = CONFIDENCE_RANK[b.confidence?.level ?? "UNKNOWN"]
      if (rankA !== rankB) return rankA - rankB
    }
    if (sort === "DEADLINE") {
      const aNested = (a as { job?: { deadline?: Date | null } }).job?.deadline ?? a.deadline
      const bNested = (b as { job?: { deadline?: Date | null } }).job?.deadline ?? b.deadline
      const aTime = aNested ? new Date(aNested).getTime() : Number.POSITIVE_INFINITY
      const bTime = bNested ? new Date(bNested).getTime() : Number.POSITIVE_INFINITY
      if (aTime !== bTime) return aTime - bTime
    }
    if (sort === "MATCH_SCORE") {
      const aScore =
        typeof a.matchScore === "number"
          ? a.matchScore
          : (a as { verdict?: string | null }).verdict === "STRONG"
            ? 75
            : (a as { verdict?: string | null }).verdict === "WORTH_A_LOOK"
              ? 50
              : (a as { verdict?: string | null }).verdict === "WEAK"
                ? 25
                : -1
      const bScore =
        typeof b.matchScore === "number"
          ? b.matchScore
          : (b as { verdict?: string | null }).verdict === "STRONG"
            ? 75
            : (b as { verdict?: string | null }).verdict === "WORTH_A_LOOK"
              ? 50
              : (b as { verdict?: string | null }).verdict === "WEAK"
                ? 25
                : -1
      if (aScore !== bScore) return bScore - aScore
    }
    // Ties within a confidence level fall back to the default "Needs action" order.
    if (
      (sort === "NEEDS_ACTION" || sort === "CONFIDENCE") &&
      a.nextStep.urgency !== b.nextStep.urgency
    ) {
      return a.nextStep.urgency - b.nextStep.urgency
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}
