import Decimal from "decimal.js"
import { describe, expect, it } from "vitest"

import { SalaryPeriod } from "@/generated/prisma/enums"

import {
  hasComparableAnnualRange,
  parseSalary,
  parseStoredSalary,
  salaryReasonLabel,
  toSalaryColumns,
  type NormalizedSalary,
} from "../salary"

/** Money is Decimal, so compare strings; `toBe(120000)` would compare types. */
function amount(value: Decimal | null): string | null {
  return value === null ? null : value.toFixed()
}

describe("parseSalary — text postings", () => {
  it("reads a Philippine monthly range and annualizes it", () => {
    const salary = parseSalary({ salaryText: "₱30,000 - ₱45,000 per month" })
    expect(salary?.currency).toBe("PHP")
    expect(salary?.period).toBe("MONTHLY")
    expect(amount(salary!.min)).toBe("30000")
    expect(amount(salary!.max)).toBe("45000")
    expect(amount(salary!.annualMin)).toBe("360000")
    expect(amount(salary!.annualMax)).toBe("540000")
    expect(salary?.reason).toBeNull()
    expect(salary?.provenance).toBe("POSTING_TEXT")
    expect(salary?.raw).toBe("₱30,000 - ₱45,000 per month")
  })

  it("expands k suffixes in a USD annual range", () => {
    const salary = parseSalary({ salaryText: "$120k–$150k a year" })
    expect(salary?.currency).toBe("USD")
    expect(salary?.period).toBe("YEARLY")
    expect(amount(salary!.min)).toBe("120000")
    expect(amount(salary!.max)).toBe("150000")
    expect(amount(salary!.annualMin)).toBe("120000")
  })

  it("annualizes an hourly rate through the working calendar", () => {
    const salary = parseSalary({ salaryText: "USD 50/hr" })
    expect(salary?.period).toBe("HOURLY")
    expect(amount(salary!.annualMin)).toBe("104000")
  })

  it("annualizes daily, weekly and monthly rates", () => {
    expect(amount(parseSalary({ salaryText: "USD 100 per day" })!.annualMin)).toBe("26000")
    expect(amount(parseSalary({ salaryText: "USD 1,000 per week" })!.annualMin)).toBe("52000")
    expect(amount(parseSalary({ salaryText: "USD 5,000 monthly" })!.annualMin)).toBe("60000")
  })

  it("reads a euro salary but refuses to annualize without a period", () => {
    const salary = parseSalary({ salaryText: "€60,000" })
    expect(salary?.currency).toBe("EUR")
    expect(salary?.period).toBeNull()
    expect(salary?.reason).toBe("UNKNOWN_PERIOD")
    expect(salary?.annualMin).toBeNull()
    expect(hasComparableAnnualRange(salary)).toBe(false)
  })

  it("reads a yen salary with no minor units", () => {
    const salary = parseSalary({ salaryText: "¥12,000,000 per year" })
    expect(salary?.currency).toBe("JPY")
    expect(amount(salary!.annualMin)).toBe("12000000")
  })

  it("reads sterling, rupees, dirhams, riyals and francs", () => {
    expect(parseSalary({ salaryText: "£60,000 per year" })?.currency).toBe("GBP")
    expect(parseSalary({ salaryText: "₹2,400,000 per year" })?.currency).toBe("INR")
    expect(parseSalary({ salaryText: "AED 240,000 per year" })?.currency).toBe("AED")
    expect(parseSalary({ salaryText: "SAR 180,000 per year" })?.currency).toBe("SAR")
    expect(parseSalary({ salaryText: "CHF 110,000 per year" })?.currency).toBe("CHF")
    expect(parseSalary({ salaryText: "C$95,000 per year" })?.currency).toBe("CAD")
    expect(parseSalary({ salaryText: "S$80,000 per year" })?.currency).toBe("SGD")
  })

  it("does not mistake a bonus percentage for pay", () => {
    const salary = parseSalary({ salaryText: "$100,000 per year plus 20% bonus" })
    expect(amount(salary!.min)).toBe("100000")
    expect(amount(salary!.max)).toBe("100000")
  })

  it("returns null when there is nothing at all to read", () => {
    expect(parseSalary({})).toBeNull()
    expect(parseSalary({ salaryText: "   " })).toBeNull()
  })

  it("reports a prose line as having no figure", () => {
    const salary = parseSalary({ salaryText: "Competitive" })
    expect(salary?.reason).toBe("NO_FIGURE")
    expect(salary?.min).toBeNull()
    expect(salary?.currency).toBeNull()
  })

  it("reports a currency line with no figure as NO_FIGURE", () => {
    const salary = parseSalary({ salaryText: "$ competitive" })
    expect(salary?.reason).toBe("NO_FIGURE")
    expect(salary?.min).toBeNull()
  })

  it("leaves a bare figure unvalued rather than reading it as USD", () => {
    const salary = parseSalary({ salaryText: "45,000" })
    expect(salary?.currency).toBeNull()
    expect(salary?.min).toBeNull()
    expect(salary?.reason).toBe("NO_FIGURE")
  })

  it("marks a pay word with no currency as UNKNOWN_CURRENCY, never USD", () => {
    const salary = parseSalary({ salaryText: "Salary: 45,000 per month" })
    expect(salary?.reason).toBe("UNKNOWN_CURRENCY")
    expect(salary?.currency).toBeNull()
    expect(amount(salary!.min)).toBe("45000")
    expect(salary?.annualMin).toBeNull()
    expect(hasComparableAnnualRange(salary)).toBe(false)
  })

  it("refuses a line that names two currencies", () => {
    const salary = parseSalary({ salaryText: "$60,000 - ₱3,000,000" })
    expect(salary?.reason).toBe("MULTIPLE_CURRENCIES")
    expect(salary?.min).toBeNull()
    expect(salary?.currency).toBeNull()
  })

  it("refuses a line that names two pay periods", () => {
    const salary = parseSalary({ salaryText: "USD 5,000 per month, 60,000 per year" })
    expect(salary?.reason).toBe("UNKNOWN_PERIOD")
    expect(salary?.annualMin).toBeNull()
  })

  it("reads a contract total only with a term", () => {
    const withoutTerm = parseSalary({ salaryText: "$60,000 contract total" })
    expect(withoutTerm?.period).toBe("CONTRACT")
    expect(withoutTerm?.reason).toBe("CONTRACT_TERM_MISSING")
    expect(withoutTerm?.annualMin).toBeNull()

    const withTerm = parseSalary({
      salaryText: "$60,000 contract total",
      termMonths: 6,
    })
    expect(withTerm?.termMonths).toBe(6)
    expect(amount(withTerm!.annualMin)).toBe("120000")
    expect(withTerm?.reason).toBeNull()
  })
})

