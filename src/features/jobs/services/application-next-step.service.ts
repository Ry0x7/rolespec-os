import { ApplicationStatus } from "@/generated/prisma/enums"
import type { QualificationVerdict } from "@/features/discovery/services/qualify.service"
import { calendarDaysBetween, formatCalendarDate } from "@/shared/lib/dates"
import { formatDate } from "@/shared/lib/utils"
import { FOLLOW_UP_STATUSES } from "./follow-up.service"

/**
 * The one thing to do next about an application, in a single short line.
 *
 * Deterministic and pure — no AI, no clock of its own — so the tracker can
 * compute it on the server, sort by it, and have the row say the same thing on
 * every render. `today` is the UTC midnight of the user's own calendar day (see
 * `getUserDayStart`), because every date this reads is a day on their calendar,
 * not an instant.
 *
 * It replaces the three separate facts the card used to scatter around itself
 * ("Not applied yet", a "Follow up overdue" badge, an outcome line): one line,
 * one instruction, never the same fact twice.
 */

/** 0 is "do this now", 3 is "nothing left to do". Also the default sort key. */
export type NextStepUrgency = 0 | 1 | 2 | 3

/** How the line reads: red for slipped, amber for approaching, muted for done. */
export type NextStepTone = "urgent" | "soon" | "neutral" | "done"

export interface ApplicationNextStep {
  label: string
  urgency: NextStepUrgency
  tone: NextStepTone
}

/**
 * The fields the decision reads. Deliberately structural rather than the full
 * row type, so the dashboard or a test can call it with a literal.
 */
export interface NextStepInput {
  status: ApplicationStatus
  followUpAt: Date | null
  interviewDate: Date | null
  /** The day a terminal status was first reached. Null on older closed rows. */
  outcomeAt: Date | null
  deadline?: Date | null
  /** The stored qualification verdict, when the posting carries one. */
  verdict?: QualificationVerdict | null
}

/** Inside this many days, a scheduled thing stops being "later" and is "now". */
const IMMINENT_DAYS = 2

/** A future follow-up this close is worth an amber tint rather than a muted one. */
const FOLLOW_UP_SOON_DAYS = 3

/**
 * The line a saved STRONG-verdict job gets before it is sent. Exported because
 * the dashboard's Decide-next prompt describes the same state and must not word
 * it differently from the tracker and the job page.
 */
export const STRONG_FIT_NEXT_STEP = "Strong fit — prepare and apply"

/** An INTERESTED posting whose deadline is inside this window forces a decision. */
const DEADLINE_DECISION_DAYS = 7

export function describeNextStep(
  row: NextStepInput,
  today: Date,
): ApplicationNextStep {
  const { status } = row

  // An offer outranks every date on the row: nothing else is the next move.
  if (status === ApplicationStatus.OFFER) {
    // OFFER is terminal, so `outcomeAt` is the day the offer was recorded —
    // the one date that makes "decide" feel timed. Older rows have none.
    return {
      label: row.outcomeAt
        ? `Decide on the offer — received ${formatCalendarDate(row.outcomeAt)}`
        : "Decide on the offer",
      urgency: 0,
      tone: "urgent",
    }
  }

  if (
    status === ApplicationStatus.REJECTED ||
    status === ApplicationStatus.WITHDRAWN
  ) {
    // Applications closed before `outcomeAt` existed have no day to name.
    return {
      label: row.outcomeAt
        ? `Closed ${formatCalendarDate(row.outcomeAt)}`
        : "Closed",
      urgency: 3,
      tone: "done",
    }
  }

  if (
    status === ApplicationStatus.INTERVIEW ||
    status === ApplicationStatus.SCREENING
  ) {
    if (row.interviewDate) {
      // Compared against the user's day start, the same way the dashboard's
      // upcoming window treats an interview instant.
      if (row.interviewDate.getTime() >= today.getTime()) {
        const days = calendarDaysBetween(today, row.interviewDate)
        return {
          label: `Interview ${formatDate(row.interviewDate)}`,
          urgency: days <= IMMINENT_DAYS ? 0 : 1,
          tone: days <= IMMINENT_DAYS ? "urgent" : "soon",
        }
      }
      return {
        label: "Log the interview outcome",
        urgency: 1,
        tone: "soon",
      }
    }
  }

  // Every status that is waiting on someone else to reply falls back to the
  // chase. The spec names APPLIED, but SCREENING and INTERVIEW are in
  // `FOLLOW_UP_STATUSES` too and the card no longer carries a separate overdue
  // badge — so an overdue chase on those has to be said here or not at all.
  if (FOLLOW_UP_STATUSES.includes(status)) {
    if (row.followUpAt) {
      const days = calendarDaysBetween(today, row.followUpAt)
      if (days < 0) {
        const overdue = -days
        return {
          label: `Follow up — ${overdue} ${overdue === 1 ? "day" : "days"} overdue`,
          urgency: 0,
          tone: "urgent",
        }
      }
      if (days === 0) {
        return { label: "Follow up today", urgency: 0, tone: "urgent" }
      }
      return {
        label: `Follow up ${formatCalendarDate(row.followUpAt)}`,
        urgency: 2,
        tone: days <= FOLLOW_UP_SOON_DAYS ? "soon" : "neutral",
      }
    }
    return { label: "Schedule a follow-up", urgency: 1, tone: "soon" }
  }

  // INTERESTED: not sent yet, so the next move is a decision.
  if (row.deadline) {
    const days = calendarDaysBetween(today, row.deadline)
    // A deadline that has already gone is the most urgent thing on the row: the
    // decision is overdue, and "apply or drop" is still the honest instruction
    // because some postings stay open past their stated date.
    if (days < 0) {
      return {
        label: `Deadline passed ${formatCalendarDate(row.deadline)} — apply or drop`,
        urgency: 0,
        tone: "urgent",
      }
    }
    if (days <= DEADLINE_DECISION_DAYS) {
      return {
        label: `Deadline ${formatCalendarDate(row.deadline)} — apply or drop`,
        urgency: days <= IMMINENT_DAYS ? 0 : 1,
        tone: days <= IMMINENT_DAYS ? "urgent" : "soon",
      }
    }
  }

  if (row.verdict === "STRONG") {
    return { label: STRONG_FIT_NEXT_STEP, urgency: 1, tone: "soon" }
  }

  return { label: "Review and decide", urgency: 2, tone: "neutral" }
}
