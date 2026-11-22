import Decimal from "decimal.js"

import type { SalaryPeriod, SalaryProvenance } from "@/generated/prisma/enums"

import { isCurrencyCode, type CurrencyCode } from "@/shared/lib/money/currencies"
import { dec, type DecimalLike } from "@/shared/lib/money/money"
import { payCalendar, type PayCalendar } from "@/shared/lib/money/pay-calendar"

/**
 * Salary normalization.
 *
 * Providers publish pay as free text ("₱30,000 - ₱45,000 per month",
 * "$120k–$150k a year", "USD 50/hr", "£60,000 contract") and RoleSpec also
 * accepts a structured amount. Ranking cannot compare strings, so this reads
 * the figures, currency and period once and annualizes only when the period is
 * actually known.
 *
 * Three rules, because each one has a user-visible failure behind it:
 *
 * 1. **No exchange rates here.** A PHP posting and a USD preference stay
 *    incomparable; conversion is a display concern with its own rate metadata.
 * 2. **No assumed currency.** A figure with no currency marker stays
 *    `currency: null` and `reason: "UNKNOWN_CURRENCY"`. It is never read as USD.
 * 3. **No guessing from ambiguous text.** A line that mentions two currencies
 *    or two pay periods yields no figure at all, because picking one would be a
 *    made-up number.
 */

export type SalaryReason =
  | "NO_FIGURE"
  | "UNKNOWN_CURRENCY"
  | "MULTIPLE_CURRENCIES"
  | "UNKNOWN_PERIOD"
  | "CONTRACT_TERM_MISSING"
  | "INVALID_RANGE"

export interface SalaryInput {
  /** The posting's own salary line, kept verbatim for provenance. */
  salaryText?: string | null
  /** A structured lower bound, when the source published one. */
  salaryMin?: DecimalLike | null
  /** A structured upper bound. Equal to the lower bound for a single figure. */
  salaryMax?: DecimalLike | null
  currency?: CurrencyCode | string | null
  period?: SalaryPeriod | string | null
  /** Total length of a contract, in months. Only read for `CONTRACT`. */
  termMonths?: number | null
  provenance?: SalaryProvenance | null
}

export interface NormalizedSalary {
  /** Lower bound in the posting's own period and currency. */
  min: Decimal | null
  /** Upper bound in the posting's own period and currency. */
  max: Decimal | null
  currency: CurrencyCode | null
  period: SalaryPeriod | null
  termMonths: number | null
  /** Bounds expressed per year, in the same currency. Set only when the period is known. */
  annualMin: Decimal | null
  annualMax: Decimal | null
  provenance: SalaryProvenance | null
  /** Why the range is not comparable. Null when it is. */
  reason: SalaryReason | null
  /** The posting text this was read from, unchanged. */
  raw: string | null
}

/** A comparison needs both ends of a yearly range and a currency to compare in. */
export function hasComparableAnnualRange(
  salary: NormalizedSalary | null
): salary is NormalizedSalary & {
  annualMin: Decimal
  annualMax: Decimal
  currency: CurrencyCode
} {
  return Boolean(
    salary &&
      salary.annualMin !== null &&
      salary.annualMax !== null &&
      salary.currency !== null
  )
}

const CURRENCY_MARKERS: ReadonlyArray<{ currency: CurrencyCode; pattern: RegExp }> = [
  // Symbol forms that end in `$` must be tried before the bare dollar sign.
  { currency: "AUD", pattern: /(?:a\$|\baud\b)/i },
  { currency: "CAD", pattern: /(?:c\$|\bcad\b)/i },
  { currency: "SGD", pattern: /(?:s\$|\bsgd\b)/i },
  { currency: "NZD", pattern: /(?:nz\$|\bnzd\b)/i },
  { currency: "USD", pattern: /(?:(?<![a-z])\$|\busd\b|\bdollars?\b)/i },
  { currency: "PHP", pattern: /(?:₱|\bphp\b|\bpesos?\b)/i },
  { currency: "EUR", pattern: /(?:€|\beur\b|\beuros?\b)/i },
  { currency: "GBP", pattern: /(?:£|\bgbp\b|\bpounds?\b|\bsterling\b)/i },
  { currency: "JPY", pattern: /(?:¥|\bjpy\b|\byen\b)/i },
  { currency: "INR", pattern: /(?:₹|\binr\b|\brupees?\b)/i },
  { currency: "AED", pattern: /(?:\baed\b|\bdirhams?\b)/i },
  { currency: "SAR", pattern: /(?:\bsar\b|\briyals?\b)/i },
  { currency: "CHF", pattern: /(?:\bchf\b|\bfrancs?\b)/i },
]