describe("parseSalary — structured amounts", () => {
  it("reads a structured range with explicit currency and period", () => {
    const salary = parseSalary({
      salaryMin: "80000",
      salaryMax: "100000",
      currency: "PHP",
      period: "MONTHLY",
      provenance: "USER_ENTERED",
    })
    expect(salary?.currency).toBe("PHP")
    expect(amount(salary!.annualMin)).toBe("960000")
    expect(amount(salary!.annualMax)).toBe("1200000")
    expect(salary?.provenance).toBe("USER_ENTERED")
    expect(salary?.raw).toBeNull()
  })

  it("treats a single bound as both ends of the range", () => {
    const salary = parseSalary({ salaryMin: 50000, currency: "USD", period: "YEARLY" })
    expect(amount(salary!.min)).toBe("50000")
    expect(amount(salary!.max)).toBe("50000")
  })

  it("prefers the structured figure over the text", () => {
    const salary = parseSalary({
      salaryMin: 40000,
      salaryMax: 40000,
      currency: "PHP",
      period: "MONTHLY",
      salaryText: "competitive",
    })
    expect(amount(salary!.annualMin)).toBe("480000")
  })

  it("ignores an unsupported currency code instead of guessing one", () => {
    const salary = parseSalary({
      salaryMin: 50000,
      salaryMax: 60000,
      currency: "XYZ",
      period: "YEARLY",
    })
    expect(salary?.currency).toBeNull()
    expect(salary?.reason).toBe("UNKNOWN_CURRENCY")
    expect(salary?.annualMin).toBeNull()
  })

  it("ignores an unsupported period instead of assuming yearly", () => {
    const salary = parseSalary({
      salaryMin: 50000,
      currency: "USD",
      period: "FORTNIGHTLY",
    })
    expect(salary?.period).toBeNull()
    expect(salary?.reason).toBe("UNKNOWN_PERIOD")
  })

  it("rejects an inverted range instead of quietly reordering it", () => {
    // Accepting "$80,000 - $60,000" as 60k–80k turns a data-entry error into a
    // confident wrong number, and makes SalaryReason.INVALID_RANGE unreachable.
    const fromText = parseSalary({ salaryText: "$80,000 - $60,000 per year" })
    expect(fromText?.reason).toBe("INVALID_RANGE")
    expect(fromText?.annualMin).toBeNull()

    const structured = parseSalary({
      salaryMin: 80000,
      salaryMax: 60000,
      currency: "USD",
      period: "YEARLY",
    })
    expect(structured?.reason).toBe("INVALID_RANGE")
    expect(structured?.annualMin).toBeNull()
  })

  it("rejects a non-positive structured amount as nothing to read", () => {
    // Zero and negatives are not payable figures, so they are not salaries at
    // all: there is nothing to normalize, not a range to compare.
    expect(parseSalary({ salaryMin: 0, currency: "USD", period: "YEARLY" })).toBeNull()
    expect(parseSalary({ salaryMin: -500, currency: "USD", period: "MONTHLY" })).toBeNull()
    expect(parseSalary({ salaryMax: -1, currency: "PHP", period: "HOURLY" })).toBeNull()
  })

  it("ignores a non-numeric structured figure", () => {
    const salary = parseSalary({ salaryMin: "not a number", salaryText: null })
    expect(salary).toBeNull()
  })
})

