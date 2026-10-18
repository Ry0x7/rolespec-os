import { describe, it, expect } from "vitest"
import { formatDate, formatDateTime, formatDateTimeUtc } from "../utils"

// Dates are built with the local-time constructor so the expectations hold in
// any timezone the suite happens to run in.
describe("formatDate", () => {
  it("formats a Date as MMM D, YYYY", () => {
    expect(formatDate(new Date(2026, 7, 1))).toBe("Aug 1, 2026")
  })

  it("accepts a date string", () => {
    expect(formatDate("2026-08-01T12:00:00")).toBe("Aug 1, 2026")
  })
})

describe("formatDateTime", () => {
  it("appends the time to the date", () => {
    expect(formatDateTime(new Date(2026, 7, 5, 4, 31))).toBe(
      "Aug 5, 2026, 4:31 AM"
    )
  })

  it("pads the minutes and uses 12-hour clock", () => {
    expect(formatDateTime(new Date(2026, 7, 5, 16, 5))).toBe(
      "Aug 5, 2026, 4:05 PM"
    )
  })

  it("accepts a date string", () => {
    expect(formatDateTime("2026-08-05T04:31:00")).toBe("Aug 5, 2026, 4:31 AM")
  })
})

// These build every Date from a fixed UTC instant, so the expectations are
// machine-timezone independent — that is exactly the property the admin ticket
// queue relies on.
describe("formatDateTimeUtc", () => {
  it("renders a UTC instant in UTC regardless of the local timezone", () => {
    expect(formatDateTimeUtc(new Date("2026-08-05T04:31:00Z"))).toBe(
      "Aug 5, 2026, 4:31 AM"
    )
  })

  it("keeps the date on the UTC side of a midnight boundary", () => {
    expect(formatDateTimeUtc(new Date("2026-08-05T23:45:00Z"))).toBe(
      "Aug 5, 2026, 11:45 PM"
    )
    expect(formatDateTimeUtc(new Date("2026-08-06T00:15:00Z"))).toBe(
      "Aug 6, 2026, 12:15 AM"
    )
  })

  it("accepts an ISO string", () => {
    expect(formatDateTimeUtc("2026-08-05T16:05:00Z")).toBe(
      "Aug 5, 2026, 4:05 PM"
    )
  })

  it("does not shift with the local offset the way formatDateTime does", () => {
    const instant = new Date("2026-08-05T04:31:00Z")
    const localOffsetMinutes = instant.getTimezoneOffset()
    if (localOffsetMinutes === 0) {
      expect(formatDateTimeUtc(instant)).toBe(formatDateTime(instant))
    } else {
      expect(formatDateTimeUtc(instant)).not.toBe(formatDateTime(instant))
    }
    // Pinned either way.
    expect(formatDateTimeUtc(instant)).toBe("Aug 5, 2026, 4:31 AM")
  })
})
