import { cache } from "react"
import { cookies } from "next/headers"
import { MAX_TZ_OFFSET_MINUTES, TZ_OFFSET_COOKIE, calendarDayStart } from "@/shared/lib/dates"

/**
 * The UTC midnight of the day it currently is *for the user*, for server
 * components that have to frame "today" — the dashboard's applied-today count
 * and upcoming window, the planner's agenda.
 *
 * The offset comes from the `rs-tz-offset` cookie written by `TimezoneSync`.
 * When it is missing (the first render of a fresh session) or nonsense, this
 * falls back to the UTC day, which is the framing the app used before. Residual:
 * a user who travels across timezones sees the old framing until the next
 * render, because the cookie is refreshed on mount.
 */
export async function getUserDayStart(now: Date = new Date()): Promise<Date> {
  return calendarDayStart(now, await getUserTzOffsetMinutes())
}

/**
 * The user's UTC offset in `getTimezoneOffset()` minutes (UTC+8 → -480), from
 * the same `rs-tz-offset` cookie as `getUserDayStart`, with the same fallback:
 * missing, nonsense or out-of-range reads as 0 (UTC). For code that compares a
 * real instant against the user's day, since `getUserDayStart` is only a label.
 */
export const getUserTzOffsetMinutes = cache(async (): Promise<number> => {
  const raw = (await cookies()).get(TZ_OFFSET_COOKIE)?.value
  const offsetMinutes = raw === undefined ? 0 : Number(raw)
  return Number.isFinite(offsetMinutes) && Math.abs(offsetMinutes) <= MAX_TZ_OFFSET_MINUTES
    ? offsetMinutes
    : 0
})