describe("parseStoredSalary", () => {
  it("reads the job columns", () => {
    const salary = parseStoredSalary({
      salaryMin: new Decimal("30000"),
      salaryMax: new Decimal("45000"),
      salaryCurrency: "PHP",
      salaryPeriod: SalaryPeriod.MONTHLY,
      salaryText: "₱30,000 - ₱45,000 per month",
      salaryProvenance: "POSTING_TEXT",
    })
    expect(salary?.currency).toBe("PHP")
    expect(amount(salary!.annualMax)).toBe("540000")
    expect(salary?.provenance).toBe("POSTING_TEXT")
  })

  it("returns null for a row with no salary columns", () => {
    expect(parseStoredSalary({})).toBeNull()
    expect(
      parseStoredSalary({
        salaryMin: null,
        salaryMax: null,
        salaryText: null,
        salaryCurrency: null,
      })
    ).toBeNull()
  })

  it("keeps a legacy text-only row readable", () => {
    const salary = parseStoredSalary({ salaryText: "$120,000 per year" })
    expect(salary?.currency).toBe("USD")
    expect(amount(salary!.annualMin)).toBe("120000")
  })
})

describe("toSalaryColumns", () => {
  it("maps every normalized field onto a column", () => {
    const now = new Date("2026-11-22T10:00:00Z")
    const salary = parseSalary({ salaryText: "$120,000 - $150,000 per year" })
    const columns = toSalaryColumns(salary, now)

    expect(columns.salaryCurrency).toBe("USD")
    expect(columns.salaryPeriod).toBe("YEARLY")
    expect(columns.salaryMin?.toFixed()).toBe("120000")
    expect(columns.salaryMax?.toFixed()).toBe("150000")
    expect(columns.salaryAnnualMin?.toFixed()).toBe("120000")
    expect(columns.salaryAnnualMax?.toFixed()).toBe("150000")
    expect(columns.salaryText).toBe("$120,000 - $150,000 per year")
    expect(columns.salaryProvenance).toBe("POSTING_TEXT")
    expect(columns.salaryNormalizedAt).toEqual(now)
  })

  it("leaves normalizedAt null when no annual range was established", () => {
    const columns = toSalaryColumns(parseSalary({ salaryText: "€60,000" }))
    expect(columns.salaryCurrency).toBe("EUR")
    expect(columns.salaryAnnualMin).toBeNull()
    expect(columns.salaryNormalizedAt).toBeNull()
  })

  it("does not invent a posting text for a typed figure", () => {
    const columns = toSalaryColumns(
      parseSalary({ salaryMin: 50000, currency: "USD", period: "YEARLY" })
    )
    expect(columns.salaryText).toBeNull()
  })

  it("is all nulls for an empty reading", () => {
    expect(toSalaryColumns(null)).toEqual({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      salaryTermMonths: null,
      salaryText: null,
      salaryProvenance: null,
      salaryAnnualMin: null,
      salaryAnnualMax: null,
      salaryNormalizedAt: null,
    })
  })
})

describe("hasComparableAnnualRange", () => {
  it("requires both annual bounds and a currency", () => {
    const comparable = parseSalary({ salaryText: "USD 50/hr" })
    expect(hasComparableAnnualRange(comparable)).toBe(true)
    expect(hasComparableAnnualRange(null)).toBe(false)
  })

  it("narrows the type so callers can read the bounds", () => {
    const salary: NormalizedSalary = parseSalary({ salaryText: "USD 50/hr" })!
    if (hasComparableAnnualRange(salary)) {
      expect(salary.annualMin.mul(2).toFixed()).toBe("208000")
      expect(salary.currency).toBe("USD")
    } else {
      throw new Error("expected a comparable range")
    }
  })
})

describe("salaryReasonLabel", () => {
  it("explains every reason in a sentence", () => {
    for (const reason of [
      "NO_FIGURE",
      "UNKNOWN_CURRENCY",
      "MULTIPLE_CURRENCIES",
      "UNKNOWN_PERIOD",
      "CONTRACT_TERM_MISSING",
      "INVALID_RANGE",
    ] as const) {
      expect(salaryReasonLabel(reason)).toMatch(/\.$/)
    }
    expect(salaryReasonLabel(null)).toBeNull()
  })
})
