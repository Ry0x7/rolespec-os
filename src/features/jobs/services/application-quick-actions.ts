import { ApplicationStatus } from "@/generated/prisma/enums"
import { calendarDaysBetween } from "@/shared/lib/dates"
import type { JobDetailSection } from "../lib/job-detail-href"
import { FOLLOW_UP_STATUSES } from "./follow-up.service"
import { describeNextStep, type NextStepInput } from "./application-next-step.service"

/**
 * The one or two things a row lets the user *do* about its next step, without
 * opening the job.
 *
 * Derived from the same facts `describeNextStep` reads, and deliberately in the
 * same precedence order, so the button never contradicts the line above it: a
 * row that says "Follow up — 3 days overdue" offers Done and Snooze, a row that
 * says "Decide on the offer" offers only Open.
 *
 * Pure — no clock of its own. `today` is the UTC midnight of the user's own
 * calendar day (`getUserDayStart`), exactly as the next-step line takes it.
 */

/**
 * What the button does. Every kind maps onto a server action the job detail
 * page already calls, never a new code path:
 *
 *   mark-applied       → `updateJobApplicationStatus(id, APPLIED, today)`
 *   follow-up-done     → `clearJobApplicationFollowUp(id)`
 *   snooze-week        → `snoozeJobApplicationFollowUp(id, today)`
 *   schedule-follow-up → `scheduleJobApplicationFollowUp(id, today)`
 *   check-fit          → `recheckJobQualification(id)`
 *   open               → a link to `/jobs/{id}`, deep-linked to `section` if set
 */
export type QuickActionKind =
  | "mark-applied"
  | "follow-up-done"
  | "snooze-week"
  | "schedule-follow-up"
  | "check-fit"
  | "open"

export interface QuickAction {
  kind: QuickActionKind
  /** The button's visible text. `open` is worded for the state it stands in for. */
  label: string
  /**
   * `open` only: the Job Detail section the link lands on, when the label names
   * a move that section owns. Absent means the top of the page.
   */
  section?: JobDetailSection
}

/**
 * The two honest answers to a chase whose day has come: it is done, or it is not
 * worth chasing yet. Shared with the dashboard's overdue list and the planner
 * agenda, which both know a row is due without re-deriving it, so all three
 * surfaces offer the same pair.
 */
export const FOLLOW_UP_DUE_ACTIONS: QuickAction[] = [
  { kind: "follow-up-done", label: "Done" },
  { kind: "snooze-week", label: "Snooze 1 week" },
]

/**
 * Above this urgency a scheduled follow-up is simply not pressing enough to be
 * worth a button: the row is waiting, and pushing "later" further out is noise.
 */
const SNOOZE_MAX_URGENCY = 1

export function quickActionsFor(row: NextStepInput, today: Date): QuickAction[] {
  const { status } = row

  // An offer is a decision, and the decision needs the whole page.
  if (status === ApplicationStatus.OFFER) {
    return [{ kind: "open", label: "Decide", section: "decide" }]
  }

  // Closed is history. Nothing to do, so nothing to press.
  if (
    status === ApplicationStatus.REJECTED ||
    status === ApplicationStatus.WITHDRAWN
  ) {
    return []
  }

  // An interview that has already happened outranks the chase, the same way it
  // does in `describeNextStep` — the outcome is what the row is waiting on, and
  // recording it means opening the job.
  if (
    (status === ApplicationStatus.INTERVIEW ||
      status === ApplicationStatus.SCREENING) &&
    row.interviewDate !== null &&
    row.interviewDate.getTime() < today.getTime()
  ) {
    // The outcome panel and the status control live in Track.
    return [{ kind: "open", label: "Log the outcome", section: "track" }]
  }

  if (FOLLOW_UP_STATUSES.includes(status)) {
    if (row.followUpAt) {
      // Due today counts as due: the day has come, so the chase is actionable.
      if (calendarDaysBetween(today, row.followUpAt) <= 0) {
        return FOLLOW_UP_DUE_ACTIONS
      }
      // Still in the future. Only worth a button while something else on the
      // row (an imminent interview, say) already makes it urgent.
      return describeNextStep(row, today).urgency <= SNOOZE_MAX_URGENCY
        ? [{ kind: "snooze-week", label: "Snooze 1 week" }]
        : []
    }
    return [{ kind: "schedule-follow-up", label: "Schedule follow-up" }]
  }

  // INTERESTED with no verdict: the row was saved before fit was recorded, so
  // "Review and decide" is all `describeNextStep` can say and the user has
  // nothing to decide on. Getting the verdict outranks sending the application,
  // so it replaces "Mark applied" rather than joining it — two buttons is the
  // cap, and applying is still one click away behind Open.
  //
  // Deliberately INTERESTED-only: on an APPLIED or interviewing row the chase
  // is the pressing thing and the fit is retrospective.
  if (row.verdict === null) {
    return [
      { kind: "check-fit", label: "Check fit" },
      { kind: "open", label: "Open" },
    ]
  }

  // INTERESTED: not sent yet. Sending it is the move; reading it first is the
  // alternative, so the row offers both.
  return [
    { kind: "mark-applied", label: "Mark applied" },
    { kind: "open", label: "Open" },
  ]
}
