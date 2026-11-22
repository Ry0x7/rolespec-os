import Decimal from "decimal.js"
import { describe, expect, it } from "vitest"

import { SalaryCurrency, SalaryPeriod } from "@/generated/prisma/enums"

import {
  SALARY_CURRENCY_OPTIONS,
  SALARY_CURRENCY_SYMBOLS,
  SALARY_PERIOD_LABELS,
  SALARY_PERIOD_OPTIONS,
  WORK_TYPE_OPTIONS,
  annualizeSalary,
  formatSalary,
} from "../job-form-options"

describe("annualizeSalary", () => {
  it("scales each period to a year through the working calendar", () => {
    expect(annualizeSalary(50, "HOURLY")!.toFixed()).toBe("104000")
    expect(annualizeSalary(100, "DAILY")!.toFixed()).toBe("26000")
    expect(annualizeSalary(1000, "WEEKLY")!.toFixed()).toBe("52000")
    expect(annualizeSalary(80000, "MONTHLY")!.toFixed()).toBe("960000")
    expect(annualizeSalary(185000, "YEARLY")!.toFixed()).toBe("185000")
  })

  it("reads a missing period as yearly", () => {
    expect(annualizeSalary(185000, null)!.toFixed()).toBe("185000")
    expect(annualizeSalary(185000, undefined)!.toFixed()).toBe("185000")
  })

  it("returns Decimal, so no float drift creeps in", () => {
    const annual = annualizeSalary("5000.10", "MONTHLY")!
    expect(annual).toBeInstanceOf(Decimal)
    expect(annual.toFixed()).toBe("60001.2")
  })

  it("leaves a contract total alone — it needs a term this call does not have", () => {
    expect(annualizeSalary(60000, "CONTRACT")).toBeNull()
  })

  it("returns null for a missing or unusable amount", () => {
    expect(annualizeSalary(null, "HOURLY")).toBeNull()
    expect(annualizeSalary(undefined, "HOURLY")).toBeNull()
    expect(annualizeSalary("not a number", "HOURLY")).toBeNull()
  })
})

describe("formatSalary", () => {
  it("renders one figure with its period", () => {
    expect(formatSalary(85000, "YEARLY", "USD")).toBe("$85,000 per year")
    expect(formatSalary(80000, "MONTHLY", "PHP")).toBe("₱80,000 per month")
    expect(formatSalary(25, "HOURLY", "USD")).toBe("$25 per hour")
  })

  it("does not assume USD — the currency is required", () => {
    // A compile-time requirement; this asserts the runtime output is the code's
    // currency, not a dollar sign bolted on.
    expect(formatSalary(80000, "MONTHLY", "EUR")).toBe("€80,000 per month")
    expect(formatSalary(12000000, "YEARLY", "JPY")).toBe("¥12,000,000 per year")
  })
})

describe("SALARY_PERIOD_OPTIONS", () => {
  it("offers every period the schema allows, in one order", () => {
    expect(SALARY_PERIOD_OPTIONS.map((option) => option.value)).toEqual([
      "HOURLY",
      "DAILY",
      "WEEKLY",
      "MONTHLY",
      "YEARLY",
      "CONTRACT",
    ])
    expect(SALARY_PERIOD_OPTIONS).toEqual([
      { value: "HOURLY", label: "Hourly" },
      { value: "DAILY", label: "Daily" },
      { value: "WEEKLY", label: "Weekly" },
      { value: "MONTHLY", label: "Monthly" },
      { value: "YEARLY", label: "Yearly" },
      { value: "CONTRACT", label: "Contract total" },
    ])
    expect(Object.keys(SALARY_PERIOD_LABELS).sort()).toEqual(
      Object.values(SalaryPeriod).sort()
    )
  })
})

describe("SALARY_CURRENCY_OPTIONS", () => {
  it("offers every ISO currency the schema allows", () => {
    expect(SALARY_CURRENCY_OPTIONS.map((option) => option.value).sort()).toEqual(
      Object.values(SalaryCurrency).sort()
    )
    expect(SALARY_CURRENCY_OPTIONS).toHaveLength(13)
  })

  it("labels each option with its ISO code first", () => {
    for (const option of SALARY_CURRENCY_OPTIONS) {
      expect(option.label.startsWith(`${option.value} — `)).toBe(true)
    }
  })

  it("has a symbol for every currency", () => {
    expect(Object.keys(SALARY_CURRENCY_SYMBOLS).sort()).toEqual(
      Object.values(SalaryCurrency).sort()
    )
    expect(SALARY_CURRENCY_SYMBOLS.PHP).toBe("₱")
    expect(SALARY_CURRENCY_SYMBOLS.JPY).toBe("¥")
    expect(SALARY_CURRENCY_SYMBOLS.CHF).toBe("CHF")
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
