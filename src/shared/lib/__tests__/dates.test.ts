import { describe, it, expect } from "vitest"
import {
  addCalendarDays,
  calendarDayStart,
  calendarDaysBetween,
  formatCalendarDate,
  localCalendarDateString,
  parseCalendarDate,
  toCalendarDateString,
} from "../dates"

/** The offset a UTC+8 browser reports — the case the date audit came from. */
const UTC_PLUS_8 = -480

describe("parseCalendarDate", () => {
  it("reads a date input value as that day's UTC midnight", () => {
    expect(parseCalendarDate("2026-09-09")?.toISOString()).toBe(
      "2026-09-09T00:00:00.000Z",
    )
  })

  it("rejects a day that does not exist rather than rolling it forward", () => {
    expect(parseCalendarDate("2026-02-31")).toBeNull()
  })

  it("rejects anything that is not a bare calendar date", () => {
    expect(parseCalendarDate("2026-09-09T07:00:00.000Z")).toBeNull()
    expect(parseCalendarDate("09/09/2026")).toBeNull()
    expect(parseCalendarDate("")).toBeNull()
    expect(parseCalendarDate(undefined)).toBeNull()
  })
})

describe("calendarDayStart", () => {
  it("gives the user's day, not the server's, in the evening east of UTC", () => {
    // 07:00 on 9 Sep in UTC+8.
    const now = new Date("2026-09-08T23:00:00.000Z")

    expect(calendarDayStart(now, UTC_PLUS_8).toISOString()).toBe(
      "2026-09-09T00:00:00.000Z",
    )
    expect(calendarDayStart(now).toISOString()).toBe("2026-09-08T00:00:00.000Z")
  })

  it("ignores an offset no timezone could produce", () => {
    const now = new Date("2026-09-08T23:00:00.000Z")

    expect(calendarDayStart(now, -100_000).toISOString()).toBe(
      "2026-09-08T00:00:00.000Z",
    )
  })
})

describe("addCalendarDays", () => {
  it("lands on the same time of day a week later", () => {
    const day = parseCalendarDate("2026-09-09")!

    expect(addCalendarDays(day, 7).toISOString()).toBe("2026-09-16T00:00:00.000Z")
    expect(addCalendarDays(day, -30).toISOString()).toBe("2026-08-10T00:00:00.000Z")
  })
})

describe("calendarDaysBetween", () => {
  it("counts whole days on the calendar", () => {
    const today = parseCalendarDate("2026-09-09")!

    expect(calendarDaysBetween(today, parseCalendarDate("2026-09-16")!)).toBe(7)
    expect(calendarDaysBetween(today, today)).toBe(0)
    expect(calendarDaysBetween(today, parseCalendarDate("2026-09-08")!)).toBe(-1)
  })
})

describe("formatCalendarDate", () => {
  it("prints the stored day whatever timezone the reader is in", () => {
    // UTC midnight is the previous evening for every reader west of Greenwich;
    // the local formatter would print 8 Sep for them.
    expect(formatCalendarDate(new Date("2026-09-09T00:00:00.000Z"))).toBe(
      "Sep 9, 2026",
    )
    expect(formatCalendarDate("2026-09-09")).toBe("Sep 9, 2026")
  })
})

describe("calendar-date round trip", () => {
  it("shows the edit input the same day the page renders", () => {
    const stored = addCalendarDays(parseCalendarDate("2026-09-09")!, 7)

    expect(formatCalendarDate(stored)).toBe("Sep 16, 2026")
    expect(toCalendarDateString(stored)).toBe("2026-09-16")
    // Re-submitting the untouched input has to store the very same instant.
    expect(parseCalendarDate(toCalendarDateString(stored))).toEqual(stored)
  })

  it("captures the browser's own day, whatever the suite's timezone is", () => {
    const now = new Date()

    expect(localCalendarDateString(now)).toBe(
      toCalendarDateString(calendarDayStart(now, now.getTimezoneOffset())),
    )
  })
})
