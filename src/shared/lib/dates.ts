/**
 * Calendar dates, as opposed to instants.
 *
 * `dateApplied`, `deadline`, `followUpAt` and a todo's `dueDate` are days on the
 * user's own calendar, not moments in time: every one of them is entered through
 * an `<input type="date">`, rendered without a clock, and — for the `@db.Date`
 * columns — stored as the UTC midnight of that day. This module is the single
 * place that convention lives:
 *
 *   store  — UTC midnight of the day the user means
 *   render — formatted in UTC, so the stored Y-M-D is the displayed Y-M-D
 *   edit   — round-tripped through the UTC Y-M-D slice
 *
 * `interviewDate` is deliberately not in that set. It carries a time of day, so
 * it stays a real instant and keeps the local-time formatters in
 * `@/shared/lib/utils`.
 */

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const MS_PER_DAY = 86_400_000

/**
 * Cookie holding the browser's `getTimezoneOffset()` in minutes, so a server
 * component can frame "today" the way the user's own clock does. Absent on the
 * very first render of a fresh session; callers fall back to UTC.
 */
export const TZ_OFFSET_COOKIE = "rs-tz-offset"

/** Nothing on Earth is further than 14h from UTC; anything else is a forged cookie. */
export const MAX_TZ_OFFSET_MINUTES = 14 * 60

/**
 * `YYYY-MM-DD` → the UTC midnight that represents it, or null when the string is
 * not a real date. The parts are re-derived and compared because
 * `new Date("2026-02-31")` silently rolls forward into March rather than failing.
 */
export function parseCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!CALENDAR_DATE_PATTERN.test(trimmed)) return null

  const [year, month, day] = trimmed.split("-").map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }
  return parsed
}

/** The stored day as `YYYY-MM-DD` — the value an `<input type="date">` wants. */
export function toCalendarDateString(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/**
 * The day it is *where the user is*, as `YYYY-MM-DD`. Client-side only: the
 * point is to capture the browser's calendar day before it reaches a server that
 * may be running in UTC.
 */
export function localCalendarDateString(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, "0")
  const day = `${now.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** Same calendar convention, `days` later — never a DST-shifted local hop. */
export function addCalendarDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * MS_PER_DAY)
}

/**
 * The UTC midnight of the day it currently is at `offsetMinutes`, the value a
 * browser's `Date.prototype.getTimezoneOffset()` returns (UTC+8 → -480). An
 * out-of-range offset is treated as absent, i.e. UTC.
 */
export function calendarDayStart(now: Date, offsetMinutes = 0): Date {
  const offset =
    Number.isFinite(offsetMinutes) && Math.abs(offsetMinutes) <= MAX_TZ_OFFSET_MINUTES
      ? offsetMinutes
      : 0
  const shifted = new Date(now.getTime() - offset * 60_000)
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  )
}

/**
 * Whole days from one day-start to another, both already UTC-anchored. Used for
 * "Today / Tomorrow / In N days" labels, which must count days on the user's
 * calendar rather than 24h blocks off an instant.
 */
export function calendarDaysBetween(from: Date, to: Date): number {
  const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const toDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((toDay - fromDay) / MS_PER_DAY)
}

const calendarDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

/**
 * Renders a calendar date as its stored day, whatever timezone the reader is in.
 * `formatDate` would local-convert the UTC midnight and roll it back a day for
 * every reader west of Greenwich.
 */
export function formatCalendarDate(value: Date | string): string {
  return calendarDateFormat.format(
    typeof value === "string" ? (parseCalendarDate(value) ?? new Date(value)) : value,
  )
}
