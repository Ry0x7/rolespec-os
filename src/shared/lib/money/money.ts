import Decimal from "decimal.js"

import type { SalaryPeriod } from "@/generated/prisma/enums"

import {
  CURRENCY_REGISTRY,
  currencyDecimals,
  type CurrencyCode,
} from "./currencies"

/**
 * Money arithmetic for salary capture, normalization and display.
 *
 * Every figure goes through `decimal.js`, never `number`: 0.1 + 0.2 is a real
 * bug the first time an hourly rate is annualized, and a salary is exactly the
 * kind of figure a user will compare to a payslip.
 *
 * Amounts are stored in the currency's own major unit (`45000.5` PHP is
 * forty-five thousand pesos and fifty centavos), rounded to that currency's
 * minor-unit scale. Yen has none, so 12,000.4 JPY is not a payable amount and
 * is rounded to 12,000 before it is stored or shown.
 */

export type DecimalLike = Decimal | string | number

/** Rounding for money: the one a payroll system expects. */
export const MONEY_ROUNDING = Decimal.ROUND_HALF_UP

/** `DECIMAL(14,2)` holds twelve integer digits; reject anything larger early. */
export const MAX_MONEY = "999999999999.99"

export function dec(value: DecimalLike): Decimal {
  if (value instanceof Decimal) return value
  return new Decimal(value)
}

/** True when the value is a finite, parseable decimal. */
export function isDecimalLike(value: unknown): value is DecimalLike {
  if (value instanceof Decimal) return value.isFinite()
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "string") {
    if (value.trim() === "") return false
    try {
      return new Decimal(value.trim()).isFinite()
    } catch {
      return false
    }
  }
  return false
}

/** Rounds to the currency's minor-unit scale. Never changes the sign. */
export function roundMoney(value: DecimalLike, currency: CurrencyCode): Decimal {
  return dec(value).toDecimalPlaces(currencyDecimals(currency), MONEY_ROUNDING)
}

/**
 * Reads a figure a person typed. Accepts `45 000`, `45,000.50`, `45000,50`
 * and `1234.5`; rejects anything with letters or two decimal separators.
 *
 * The comma heuristic is the usual one: when both separators appear, the last
 * one is the decimal point. A lone comma with one or two trailing digits is a
 * decimal comma, otherwise it is a thousands separator — so `1,234` stays one
 * thousand two hundred and thirty-four.
 */
export function parseAmountInput(raw: string): Decimal | null {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  if (!/^[\d\s._,]+$/.test(trimmed)) return null

  const compact = trimmed.replace(/[\s_]/g, "")
  const lastDot = compact.lastIndexOf(".")
  const lastComma = compact.lastIndexOf(",")

  let normalized: string
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalIndex = Math.max(lastDot, lastComma)
    const rawInteger = compact.slice(0, decimalIndex)
    const integerPart = rawInteger.replace(/[.,]/g, "")
    const fractionPart = compact.slice(decimalIndex + 1)
    if (!/^\d*$/.test(fractionPart)) return null
    // The discarded separator must have been grouping thousands, not a second
    // decimal point: `1,234.56` is fine, `1.2.3` is not a number a person read
    // off a payslip.
    if (!/^\d{1,3}(?:[.,]\d{3})*$/.test(rawInteger)) return null
    normalized = fractionPart === "" ? integerPart : `${integerPart}.${fractionPart}`
  } else if (lastComma >= 0) {
    const parts = compact.split(",")
    const digitsAfter = compact.length - lastComma - 1
    if (parts.length === 2 && digitsAfter > 0 && digitsAfter <= 2) {
      normalized = `${parts[0]}.${parts[1]}`
    } else {
      normalized = compact.replace(/,/g, "")
    }
  } else {
    normalized = compact
  }

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  try {
    const value = new Decimal(normalized)
    if (!value.isFinite() || value.isNegative()) return null
    return value
  } catch {
    return null
  }
}

/** The value at the currency's scale, as a string Prisma can store. */
export function toMoneyString(value: DecimalLike, currency: CurrencyCode): string {
  return roundMoney(value, currency).toFixed(currencyDecimals(currency))
}

/** A value that round-trips through JSON without losing precision. */
export function serializeMoney(value: DecimalLike | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return dec(value).toFixed()
}

export const PAY_PERIOD_LABELS: Record<SalaryPeriod, string> = {
  HOURLY: "per hour",
  DAILY: "per day",
  WEEKLY: "per week",
  MONTHLY: "per month",
  YEARLY: "per year",
  CONTRACT: "total contract",
}

export const PAY_PERIOD_SELECT_LABELS: Record<SalaryPeriod, string> = {
  HOURLY: "Hourly",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
  CONTRACT: "Contract total",
}

export function payPeriodLabel(period: SalaryPeriod | null | undefined): string | null {
  return period ? PAY_PERIOD_LABELS[period] : null
}

export interface FormatMoneyOptions {
  /** BCP 47 tag. Defaults to the app locale so server output is deterministic. */
  locale?: string
  /** Fixed fraction digits; defaults to "none for whole amounts, currency scale otherwise". */
  fractionDigits?: number
  /** Show the ISO code even when a symbol exists, e.g. `SAR 45,000`. */
  showCode?: boolean
}

export function formatMoney(
  amount: DecimalLike,
  currency: CurrencyCode,
  options: FormatMoneyOptions = {}
): string {
  const locale = options.locale ?? "en"
  const value = dec(amount)
  const digits = options.fractionDigits ?? (value.isInteger() ? 0 : currencyDecimals(currency))

  const number = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value.toNumber())

  // Intl renders some codes as a bare code (CHF, SAR) and some as a glyph.
  // When the caller asked for the code, keep it in front so a column of figures
  // is unambiguous even if the glyph is unfamiliar.
  return options.showCode && !number.includes(currency)
    ? `${currency} ${number.trim()}`
    : number
}

/** `$215,000 – $235,000`; collapses to one figure when both bounds match. */
export function formatMoneyRange(
  min: DecimalLike | null | undefined,
  max: DecimalLike | null | undefined,
  currency: CurrencyCode,
  options: FormatMoneyOptions = {}
): string | null {
  if (min === null || min === undefined) {
    return max === null || max === undefined ? null : formatMoney(max, currency, options)
  }
  if (max === null || max === undefined) return formatMoney(min, currency, options)
  const low = dec(min)
  const high = dec(max)
  if (low.equals(high)) return formatMoney(low, currency, options)
  return `${formatMoney(low, currency, options)} – ${formatMoney(high, currency, options)}`
}

/** `$215,000 – $235,000 per year`. */
export function formatSalaryRange(
  min: DecimalLike | null | undefined,
  max: DecimalLike | null | undefined,
  currency: CurrencyCode,
  period: SalaryPeriod | null | undefined,
  options: FormatMoneyOptions = {}
): string | null {
  const range = formatMoneyRange(min, max, currency, options)
  if (!range) return null
  const suffix = payPeriodLabel(period)
  return suffix ? `${range} ${suffix}` : range
}

/**
 * A short, unambiguous label for a currency in dense UI (a badge, a table
 * cell): the ISO code and its symbol, never a guessed locale symbol.
 */
export function compactCurrencyLabel(code: CurrencyCode): string {
  return `${code} ${CURRENCY_REGISTRY[code].symbol}`.trim()
}
