import { ApplicationStatus } from "@/generated/prisma/enums"
import { STATUS_LABELS } from "../constants/status-labels"

/**
 * The statuses where the application is over, one way or another. The mirror
 * image of `FOLLOW_UP_STATUSES`: nothing is waiting on a reply any more, so the
 * useful thing to record is how it ended rather than when to chase it.
 */
export const TERMINAL_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.OFFER,
  ApplicationStatus.REJECTED,
  ApplicationStatus.WITHDRAWN,
]

/** True when the application has reached one of the three end states. */
export function isTerminalStatus(status: ApplicationStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * The one-line outcome label — "Rejected", "Offer", "Withdrawn" — reusing the
 * pipeline's own display names so the line never drifts from the status badge
 * sitting above it.
 */
export function outcomeLabel(status: ApplicationStatus): string {
  return STATUS_LABELS[status]
}
