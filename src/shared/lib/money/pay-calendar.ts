import Decimal from "decimal.js"

/**
 * The working calendar salary normalization converts through.
 *
 * Annualizing an hourly or daily rate needs a convention, and a convention is
 * an assumption. Making it explicit (and configurable) means the app can say
 * "2,080 hours a year" on screen instead of silently inventing a multiplier,
 * and a part-time or shift-based user can set their own.
 *
 * Defaults are the common full-time ones: 40 hours × 52 weeks = 2,080 hours,
 * 5 days × 52 weeks = 260 days. Weeks and months are calendar constants, not
 * working-time ones, because a weekly rate pays every week.
 */
export interface PayCalendar {
  hoursPerYear: Decimal
  daysPerYear: Decimal
  weeksPerYear: Decimal
  monthsPerYear: Decimal
}

const DEFAULT_HOURS_PER_YEAR = 2080
const DEFAULT_DAYS_PER_YEAR = 260
const WEEKS_PER_YEAR = 52
const MONTHS_PER_YEAR = 12

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

let cached: PayCalendar | null = null

export function payCalendar(): PayCalendar {
  if (cached) return cached
  cached = {
    hoursPerYear: new Decimal(
      positiveNumber(process.env.SALARY_WORKING_HOURS_PER_YEAR, DEFAULT_HOURS_PER_YEAR)
    ),
    daysPerYear: new Decimal(
      positiveNumber(process.env.SALARY_WORKING_DAYS_PER_YEAR, DEFAULT_DAYS_PER_YEAR)
    ),
    weeksPerYear: new Decimal(WEEKS_PER_YEAR),
    monthsPerYear: new Decimal(MONTHS_PER_YEAR),
  }
  return cached
}

/** Test seam — drops the cached calendar so env changes are observed. */
export function resetPayCalendar(): void {
  cached = null
}
