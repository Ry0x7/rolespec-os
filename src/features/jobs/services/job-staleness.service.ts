/**
 * "Stale" saved jobs on `/jobs`: ones the user saved but never acted on, and
 * that have either sat for over a month or run past their deadline. It is a
 * label and a filter only — nothing is ever deleted because of it.
 *
 * Pure, so the server page, the hook and the card can all share it.
 */

import { ApplicationStatus } from "@/generated/prisma/enums"
import { calendarDaysBetween } from "@/shared/lib/dates"

/** A saved job untouched for longer than this many days reads as stale. */
export const STALE_AFTER_DAYS = 30

export interface StaleCheckable {
  status: ApplicationStatus
  /** `JobApplication.createdAt` — the day the user saved the job. */
  createdAt: Date
  /** Set once the user applied; a row carrying one is never stale. */
  dateApplied: Date | null
  job: { deadline: Date | null }
}

/**
 * True when the job is still only saved (`INTERESTED`, not yet applied) AND it
 * was saved more than `STALE_AFTER_DAYS` days before `today`, or its deadline is
 * strictly before `today`. Any other status is never stale, and neither is a
 * row with a `dateApplied` — the user acted on it even if the status lags.
 *
 * `today` is the user's calendar day (UTC midnight) from the server page, the
 * same framing the deadline countdown uses.
 */
export function isStaleJob(row: StaleCheckable, today: Date): boolean {
  if (row.status !== ApplicationStatus.INTERESTED) return false
  if (row.dateApplied) return false
  if (calendarDaysBetween(new Date(row.createdAt), today) > STALE_AFTER_DAYS) return true
  return (
    row.job.deadline !== null &&
    calendarDaysBetween(new Date(row.job.deadline), today) > 0
  )
}
