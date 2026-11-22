import Decimal from "decimal.js"
import { describe, expect, it } from "vitest"

import {
  dec,
  formatMoney,
  formatMoneyRange,
  formatSalaryRange,
  isDecimalLike,
  parseAmountInput,
  payPeriodLabel,
  roundMoney,
  serializeMoney,
  toMoneyString,
} from "../money"

describe("parseAmountInput", () => {
  it("reads the separator styles a person actually types", () => {
    expect(parseAmountInput("45000")?.toFixed()).toBe("45000")
    expect(parseAmountInput("45,000")?.toFixed()).toBe("45000")
    expect(parseAmountInput("45 000")?.toFixed()).toBe("45000")
    expect(parseAmountInput("45_000")?.toFixed()).toBe("45000")
    expect(parseAmountInput("45000.50")?.toFixed()).toBe("45000.5")
    expect(parseAmountInput("1,234,567.89")?.toFixed()).toBe("1234567.89")
  })

  it("treats a two-digit trailing comma as a decimal comma", () => {
    expect(parseAmountInput("45000,50")?.toFixed()).toBe("45000.5")
    expect(parseAmountInput("1.234,56")?.toFixed()).toBe("1234.56")
  })

  it("keeps a three-digit comma group as thousands", () => {
    expect(parseAmountInput("1,234")?.toFixed()).toBe("1234")
    expect(parseAmountInput("1,234,567")?.toFixed()).toBe("1234567")
  })

  it("rejects letters, empty input and malformed separators", () => {
    expect(parseAmountInput("12abc")).toBeNull()
    expect(parseAmountInput("")).toBeNull()
    expect(parseAmountInput("   ")).toBeNull()
    expect(parseAmountInput("1.2.3")).toBeNull()
    expect(parseAmountInput("1,2,3.4.5")).toBeNull()
    expect(parseAmountInput("$45000")).toBeNull()
  })

  it("rejects a negative figure", () => {
    expect(parseAmountInput("-500")).toBeNull()
  })
})

describe("roundMoney", () => {
  it("rounds half up, as payroll expects", () => {
    expect(roundMoney("0.005", "USD").toFixed(2)).toBe("0.01")
    expect(roundMoney("0.004", "USD").toFixed(2)).toBe("0.00")
    expect(roundMoney("2.675", "USD").toFixed(2)).toBe("2.68")
  })

  it("rounds yen to whole units", () => {
    expect(roundMoney("12000.4", "JPY").toFixed()).toBe("12000")
    expect(roundMoney("12000.5", "JPY").toFixed()).toBe("12001")
  })

  it("does not touch an amount already at scale", () => {
    expect(roundMoney("1234.56", "EUR").toFixed(2)).toBe("1234.56")
  })
})

describe("toMoneyString", () => {
  it("emits the currency's own scale", () => {
    expect(toMoneyString("45000", "PHP")).toBe("45000.00")
    expect(toMoneyString(45000.5, "USD")).toBe("45000.50")
    expect(toMoneyString("12000.4", "JPY")).toBe("12000")
  })
})

describe("dec / isDecimalLike", () => {
  it("passes a Decimal through untouched", () => {
    const value = new Decimal("42.5")
    expect(dec(value)).toBe(value)
    expect(dec("42.5").toFixed()).toBe("42.5")
    expect(dec(42.5).toFixed()).toBe("42.5")
  })

  it("recognises parseable values only", () => {
    expect(isDecimalLike("45000")).toBe(true)
    expect(isDecimalLike(45000)).toBe(true)
    expect(isDecimalLike(new Decimal(1))).toBe(true)
    expect(isDecimalLike("45000abc")).toBe(false)
    expect(isDecimalLike("")).toBe(false)
    expect(isDecimalLike(Number.NaN)).toBe(false)
    expect(isDecimalLike(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isDecimalLike(null)).toBe(false)
    expect(isDecimalLike({})).toBe(false)
  })
})

describe("serializeMoney", () => {
  it("round-trips through JSON without scientific notation", () => {
    expect(serializeMoney("45000.00")).toBe("45000")
    expect(serializeMoney("0.000001")).toBe("0.000001")
    expect(serializeMoney(null)).toBeNull()
    expect(serializeMoney(undefined)).toBeNull()
  })
})

describe("formatMoney", () => {
  it("drops the fraction on a whole amount and keeps it otherwise", () => {
    expect(formatMoney(45000, "USD")).toBe("$45,000")
    expect(formatMoney("45000.50", "USD")).toBe("$45,000.50")
  })

  it("renders yen without decimals", () => {
    expect(formatMoney("12000000", "JPY")).toBe("¥12,000,000")
  })

  it("can show the ISO code for an unfamiliar glyph", () => {
    // Intl separates the code with a non-breaking space, so match any space.
    expect(formatMoney(45000, "SAR", { showCode: true })).toMatch(/^SAR\s45,000$/)
  })

  it("honours a fixed fraction count", () => {
    expect(formatMoney(45000, "PHP", { fractionDigits: 2 })).toBe("₱45,000.00")
  })
})

describe("formatMoneyRange", () => {
  it("collapses an equal pair to one figure", () => {
    expect(formatMoneyRange(50000, 50000, "USD")).toBe("$50,000")
    expect(formatMoneyRange("50000", new Decimal(50000), "USD")).toBe("$50,000")
  })

  it("joins a real range", () => {
    expect(formatMoneyRange(40000, 60000, "EUR")).toBe("€40,000 – €60,000")
  })

  it("handles a one-sided range", () => {
    expect(formatMoneyRange(null, 60000, "USD")).toBe("$60,000")
    expect(formatMoneyRange(40000, null, "USD")).toBe("$40,000")
  })

  it("is null when both bounds are missing", () => {
    expect(formatMoneyRange(null, null, "USD")).toBeNull()
    expect(formatMoneyRange(undefined, undefined, "USD")).toBeNull()
  })
})

describe("formatSalaryRange / payPeriodLabel", () => {
  it("appends the period in words", () => {
    expect(formatSalaryRange(80000, 120000, "PHP", "MONTHLY")).toBe(
      "₱80,000 – ₱120,000 per month"
    )
    expect(formatSalaryRange(50, 60, "USD", "HOURLY")).toBe("$50 – $60 per hour")
  })

  it("has a suffix for every period", () => {
    expect(payPeriodLabel("HOURLY")).toBe("per hour")
    expect(payPeriodLabel("DAILY")).toBe("per day")
    expect(payPeriodLabel("WEEKLY")).toBe("per week")
    expect(payPeriodLabel("MONTHLY")).toBe("per month")
    expect(payPeriodLabel("YEARLY")).toBe("per year")
    expect(payPeriodLabel("CONTRACT")).toBe("total contract")
    expect(payPeriodLabel(null)).toBeNull()
  })

  it("omits the suffix when the period is unknown rather than assuming yearly", () => {
    expect(formatSalaryRange(120000, 150000, "USD", null)).toBe("$120,000 – $150,000")
  })
})
