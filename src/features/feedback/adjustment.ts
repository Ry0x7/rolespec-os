import { FEEDBACK_LABELS, type FeedbackAdjustment, type FeedbackVerdict } from "./types"

/**
 * The complete feedback -> score table. Every number is explicit and testable,
 * so a user can see exactly why a verdict moved a posting. No signal is learned
 * from posting text or from a recruiter's answer.
 *
 * REJECTED is zero on purpose: a rejection says something about that
 * application, not about the user's abilities. Demoting every posting that
 * shares a company with a rejection would turn one recruiter's decision into a
 * qualification the user never claimed.
 */
const POINTS: Record<FeedbackVerdict, number> = {
  INTERESTED: 2,
  IRRELEVANT: -10,
  APPLIED: 4,
  REJECTED: 0,
  INTERVIEWED: 6,
  OFFERED: 8,
}

/** Why a verdict has that weight, worded as the ranking explains it. */
const REASONS: Record<FeedbackVerdict, string> = {
  INTERESTED: "You marked this posting interested.",
  IRRELEVANT: "You marked this posting irrelevant.",
  APPLIED: "You applied to this posting.",
  REJECTED: "You recorded a rejection; this does not change the score because an outcome is not evidence about your skills.",
  INTERVIEWED: "You reached an interview for this posting.",
  OFFERED: "You received an offer for this posting.",
}

/** The adjustment for one verdict, or null when the user said nothing. */
export function feedbackAdjustment(
  verdict: FeedbackVerdict | null | undefined
): FeedbackAdjustment | null {
  if (!verdict) return null
  return {
    verdict,
    points: POINTS[verdict],
    label: `${FEEDBACK_LABELS[verdict]}: ${REASONS[verdict]}`,
  }
}

/** Adds a user-controlled adjustment to a 0-100 composite, clamped. */
export function applyFeedbackAdjustment(
  score: number,
  adjustment: FeedbackAdjustment | null
): number {
  if (!adjustment || adjustment.points === 0) return Math.max(0, Math.min(100, score))
  return Math.max(0, Math.min(100, score + adjustment.points))
}