const PERIOD_MARKERS: ReadonlyArray<{ period: SalaryPeriod; pattern: RegExp }> = [
  // Contract first: "contract total" also contains no other period word, but a
  // line can say "contract rate per month", which is a monthly figure.
  {
    period: "CONTRACT",
    pattern: /(?:(?:total|fixed)\s+contract|contract\s+(?:value|total|amount))/i,
  },
  { period: "HOURLY", pattern: /(?:\/\s*h(?:r|our)?\b|\bper\s+hour\b|\bhourly\b|\bhr\b)/i },
  { period: "DAILY", pattern: /(?:\/\s*day\b|\bper\s+day\b|\bdaily\b|\bday\s+rate\b)/i },
  { period: "WEEKLY", pattern: /(?:\/\s*w(?:k|eek)\b|\bper\s+week\b|\bweekly\b)/i },
  { period: "MONTHLY", pattern: /(?:\/\s*mo(?:nth)?\b|\bper\s+month\b|\bmonthly\b)/i },
  {
    period: "YEARLY",
    pattern:
      /(?:\/\s*(?:yr|year)\b|\bper\s+(?:year|annum)\b|\ba\s+year\b|\bannual(?:ly)?\b|\byearly\b|\bp\.?a\.?\b)/i,
  },
]

/** Words that make a number a pay figure even without a currency or period. */
const PAY_WORDS = /\b(?:salary|pay|compensation|wage|rate|stipend|package)\b/i

/**
 * A number with optional thousands separators, decimals and a `k` suffix.
 * Deliberately permissive about spacing: "45 000" and "45,000" are the same
 * figure to a human, so they are the same figure here.
 */
const AMOUNT_PATTERN = /(\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kK])?/g

const SEGMENT_SPLIT = /\s*(?:;|\||•|·|\n|\r)\s*/

function normalizeCurrency(value: unknown): CurrencyCode | null {
  return typeof value === "string" && isCurrencyCode(value) ? value : null
}

function normalizePeriod(value: unknown): SalaryPeriod | null {
  if (typeof value !== "string") return null
  return PERIOD_MARKERS.some((marker) => marker.period === value)
    ? (value as SalaryPeriod)
    : null
}

function currenciesIn(segment: string): CurrencyCode[] {
  const found: CurrencyCode[] = []
  for (const marker of CURRENCY_MARKERS) {
    if (marker.pattern.test(segment)) found.push(marker.currency)
  }
  return found
}

function periodsIn(segment: string): SalaryPeriod[] {
  const found: SalaryPeriod[] = []
  for (const marker of PERIOD_MARKERS) {
    if (marker.pattern.test(segment)) found.push(marker.period)
  }
  return found
}

interface TextAmount {
  value: Decimal
  index: number
}

function amountsIn(segment: string): TextAmount[] {
  const amounts: TextAmount[] = []
  for (const match of segment.matchAll(AMOUNT_PATTERN)) {
    const index = match.index ?? 0
    const tail = segment.slice(index + match[0].length, index + match[0].length + 3)
    // "20% bonus" is a percentage, not pay.
    if (/^\s*%/.test(tail)) continue
    const raw = match[1]!.replace(/[ ,]/g, "")
    const base = new Decimal(raw)
    // Decimal is immutable: `mul` returns a new value, it does not mutate. The
    // earlier version dropped the result, so "$120k" read as one hundred and
    // twenty dollars.
    const value = match[2] ? base.mul(1000) : base
    if (value.isFinite() && value.gt(0)) amounts.push({ value, index })
    if (amounts.length === 2) break
  }
  return amounts
}

interface TextReading {
  amounts: Decimal[]
  currencies: CurrencyCode[]
  periods: SalaryPeriod[]
  /** Two figures joined by a range separator, with the low bound written second. */
  inverted: boolean
}

/** A dash or "to" between two figures: the range form, not an amount list. */
const RANGE_SEPARATOR = /\s*(?:-|–|—|\bto\b)\s*/i

/**
 * Reads every pay-looking segment of a salary line. A segment only contributes
 * figures when it also carries a currency, a period or an explicit pay word, so
 * "5 days annual leave" and "20% bonus" cannot become the salary.
 */
