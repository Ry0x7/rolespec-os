import type { SalaryCurrency, SalaryPeriod } from "@/generated/prisma/enums"

/**
 * Salary normalization for ranking.
 *
 * Providers publish pay as free text ("₱30,000 - ₱45,000 per month",
 * "$120k–$150k a year", "USD 50/hr") and RoleSpec stores that text plus an
 * optional structured amount. Ranking cannot compare strings, so this reads the
 * amount, currency and period once, and annualizes only when all three are
 * known.
 *
 * Deliberately no exchange rates: a PHP posting and a USD profile preference
 * produce `null` annual values and a UNKNOWN factor rather than a made-up
 * conversion. The supported currencies are the ones the schema can store.
 */

export interface NormalizedSalary {
  /** The lower bound, in the posting's own period. */
  min: number | null
  /** The upper bound, in the posting's own period. */
  max: number | null
  currency: SalaryCurrency | null
  period: SalaryPeriod | null
  /** Only set when currency and period are both known. */
  annualMin: number | null
  annualMax: number | null
}

export interface SalaryInput {
  salaryText?: string | null
  /** A structured amount, when the source published one. */
  salary?: number | null
  currency?: SalaryCurrency | null
  period?: SalaryPeriod | null
}

const HOURS_PER_YEAR = 2080

const CURRENCY_MARKERS: Array<{ currency: SalaryCurrency; pattern: RegExp }> = [
  { currency: "PHP", pattern: /(?:₱|\bphp\b|\bpesos?\b)/i },
  { currency: "USD", pattern: /(?:\$|\busd\b|\bdollars?\b)/i },
]

const HOURLY_PATTERN = /(?:\/\s*h(?:r|our)?\b|\bper\s+hour\b|\bhourly\b)/i
const MONTHLY_PATTERN = /(?:\/\s*mo(?:nth)?\b|\bper\s+month\b|\bmonthly\b)/i
const YEARLY_PATTERN =
  /(?:\/\s*yr\b|\/\s*year\b|\bper\s+(?:year|annum)\b|\ba\s+year\b|\bannual(?:ly)?\b|\byearly\b|\bp\.?a\.?\b)/i

/** A number with optional thousands separators, decimals and a `k` suffix. */
const AMOUNT_PATTERN = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?/g

function parseAmount(raw: string, suffix: string | undefined): number {
  const base = Number.parseFloat(raw.replace(/,/g, ""))
  if (!Number.isFinite(base)) return Number.NaN
  return suffix ? base * 1000 : base
}

function detectCurrency(text: string): SalaryCurrency | null {
  for (const marker of CURRENCY_MARKERS) {
    if (marker.pattern.test(text)) return marker.currency
  }
  return null
}

function detectPeriod(text: string): SalaryPeriod | null {
  if (HOURLY_PATTERN.test(text)) return "HOURLY"
  if (MONTHLY_PATTERN.test(text)) return "MONTHLY"
  if (YEARLY_PATTERN.test(text)) return "YEARLY"
  return null
}

function annualize(amount: number | null, period: SalaryPeriod | null): number | null {
  if (amount === null || period === null) return null
  if (period === "HOURLY") return Math.round(amount * HOURS_PER_YEAR)
  if (period === "MONTHLY") return Math.round(amount * 12)
  return Math.round(amount)
}

/**
 * Reads one salary line. Returns `null` when there is nothing to read at all;
 * a partially readable line returns the fields it could establish and leaves
 * the rest null.
 */
export function parseSalary(input: SalaryInput): NormalizedSalary | null {
  const text = (input.salaryText ?? "").trim()
  const structuredAmount =
    typeof input.salary === "number" && Number.isFinite(input.salary) && input.salary > 0
      ? input.salary
      : null

  if (!text && structuredAmount === null) return null

  let amounts: number[] = []
  if (text) {
    for (const match of text.matchAll(AMOUNT_PATTERN)) {
      // A percentage or a headcount is not pay. "20% bonus" and "5 days" must
      // not become the lower bound.
      const tail = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 3)
      if (/^\s*%/.test(tail)) continue
      const amount = parseAmount(match[1]!, match[2])
      if (Number.isFinite(amount) && amount > 0) amounts.push(amount)
      if (amounts.length === 2) break
    }
  }

  if (structuredAmount !== null) {
    amounts = [structuredAmount]
  }

  const min = amounts.length > 0 ? Math.min(...amounts) : null
  const max = amounts.length > 0 ? Math.max(...amounts) : null
  const currency = input.currency ?? (text ? detectCurrency(text) : null)
  const period = input.period ?? (text ? detectPeriod(text) : null)

  return {
    min,
    max,
    currency: currency ?? null,
    period: period ?? null,
    annualMin: annualize(min, currency ? period : null),
    annualMax: annualize(max, currency ? period : null),
  }
}

/** True when both ends of a comparable annual range are available. */
export function hasComparableAnnualRange(
  salary: NormalizedSalary | null
): salary is NormalizedSalary & { annualMin: number; annualMax: number } {
  return Boolean(
    salary && salary.annualMin !== null && salary.annualMax !== null && salary.currency
  )
}
