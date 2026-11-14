import { ApplicationStatus } from "@/generated/prisma/enums"

/**
 * The statuses where an application is waiting on someone else to reply, so a
 * follow-up is the useful next move. INTERESTED has not been sent yet, and
 * OFFER / REJECTED / WITHDRAWN are done.
 */
export const FOLLOW_UP_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.APPLIED,
  ApplicationStatus.SCREENING,
  ApplicationStatus.INTERVIEW,
]

/** The follow-up axis of the `/jobs` list filter: everything, or only overdue. */
export type FollowUpFilterValue = "ALL" | "FOLLOW_UP_DUE"

/** `/jobs?filter=follow-up-due` — the one query-param value that page honours. */
export const FOLLOW_UP_DUE_PARAM = "follow-up-due"

/**
 * Maps the `filter` search param onto the list's initial follow-up filter.
 * Lives here rather than beside the hook because `/jobs/page.tsx` is a server
 * component and the hook module is `"use client"`.
 */
export function parseFollowUpFilterParam(
  param: string | undefined,
): FollowUpFilterValue {
  return param === FOLLOW_UP_DUE_PARAM ? "FOLLOW_UP_DUE" : "ALL"
}

/** True when a scheduled follow-up has come due and is still not done. */
export function isFollowUpDue(
  followUpAt: Date | null,
  now: Date = new Date()
): boolean {
  return followUpAt !== null && followUpAt.getTime() <= now.getTime()
}