function readText(text: string): TextReading {
  const amounts: Decimal[] = []
  const currencies: CurrencyCode[] = []
  const periods: SalaryPeriod[] = []
  let inverted = false

  for (const segment of text.split(SEGMENT_SPLIT)) {
    if (!segment.trim()) continue
    const segmentCurrencies = currenciesIn(segment)
    const segmentPeriods = periodsIn(segment)
    const looksLikePay =
      segmentCurrencies.length > 0 || segmentPeriods.length > 0 || PAY_WORDS.test(segment)
    if (!looksLikePay) continue

    const segmentAmounts = amountsIn(segment)
    if (segmentAmounts.length === 0) continue

    // Only a genuine `low - high` pair can be inverted. Two unrelated figures in
    // one line ("$60,000 a year plus a $5,000 bonus") are not a range, and
    // treating them as one would invent a defect that is not there.
    if (segmentAmounts.length === 2) {
      const [first, second] = segmentAmounts
      const between = segment.slice(first!.index, second!.index)
      if (RANGE_SEPARATOR.test(between) && first!.value.gt(second!.value)) {
        inverted = true
      }
    }

    amounts.push(...segmentAmounts.map((amount) => amount.value))
    currencies.push(...segmentCurrencies)
    periods.push(...segmentPeriods)
  }

  return {
    amounts: amounts.slice(0, 2),
    currencies: [...new Set(currencies)],
    periods: [...new Set(periods)],
    inverted,
  }
}

export function annualizeAmount(
  amount: DecimalLike,
  period: SalaryPeriod,
  calendar: PayCalendar = payCalendar(),
  termMonths: number | null = null
): Decimal | null {
  return annualize(dec(amount), period, calendar, termMonths)
}

function annualize(
  amount: Decimal,
  period: SalaryPeriod,
  calendar: PayCalendar,
  termMonths: number | null
): Decimal | null {
  switch (period) {
    case "HOURLY":
      return amount.mul(calendar.hoursPerYear)
    case "DAILY":
      return amount.mul(calendar.daysPerYear)
    case "WEEKLY":
      return amount.mul(calendar.weeksPerYear)
    case "MONTHLY":
      return amount.mul(calendar.monthsPerYear)
    case "YEARLY":
      return amount
    case "CONTRACT":
      if (!termMonths || termMonths <= 0) return null
      return amount.mul(calendar.monthsPerYear).div(termMonths)
    default:
      return null
  }
}

function build(
  figures: { min: Decimal | null; max: Decimal | null },
  currency: CurrencyCode | null,
  period: SalaryPeriod | null,
  termMonths: number | null,
  provenance: SalaryProvenance | null,
  raw: string | null,
  calendar: PayCalendar,
  reason: SalaryReason | null
): NormalizedSalary {
  let min = figures.min
  let max = figures.max
  let resolvedReason = reason

  if (min !== null && max !== null && min.gt(max)) {
    resolvedReason = "INVALID_RANGE"
  }

  const annualizable =
    resolvedReason === null &&
    min !== null &&
    max !== null &&
    period !== null &&
    currency !== null &&
    (period !== "CONTRACT" || (termMonths !== null && termMonths > 0))

  const annualMin = annualizable && min !== null && period ? annualize(min, period, calendar, termMonths) : null
  const annualMax = annualizable && max !== null && period ? annualize(max, period, calendar, termMonths) : null

  if (resolvedReason === null && (annualMin === null || annualMax === null)) {
    resolvedReason = period === "CONTRACT" ? "CONTRACT_TERM_MISSING" : "UNKNOWN_PERIOD"
  }

  // An invalid range keeps the two figures (they are what the user typed or the
  // posting said) but never claims a comparable range.
  if (resolvedReason === "INVALID_RANGE") {
    min = figures.min
    max = figures.max
  }

  return {
    min,
    max,
    currency,
    period,
    termMonths,
    annualMin,
    annualMax,
    provenance,
    reason: resolvedReason,
    raw,
  }
}

/**
 * Reads one salary declaration.
 *
 * Returns `null` when there is nothing to read at all (no text, no figures).
 * A partially readable line returns what it could establish and a `reason` for
 * the rest, so the UI can say "currency not stated" instead of hiding pay.
 */
