import type { JobFeedbackVerdict } from "@/generated/prisma/enums"

/**
 * What the user themselves said about a posting.
 *
 * This is deliberately not an application status: the tracker's status is the
 * lifecycle of an application, while feedback is the user's judgement of the
 * posting itself. A recruiter rejection is an outcome, never evidence that the
 * user lacks a skill.
 */
export type FeedbackVerdict = JobFeedbackVerdict

/** One persisted user verdict, in the shape the UI needs. */
export interface FeedbackEntry {
  postingKey: string
  jobId: string | null
  title: string
  companyName: string
  url: string | null
  verdict: FeedbackVerdict
  note: string | null
  updatedAt: string
}

/** A posting key -> verdict map for one screen. */
export type FeedbackMap = Record<string, FeedbackVerdict>

export const FEEDBACK_VERDICTS: readonly FeedbackVerdict[] = [
  "INTERESTED",
  "IRRELEVANT",
  "APPLIED",
  "REJECTED",
  "INTERVIEWED",
  "OFFERED",
]

export const FEEDBACK_LABELS: Record<FeedbackVerdict, string> = {
  INTERESTED: "Interested",
  IRRELEVANT: "Irrelevant",
  APPLIED: "Applied",
  REJECTED: "Rejected",
  INTERVIEWED: "Interviewed",
  OFFERED: "Offered",
}

/**
 * A deterministic, user-controlled adjustment to the ranking composite.
 *
 * `points` is added to the score after the factual factors are calculated, and
 * is capped to 0-100. It is never derived from a job description, and a
 * rejection contributes nothing: that is an outcome, not a skill signal.
 */
export interface FeedbackAdjustment {
  verdict: FeedbackVerdict
  points: number
  label: string
}
