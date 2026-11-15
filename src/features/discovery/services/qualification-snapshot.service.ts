import type { Qualification, QualificationVerdict } from "./qualify.service"

/**
 * The qualification as it is stored on `Job.qualification`.
 *
 * A snapshot, not a cache: it records what the user was told when they decided
 * to save, so a later profile edit does not silently rewrite the reasoning
 * behind a decision they already made. Signals are the step signals verbatim
 * (GOOD/NEUTRAL/CONCERN/BLOCKER), `risk.level` is LOW/MEDIUM/HIGH or null.
 *
 * Pure, and deliberately not in `discovery.actions`: a `"use server"` module may
 * only export async functions, so every writer of this shape — the discovery
 * save action and the extension route — has to reach it from here.
 */
export interface StoredQualification {
  verdict: QualificationVerdict
  nextAction: string
  /** ISO-8601, when the snapshot was taken. */
  checkedAt: string
  worthIt: { signal: string; reasons: string[]; unchecked?: string[] }
  eligible: { signal: string; reasons: string[]; unchecked?: string[] }
  match: {
    signal: string
    reasons: string[]
    /** Profile capabilities the posting mentions, in profile order. */
    matched: string[]
    confirmedCount: number
  }
  risk: { signal: string; reasons: string[]; level: string | null }
  /**
   * Where the posting said it would consider candidates from. Optional: every
   * snapshot written before market fit existed parses without it, and a reader
   * that finds it missing simply has nothing to say about location.
   */
  marketFit?: { fit: string; reason: string; label: string }
  /**
   * Whether sponsorship was still an open question when the snapshot was taken.
   * Optional: every snapshot written before this existed parses without it, and
   * a reader that finds it missing falls back to the posting's own flags.
   */
  sponsorshipRelevant?: boolean
}

/** Flattens a `Qualification` into the shape stored on the posting row. */
export function toStoredQualification(qualification: Qualification): StoredQualification {
  return {
    verdict: qualification.verdict,
    nextAction: qualification.nextAction,
    checkedAt: new Date().toISOString(),
    worthIt: {
      signal: qualification.worthIt.signal,
      reasons: qualification.worthIt.reasons,
      ...(qualification.worthIt.unchecked && { unchecked: qualification.worthIt.unchecked }),
    },
    eligible: {
      signal: qualification.eligible.signal,
      reasons: qualification.eligible.reasons,
      ...(qualification.eligible.unchecked && { unchecked: qualification.eligible.unchecked }),
    },
    match: {
      signal: qualification.match.signal,
      reasons: qualification.match.reasons,
      matched: qualification.match.matched,
      confirmedCount: qualification.match.confirmedCount,
    },
    risk: {
      signal: qualification.risk.signal,
      reasons: qualification.risk.reasons,
      level: qualification.risk.level,
    },
    marketFit: {
      fit: qualification.marketFit.fit,
      reason: qualification.marketFit.reason,
      label: qualification.marketFit.label,
    },
    ...(qualification.sponsorshipRelevant !== undefined && {
      sponsorshipRelevant: qualification.sponsorshipRelevant,
    }),
  }
}