export function parseSalary(
  input: SalaryInput,
  calendar: PayCalendar = payCalendar()
): NormalizedSalary | null {
  const text = (input.salaryText ?? "").trim()
  const structuredMin = isFiniteAmount(input.salaryMin) ? dec(input.salaryMin) : null
  const structuredMax = isFiniteAmount(input.salaryMax) ? dec(input.salaryMax) : null
  const hasStructured = structuredMin !== null || structuredMax !== null

  if (!text && !hasStructured) return null

  const reading = text
    ? readText(text)
    : { amounts: [], currencies: [], periods: [], inverted: false }
  const explicitCurrency = normalizeCurrency(input.currency)
  const explicitPeriod = normalizePeriod(input.period)
  const explicitTerm =
    typeof input.termMonths === "number" && Number.isFinite(input.termMonths) && input.termMonths > 0
      ? Math.round(input.termMonths)
      : null

  const provenance =
    input.provenance ?? (hasStructured ? null : text ? "POSTING_TEXT" : null)

  // Ambiguous prose is refused rather than resolved by guessing.
  if (!hasStructured) {
    if (reading.currencies.length > 1) {
      return build(
        { min: null, max: null },
        null,
        null,
        null,
        provenance,
        text || null,
        calendar,
        "MULTIPLE_CURRENCIES"
      )
    }
    if (reading.periods.length > 1) {
      return build(
        { min: null, max: null },
        reading.currencies[0] ?? explicitCurrency,
        null,
        null,
        provenance,
        text || null,
        calendar,
        "UNKNOWN_PERIOD"
      )
    }
  }

  const amounts = hasStructured
    ? [structuredMin ?? structuredMax!, structuredMax ?? structuredMin!]
    : reading.amounts

  if (amounts.length === 0) {
    return build(
      { min: null, max: null },
      explicitCurrency,
      explicitPeriod,
      explicitTerm,
      provenance,
      text || null,
      calendar,
      "NO_FIGURE"
    )
  }

  // Order is meaning: the first figure is the lower bound unless the posting
  // says otherwise. Sorting a genuinely inverted range (`$80k-$60k`) would
  // repair a defect instead of reporting it.
  const min = amounts[0]!
  const max = amounts[amounts.length - 1]!
  const invertedRange = hasStructured ? min.gt(max) : reading.inverted

  const currency =
    explicitCurrency ?? (reading.currencies.length === 1 ? reading.currencies[0]! : null)
  const period = explicitPeriod ?? (reading.periods.length === 1 ? reading.periods[0]! : null)

  if (invertedRange) {
    return build(
      { min, max },
      currency,
      period,
      explicitTerm,
      provenance,
      text || null,
      calendar,
      "INVALID_RANGE"
    )
  }

  if (currency === null) {
    return build({ min, max }, null, period, explicitTerm, provenance, text || null, calendar, "UNKNOWN_CURRENCY")
  }
  if (period === null) {
    return build({ min, max }, currency, null, explicitTerm, provenance, text || null, calendar, "UNKNOWN_PERIOD")
  }

  return build({ min, max }, currency, period, explicitTerm, provenance, text || null, calendar, null)
}

function isFiniteAmount(value: DecimalLike | null | undefined): value is DecimalLike {
  if (value === null || value === undefined) return false
  try {
    const amount = dec(value)
    // A salary is a positive figure. Zero and negatives are not payable
    // amounts, and letting one through would poison every comparison.
    return amount.isFinite() && amount.gt(0)
  } catch {
    return false
  }
}

/** Reads the salary columns of a stored `Job` or `CareerProfile` row. */
export function parseStoredSalary(row: {
  salaryMin?: DecimalLike | null
  salaryMax?: DecimalLike | null
  salaryText?: string | null
  salaryCurrency?: string | null
  salaryPeriod?: string | null
  salaryTermMonths?: number | null
  salaryProvenance?: SalaryProvenance | null
}): NormalizedSalary | null {
  return parseSalary({
    salaryMin: row.salaryMin ?? null,
    salaryMax: row.salaryMax ?? null,
    salaryText: row.salaryText ?? null,
    currency: row.salaryCurrency ?? null,
    period: row.salaryPeriod ?? null,
    termMonths: row.salaryTermMonths ?? null,
    provenance: row.salaryProvenance ?? null,
  })
}

/**
 * The columns a write should persist, derived once from a normalized reading.
 * `salaryText` is kept only when the caller had one; a figure typed into the
 * form has no posting text and must not invent one.
 */
export function toSalaryColumns(salary: NormalizedSalary | null, now: Date = new Date()) {
  if (!salary) {
    return {
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
    }
  }
  return {
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    salaryPeriod: salary.period,
    salaryTermMonths: salary.termMonths,
    salaryText: salary.raw,
    salaryProvenance: salary.provenance,
    salaryAnnualMin: salary.annualMin,
    salaryAnnualMax: salary.annualMax,
    salaryNormalizedAt: salary.annualMin !== null ? now : null,
  }
}

/** Human sentence for a reason the factor and the UI both show. */
export function salaryReasonLabel(reason: SalaryReason | null): string | null {
  switch (reason) {
    case "NO_FIGURE":
      return "The posting does not state pay."
    case "UNKNOWN_CURRENCY":
      return "The posting's pay does not say which currency it is in."
    case "MULTIPLE_CURRENCIES":
      return "The posting mentions more than one currency, so its pay cannot be read reliably."
    case "UNKNOWN_PERIOD":
      return "The posting does not say whether the pay is hourly, monthly or yearly."
    case "CONTRACT_TERM_MISSING":
      return "The posting quotes a contract total without a contract length."
    case "INVALID_RANGE":
      return "The pay range is inverted, so it cannot be compared."
    default:
      return null
  }
}
