import { describe, it, expect } from "vitest"
import {
  SALARY_CURRENCY_OPTIONS,
  SALARY_PERIOD_OPTIONS,
  WORK_TYPE_OPTIONS,
  annualizeSalary,
  convertSalary,
  formatSalary,
  formatSalaryEquivalents,
  salaryEquivalentsHint,
} from "../job-form-options"

/** Fixed rate so every expectation below is checkable arithmetic. */
const FX_RATE = 58

describe("formatSalary", () => {
  it("suffixes each period", () => {
    expect(formatSalary(85000, "YEARLY")).toBe("$85,000 / year")
    expect(formatSalary(4500, "MONTHLY")).toBe("$4,500 / month")
    expect(formatSalary(25, "HOURLY")).toBe("$25 / hour")
  })

  it("falls back to yearly for rows saved before the field existed", () => {
    expect(formatSalary(85000, null)).toBe("$85,000 / year")
    expect(formatSalary(85000, undefined)).toBe("$85,000 / year")
  })

  it("prefixes the peso sign for PHP", () => {
    expect(formatSalary(80000, "MONTHLY", "PHP")).toBe("₱80,000 / month")
  })

  it("treats a missing currency as USD", () => {
    expect(formatSalary(85000, "YEARLY", null)).toBe("$85,000 / year")
  })
})

describe("annualizeSalary", () => {
  it("scales each period to a year", () => {
    expect(annualizeSalary(50, "HOURLY")).toBe(104000)
    expect(annualizeSalary(80000, "MONTHLY")).toBe(960000)
    expect(annualizeSalary(185000, "YEARLY")).toBe(185000)
  })

  it("reads a missing period as yearly", () => {
    expect(annualizeSalary(185000, null)).toBe(185000)
    expect(annualizeSalary(185000, undefined)).toBe(185000)
  })
})

describe("convertSalary", () => {
  it("converts in both directions", () => {
    expect(convertSalary(1000, "USD", "PHP", FX_RATE)).toBe(58000)
    expect(convertSalary(58000, "PHP", "USD", FX_RATE)).toBe(1000)
  })

  it("leaves a same-currency amount alone", () => {
    expect(convertSalary(1000, "USD", "USD", FX_RATE)).toBe(1000)
  })
})

describe("formatSalaryEquivalents", () => {
  it("shows the yearly figure in both currencies for a sub-yearly period", () => {
    expect(formatSalaryEquivalents(80000, "MONTHLY", "PHP", FX_RATE, "USD")).toBe(
      "≈ ₱960,000 / year · $16,552 / year"
    )
    expect(formatSalaryEquivalents(50, "HOURLY", "USD", FX_RATE, "PHP")).toBe(
      "≈ $104,000 / year · ₱6,032,000 / year"
    )
  })

  it("shows only the preferred currency when the stored figure is already yearly", () => {
    expect(formatSalaryEquivalents(185000, "YEARLY", "USD", FX_RATE, "PHP")).toBe(
      "≈ ₱10,730,000 / year"
    )
    expect(formatSalaryEquivalents(185000, null, null, FX_RATE, "PHP")).toBe(
      "≈ ₱10,730,000 / year"
    )
  })

  it("converts into USD when that is the preferred currency", () => {
    expect(formatSalaryEquivalents(1160000, "YEARLY", "PHP", FX_RATE, "USD")).toBe(
      "≈ $20,000 / year"
    )
  })

  it("still annualises a sub-yearly salary already in the preferred currency", () => {
    // Nothing to convert, but the yearly figure is not in the line above.
    expect(formatSalaryEquivalents(80000, "MONTHLY", "PHP", FX_RATE, "PHP")).toBe(
      "≈ ₱960,000 / year"
    )
    expect(formatSalaryEquivalents(50, "HOURLY", "USD", FX_RATE, "USD")).toBe(
      "≈ $104,000 / year"
    )
  })

  it("returns null only when a preferred-currency salary is already yearly", () => {
    expect(formatSalaryEquivalents(185000, "YEARLY", "USD", FX_RATE, "USD")).toBeNull()
    expect(formatSalaryEquivalents(960000, "YEARLY", "PHP", FX_RATE, "PHP")).toBeNull()
    // A missing currency reads as USD, so a USD preference drops the line too.
    expect(formatSalaryEquivalents(185000, null, null, FX_RATE, "USD")).toBeNull()
  })
})

describe("salaryEquivalentsHint", () => {
  it("quotes the rate when the line was actually converted", () => {
    expect(salaryEquivalentsHint(FX_RATE, "USD", "PHP")).toBe(
      "Approximate yearly equivalent, converted at ₱58.00 per US$1"
    )
    expect(salaryEquivalentsHint(FX_RATE, "PHP", "USD")).toBe(
      "Approximate yearly equivalent, converted at ₱58.00 per US$1"
    )
  })

  it("drops the rate on a same-currency line, which did no conversion", () => {
    expect(salaryEquivalentsHint(FX_RATE, "PHP", "PHP")).toBe(
      "Approximate yearly equivalent"
    )
    // A missing currency reads as USD here too.
    expect(salaryEquivalentsHint(FX_RATE, null, "USD")).toBe(
      "Approximate yearly equivalent"
    )
  })
})

describe("SALARY_PERIOD_OPTIONS", () => {
  it("offers every period with a label", () => {
    expect(SALARY_PERIOD_OPTIONS).toEqual([
      { value: "HOURLY", label: "Hourly" },
      { value: "MONTHLY", label: "Monthly" },
      { value: "YEARLY", label: "Yearly" },
    ])
  })
})

describe("WORK_TYPE_OPTIONS", () => {
  it("offers every work type with a label", () => {
    expect(WORK_TYPE_OPTIONS).toEqual([
      { value: "REMOTE", label: "Remote (WFH)" },
      { value: "HYBRID", label: "Hybrid" },
      { value: "ONSITE", label: "On-site" },
    ])
  })
})

describe("SALARY_CURRENCY_OPTIONS", () => {
  it("offers both currencies", () => {
    expect(SALARY_CURRENCY_OPTIONS).toEqual([
      { value: "USD", label: "USD" },
      { value: "PHP", label: "PHP" },
    ])
  })
})
