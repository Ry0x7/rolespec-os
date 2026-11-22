import { describe, expect, it } from "vitest"

import { SalaryCurrency } from "@/generated/prisma/enums"

import {
  CURRENCY_REGISTRY,
  SUPPORTED_CURRENCIES,
  currencyDecimals,
  currencyLabel,
  currencyMeta,
  currencyOptions,
  isCurrencyCode,
} from "../currencies"

describe("SUPPORTED_CURRENCIES", () => {
  it("matches the Prisma SalaryCurrency enum exactly", () => {
    // The enum is a Postgres type, so a currency the app supports but the
    // database does not would fail at write time, and one the database supports
    // but the app ignores would be silently unselectable.
    expect([...SUPPORTED_CURRENCIES].sort()).toEqual(
      Object.values(SalaryCurrency).sort()
    )
  })

  it("contains every ISO code the product promised", () => {
    for (const code of [
      "PHP",
      "USD",
      "EUR",
      "GBP",
      "AUD",
      "CAD",
      "SGD",
      "JPY",
      "INR",
      "AED",
      "SAR",
      "NZD",
      "CHF",
    ]) {
      expect(SUPPORTED_CURRENCIES).toContain(code)
    }
  })

  it("has a registry entry for every supported code and nothing else", () => {
    expect(Object.keys(CURRENCY_REGISTRY).sort()).toEqual([...SUPPORTED_CURRENCIES].sort())
    for (const code of SUPPORTED_CURRENCIES) {
      expect(CURRENCY_REGISTRY[code].code).toBe(code)
      expect(CURRENCY_REGISTRY[code].symbol.length).toBeGreaterThan(0)
      expect(CURRENCY_REGISTRY[code].name.length).toBeGreaterThan(0)
    }
  })
})

describe("currencyDecimals", () => {
  it("gives yen zero minor units and everything else two", () => {
    expect(currencyDecimals("JPY")).toBe(0)
    for (const code of SUPPORTED_CURRENCIES.filter((c) => c !== "JPY")) {
      expect(currencyDecimals(code)).toBe(2)
    }
  })

  it("defaults to two for a missing code", () => {
    expect(currencyDecimals(null)).toBe(2)
    expect(currencyDecimals(undefined)).toBe(2)
  })
})

describe("isCurrencyCode", () => {
  it("accepts a supported ISO code", () => {
    expect(isCurrencyCode("PHP")).toBe(true)
    expect(isCurrencyCode("CHF")).toBe(true)
  })

  it("rejects lowercase, unknown codes and non-strings", () => {
    expect(isCurrencyCode("usd")).toBe(false)
    expect(isCurrencyCode("XXX")).toBe(false)
    expect(isCurrencyCode("")).toBe(false)
    expect(isCurrencyCode(null)).toBe(false)
    expect(isCurrencyCode(undefined)).toBe(false)
    expect(isCurrencyCode(840)).toBe(false)
    expect(isCurrencyCode({ code: "USD" })).toBe(false)
  })

  it("rejects inherited Object keys", () => {
    expect(isCurrencyCode("toString")).toBe(false)
    expect(isCurrencyCode("constructor")).toBe(false)
  })
})

describe("currencyMeta", () => {
  it("returns the registry entry", () => {
    expect(currencyMeta("JPY")).toEqual({
      code: "JPY",
      name: "Japanese yen",
      symbol: "¥",
      decimals: 0,
    })
  })
})

describe("currencyLabel", () => {
  it("leads with the ISO code so a select scans predictably", () => {
    expect(currencyLabel("PHP")).toMatch(/^PHP — /)
    expect(currencyLabel("CHF")).toMatch(/^CHF — /)
    expect(currencyLabel("AED")).toContain("د.إ")
  })
})

describe("currencyOptions", () => {
  it("offers all thirteen codes in registry order", () => {
    const options = currencyOptions()
    expect(options).toHaveLength(SUPPORTED_CURRENCIES.length)
    expect(options.map((option) => option.value)).toEqual([...SUPPORTED_CURRENCIES])
    expect(options[0]!.label).toMatch(/^USD/)
  })
})
