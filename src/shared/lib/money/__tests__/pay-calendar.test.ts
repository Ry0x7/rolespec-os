import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { payCalendar, resetPayCalendar } from "../pay-calendar"

beforeEach(() => {
  delete process.env.SALARY_WORKING_HOURS_PER_YEAR
  delete process.env.SALARY_WORKING_DAYS_PER_YEAR
  resetPayCalendar()
})

afterEach(() => {
  delete process.env.SALARY_WORKING_HOURS_PER_YEAR
  delete process.env.SALARY_WORKING_DAYS_PER_YEAR
  resetPayCalendar()
})

describe("payCalendar", () => {
  it("defaults to a full-time year", () => {
    const calendar = payCalendar()
    expect(calendar.hoursPerYear.toFixed()).toBe("2080")
    expect(calendar.daysPerYear.toFixed()).toBe("260")
    expect(calendar.weeksPerYear.toFixed()).toBe("52")
    expect(calendar.monthsPerYear.toFixed()).toBe("12")
  })

  it("is stable across calls", () => {
    expect(payCalendar()).toBe(payCalendar())
  })

  it("observes a configured working year", () => {
    process.env.SALARY_WORKING_HOURS_PER_YEAR = "1560"
    process.env.SALARY_WORKING_DAYS_PER_YEAR = "195"
    resetPayCalendar()
    const calendar = payCalendar()
    expect(calendar.hoursPerYear.toFixed()).toBe("1560")
    expect(calendar.daysPerYear.toFixed()).toBe("195")
  })

  it("ignores an unusable override instead of annualizing by zero", () => {
    for (const bad of ["0", "-40", "not-a-number", ""]) {
      process.env.SALARY_WORKING_HOURS_PER_YEAR = bad
      resetPayCalendar()
      expect(payCalendar().hoursPerYear.toFixed()).toBe("2080")
    }
  })

  it("keeps weeks and months as calendar constants", () => {
    process.env.SALARY_WORKING_HOURS_PER_YEAR = "1000"
    resetPayCalendar()
    expect(payCalendar().weeksPerYear.toFixed()).toBe("52")
    expect(payCalendar().monthsPerYear.toFixed()).toBe("12")
  })
})
