import { describe, expect, it } from "vitest"

import { hasComparableAnnualRange, parseSalary } from "../salary"

describe("parseSalary", () => {
  it("reads a Philippine monthly range", () => {
    expect(parseSalary({ salaryText: "₱30,000 - ₱45,000 per month" })).toEqual({
      min: 30_000,
      max: 45_000,
      currency: "PHP",
      period: "MONTHLY",
      annualMin: 360_000,
      annualMax: 540_000,
    })
  })

  it("expands k suffixes and reads an annual USD range", () => {
    const salary = parseSalary({ salaryText: "$120k – $150k a year" })
    expect(salary?.min).toBe(120_000)
    expect(salary?.max).toBe(150_000)
    expect(salary?.currency).toBe("USD")
    expect(salary?.period).toBe("YEARLY")
    expect(salary?.annualMin).toBe(120_000)
  })

  it("annualizes an hourly rate", () => {
    const salary = parseSalary({ salaryText: "USD 50/hr" })
    expect(salary?.period).toBe("HOURLY")
    expect(salary?.annualMin).toBe(104_000)
  })

  it("does not treat a bonus percentage as pay", () => {
    const salary = parseSalary({ salaryText: "$100,000 per year plus 20% bonus" })
    expect(salary?.min).toBe(100_000)
    expect(salary?.max).toBe(100_000)
  })

  it("prefers a structured amount and period when the source has one", () => {
    const salary = parseSalary({
      salary: 40_000,
      currency: "PHP",
      period: "MONTHLY",
      salaryText: "competitive",
    })
    expect(salary?.annualMin).toBe(480_000)
  })

  it("leaves the range incomparable when the currency is not supported", () => {
    const salary = parseSalary({ salaryText: "€50,000 per year" })
    expect(salary?.min).toBe(50_000)
    expect(salary?.currency).toBeNull()
    expect(salary?.annualMin).toBeNull()
    expect(hasComparableAnnualRange(salary)).toBe(false)
  })

  it("leaves the range incomparable when the period is unstated", () => {
    const salary = parseSalary({ salaryText: "PHP 40,000" })
    expect(salary?.currency).toBe("PHP")
    expect(salary?.period).toBeNull()
    expect(salary?.annualMin).toBeNull()
  })

  it("returns null when there is no pay to read", () => {
    expect(parseSalary({})).toBeNull()
    expect(parseSalary({ salaryText: "Competitive" })).toEqual({
      min: null,
      max: null,
      currency: null,
      period: null,
      annualMin: null,
      annualMax: null,
    })
  })
})
