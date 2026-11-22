import Decimal from "decimal.js"
import { describe, expect, it } from "vitest"

import type { FxRateSet } from "@/shared/lib/fx"

import { describeSalary } from "../salary-display"

const RATE_DATE = "2026-11-21"

function usdBaseRates(options: { stale?: boolean } = {}): FxRateSet {
  return {
    base: "USD",
    source: "frankfurter",
    fetchedAt: `${RATE_DATE}T00:00:00.000Z`,
    stale: options.stale ?? false,
    quotes: {
      PHP: { currency: "PHP", rate: new Decimal("56.5"), rateDate: RATE_DATE },
      JPY: { currency: "JPY", rate: new Decimal("151.2"), rateDate: RATE_DATE },
    },
  }
}

describe("describeSalary — no figures", () => {
  it("falls back to the posting's own words", () => {
    const display = describeSalary(
      { min: null, max: null, currency: null, period: null, text: "Competitive" },
      { preferredCurrency: "PHP", rates: null }
    )
    expect(display.primary).toBe("Competitive")
    expect(display.equivalent).toBeNull()
    expect(display.equivalentNotice).toBeNull()
    expect(display.caveat).toBeNull()
  })

  it("says the posting does not state pay when there is no text either", () => {
    const display = describeSalary(
      { min: null, max: null, currency: null, period: null },
      { preferredCurrency: "PHP", rates: null }
    )
    expect(display.primary).toBeNull()
    expect(display.caveat).toBe("The posting does not state pay.")
  })
})

describe("describeSalary — unknown currency", () => {
  it("shows the posting text and says the currency is unstated", () => {
    const display = describeSalary(
      {
        min: new Decimal(45000),
        max: new Decimal(60000),
        currency: null,
        period: "MONTHLY",
        text: "45,000 - 60,000 monthly",
        reason: "UNKNOWN_CURRENCY",
      },
      { preferredCurrency: "PHP", rates: usdBaseRates() }
    )
    expect(display.primary).toBe("45,000 - 60,000 monthly")
    expect(display.equivalent).toBeNull()
    expect(display.caveat).toMatch(/does not say which currency/)
  })

  it("never assumes USD when the currency is missing", () => {
    const display = describeSalary(
      { min: 45000, max: 60000, currency: null, period: "YEARLY" },
      { preferredCurrency: "PHP", rates: usdBaseRates() }
    )
    expect(display.primary).toBeNull()
    expect(display.equivalent).toBeNull()
  })
})

describe("describeSalary — same currency", () => {
  it("formats the range and does not invent a conversion", () => {
    const display = describeSalary(
      {
        min: new Decimal(80000),
        max: new Decimal(120000),
        currency: "PHP",
        period: "MONTHLY",
      },
      { preferredCurrency: "PHP", rates: usdBaseRates() }
    )
    expect(display.primary).toBe("₱80,000 – ₱120,000 per month")
    // No conversion happened, so there is no rate to name — but the annual
    // figure is still useful and needs no rate to be true.
    expect(display.equivalent).toBe("₱960,000 – ₱1,440,000")
    expect(display.equivalentNotice).toBeNull()
  })
})

