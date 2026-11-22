import type { SalaryCurrency } from "@/generated/prisma/enums"

/**
 * ISO 4217 currencies RoleSpec can store.
 *
 * The list is deliberately closed: `SalaryCurrency` is a Postgres enum, so an
 * unsupported code cannot reach the database at all. `SUPPORTED_CURRENCIES`
 * must stay identical to that enum — a unit test asserts it, so adding a
 * currency means touching the schema, the migration and this table together.
 *
 * `decimals` is the currency's own minor-unit scale, not a display choice:
 * yen has no subunit, everything else here has two. Storing 12,000.5 JPY would
 * be a figure no Japanese payroll can pay, so amounts are rounded to this scale
 * on the way in and rendered with it on the way out.
 */
export type CurrencyCode = SalaryCurrency

export interface CurrencyMeta {
  /** ISO 4217 alphabetic code. */
  code: CurrencyCode
  /** English name, used when `Intl.DisplayNames` is unavailable. */
  name: string
  /** The glyph people actually recognise, used in compact amounts. */
  symbol: string
  /** Minor-unit digits. 0 for yen, 2 for the rest. */
  decimals: 0 | 2
}

export const SUPPORTED_CURRENCIES = [
  "USD",
  "PHP",
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
] as const satisfies readonly CurrencyCode[]

export const CURRENCY_REGISTRY: Record<CurrencyCode, CurrencyMeta> = {
  USD: { code: "USD", name: "US dollar", symbol: "$", decimals: 2 },
  PHP: { code: "PHP", name: "Philippine peso", symbol: "₱", decimals: 2 },
  EUR: { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
  GBP: { code: "GBP", name: "British pound", symbol: "£", decimals: 2 },
  AUD: { code: "AUD", name: "Australian dollar", symbol: "A$", decimals: 2 },
  CAD: { code: "CAD", name: "Canadian dollar", symbol: "C$", decimals: 2 },
  SGD: { code: "SGD", name: "Singapore dollar", symbol: "S$", decimals: 2 },
  JPY: { code: "JPY", name: "Japanese yen", symbol: "¥", decimals: 0 },
  INR: { code: "INR", name: "Indian rupee", symbol: "₹", decimals: 2 },
  AED: { code: "AED", name: "UAE dirham", symbol: "د.إ", decimals: 2 },
  SAR: { code: "SAR", name: "Saudi riyal", symbol: "ر.س", decimals: 2 },
  NZD: { code: "NZD", name: "New Zealand dollar", symbol: "NZ$", decimals: 2 },
  CHF: { code: "CHF", name: "Swiss franc", symbol: "CHF", decimals: 2 },
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CURRENCY_REGISTRY, value)
}

export function currencyMeta(code: CurrencyCode): CurrencyMeta {
  return CURRENCY_REGISTRY[code]
}

/** Minor-unit digits for a currency; 2 whenever the code is not in the table. */
export function currencyDecimals(code: CurrencyCode | null | undefined): number {
  return code ? CURRENCY_REGISTRY[code].decimals : 2
}

/**
 * A selector label that stays readable in a native `<select>`: the ISO code
 * first (so it sorts and scans predictably), then a localized name and the
 * symbol. `Intl.DisplayNames` gives the name in the user's locale without
 * shipping a translation table.
 */
export function currencyLabel(code: CurrencyCode, locale = "en"): string {
  const meta = CURRENCY_REGISTRY[code]
  const name = displayCurrencyName(code, locale) ?? meta.name
  return `${code} — ${name} (${meta.symbol})`
}

function displayCurrencyName(code: CurrencyCode, locale: string): string | null {
  try {
    const names = new Intl.DisplayNames([locale], { type: "currency" })
    return names.of(code) ?? null
  } catch {
    return null
  }
}

/** Native `<select>` options, stable order, no runtime lookup per render. */
export function currencyOptions(locale = "en"): Array<{ value: CurrencyCode; label: string }> {
  return SUPPORTED_CURRENCIES.map((code) => ({
    value: code,
    label: currencyLabel(code, locale),
  }))
}