describe("describeSalary — cross currency", () => {
  it("converts an annual range and names the rate date", () => {
    const display = describeSalary(
      {
        min: new Decimal(120000),
        max: new Decimal(150000),
        currency: "USD",
        period: "YEARLY",
      },
      { preferredCurrency: "PHP", rates: usdBaseRates() }
    )
    expect(display.primary).toBe("$120,000 – $150,000 per year")
    expect(display.equivalent).toBe("₱6,780,000 – ₱8,475,000")
    expect(display.equivalentNotice).toBe(RATE_DATE)
  })

  it("says the rate is last-known when the set is stale", () => {
    const display = describeSalary(
      { min: 120000, max: 150000, currency: "USD", period: "YEARLY" },
      { preferredCurrency: "PHP", rates: usdBaseRates({ stale: true }) }
    )
    expect(display.equivalentNotice).toBe(`${RATE_DATE}, last known`)
  })

  it("converts into a zero-decimal currency without fractional yen", () => {
    const display = describeSalary(
      { min: 120000, max: 120000, currency: "USD", period: "YEARLY" },
      { preferredCurrency: "JPY", rates: usdBaseRates() }
    )
    expect(display.equivalent).toBe("¥18,144,000")
  })

  it("follows an inverted rate set", () => {
    const phpBase: FxRateSet = {
      base: "PHP",
      source: "frankfurter",
      fetchedAt: `${RATE_DATE}T00:00:00.000Z`,
      stale: false,
      quotes: { USD: { currency: "USD", rate: new Decimal("0.0177"), rateDate: RATE_DATE } },
    }
    const display = describeSalary(
      { min: 6780000, max: 6780000, currency: "PHP", period: "YEARLY" },
      { preferredCurrency: "USD", rates: phpBase }
    )
    expect(display.equivalent).toBe("$120,006")
    expect(display.equivalentNotice).toBe(RATE_DATE)
  })

  it("explains a timeout instead of printing a made-up number", () => {
    const display = describeSalary(
      { min: 120000, max: 150000, currency: "USD", period: "YEARLY" },
      { preferredCurrency: "PHP", rates: null, failure: "timeout" }
    )
    expect(display.equivalent).toBeNull()
    expect(display.equivalentNotice).toMatch(/did not arrive in time/)
  })

  it("explains an unreachable provider", () => {
    const display = describeSalary(
      { min: 120000, currency: "USD", period: "YEARLY" },
      { preferredCurrency: "PHP", rates: null, failure: "upstream-error" }
    )
    expect(display.equivalent).toBeNull()
    expect(display.equivalentNotice).toMatch(/unreachable/)
  })

  it("explains a missing pair when rates loaded but lack the target", () => {
    const noPhp: FxRateSet = {
      base: "USD",
      source: "frankfurter",
      fetchedAt: `${RATE_DATE}T00:00:00.000Z`,
      stale: false,
      quotes: {},
    }
    const display = describeSalary(
      { min: 120000, currency: "USD", period: "YEARLY" },
      { preferredCurrency: "PHP", rates: noPhp }
    )
    expect(display.equivalent).toBeNull()
    expect(display.equivalentNotice).toBe(
      "No USD→PHP rate available, so no equivalent is shown."
    )
  })

  it("annualizes sub-yearly pay through the configured calendar before converting", () => {
    // 50/hour × 2,080 = 104,000 a year; 60/hour = 124,800. The equivalent is a
    // yearly figure, not the hourly range repeated.
    const display = describeSalary(
      { min: 50, max: 60, currency: "USD", period: "HOURLY" },
      { preferredCurrency: "PHP", rates: usdBaseRates() }
    )
    expect(display.primary).toBe("$50 – $60 per hour")
    expect(display.equivalent).not.toBeNull()
    expect(display.equivalent).not.toBe(display.primary)
    expect(display.equivalent).toContain("₱")
    expect(display.equivalentNotice).toBe(RATE_DATE)
  })

  it("shows the annual equivalent in the posting's own currency when nothing is converted", () => {
    const display = describeSalary(
      { min: 8000, max: 9000, currency: "PHP", period: "MONTHLY" },
      { preferredCurrency: "PHP", rates: null }
    )
    expect(display.primary).toBe("₱8,000 – ₱9,000 per month")
    expect(display.equivalent).toBe("₱96,000 – ₱108,000")
    expect(display.equivalentNotice).toBeNull()
  })

  it("refuses a contract total with no term instead of guessing a length", () => {
    const display = describeSalary(
      { min: 60000, max: 60000, currency: "USD", period: "CONTRACT" },
      { preferredCurrency: "PHP", rates: usdBaseRates() }
    )
    expect(display.primary).toBe("$60,000 total contract")
    expect(display.equivalent).toBeNull()
    expect(display.caveat).toMatch(/contract/i)
  })
})

describe("describeSalary — caveats", () => {
  it("carries the parsing reason through to the screen", () => {
    const display = describeSalary(
      {
        min: null,
        max: null,
        currency: "EUR",
        period: null,
        text: "€60,000",
        reason: "UNKNOWN_PERIOD",
      },
      { preferredCurrency: "PHP", rates: null }
    )
    expect(display.caveat).toMatch(/hourly, monthly or yearly/)
  })
})
