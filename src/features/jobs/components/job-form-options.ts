import {
  ApplicationStatus,
  JobType,
  SalaryCurrency,
  SalaryPeriod,
  WorkType,
} from "@/generated/prisma/enums"

/** Status order mirrors the pipeline, so the dropdowns read top-to-bottom. */
export const STATUS_OPTIONS: { value: ApplicationStatus; label: string }[] = [
  { value: ApplicationStatus.INTERESTED, label: "Interested" },
  { value: ApplicationStatus.APPLIED, label: "Applied" },
  { value: ApplicationStatus.SCREENING, label: "Screening" },
  { value: ApplicationStatus.INTERVIEW, label: "Interview" },
  { value: ApplicationStatus.OFFER, label: "Offer" },
  { value: ApplicationStatus.REJECTED, label: "Rejected" },
  { value: ApplicationStatus.WITHDRAWN, label: "Withdrawn" },
]

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERNSHIP: "Internship",
  FREELANCE: "Freelance",
  TEMPORARY: "Temporary",
}

export const JOB_TYPE_OPTIONS: { value: JobType; label: string }[] = (
  Object.keys(JOB_TYPE_LABELS) as JobType[]
).map((value) => ({ value, label: JOB_TYPE_LABELS[value] }))

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  REMOTE: "Remote (WFH)",
  HYBRID: "Hybrid",
  ONSITE: "On-site",
}

export const WORK_TYPE_OPTIONS: { value: WorkType; label: string }[] = (
  Object.keys(WORK_TYPE_LABELS) as WorkType[]
).map((value) => ({ value, label: WORK_TYPE_LABELS[value] }))

export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = {
  HOURLY: "Hourly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
}

export const SALARY_PERIOD_OPTIONS: { value: SalaryPeriod; label: string }[] = (
  Object.keys(SALARY_PERIOD_LABELS) as SalaryPeriod[]
).map((value) => ({ value, label: SALARY_PERIOD_LABELS[value] }))

/** Suffix per period; rows saved before the field existed read as yearly. */
const SALARY_PERIOD_SUFFIXES: Record<SalaryPeriod, string> = {
  HOURLY: "hour",
  MONTHLY: "month",
  YEARLY: "year",
}

export const SALARY_CURRENCY_SYMBOLS: Record<SalaryCurrency, string> = {
  USD: "$",
  PHP: "₱",
}

export const SALARY_CURRENCY_OPTIONS: { value: SalaryCurrency; label: string }[] = (
  Object.keys(SALARY_CURRENCY_SYMBOLS) as SalaryCurrency[]
).map((value) => ({ value, label: value }))

/** Full-time hours in a year (40 × 52) — the usual hourly→yearly convention. */
const HOURS_PER_YEAR = 2080

const MONTHS_PER_YEAR = 12

/** The stored amount expressed per year. Rows with no period read as yearly. */
export function annualizeSalary(
  salary: number,
  period: SalaryPeriod | null | undefined
): number {
  switch (period) {
    case SalaryPeriod.HOURLY:
      return salary * HOURS_PER_YEAR
    case SalaryPeriod.MONTHLY:
      return salary * MONTHS_PER_YEAR
    default:
      return salary
  }
}

/** Converts between the two supported currencies; same-currency is a no-op. */
export function convertSalary(
  amount: number,
  from: SalaryCurrency,
  to: SalaryCurrency,
  usdPhpRate: number
): number {
  if (from === to) return amount
  return from === SalaryCurrency.USD ? amount * usdPhpRate : amount / usdPhpRate
}

/** e.g. `$85,000 / year`. */
export function formatSalary(
  salary: number,
  period: SalaryPeriod | null | undefined,
  currency: SalaryCurrency | null | undefined = SalaryCurrency.USD
): string {
  const symbol = SALARY_CURRENCY_SYMBOLS[currency ?? SalaryCurrency.USD]
  return `${symbol}${salary.toLocaleString()} / ${SALARY_PERIOD_SUFFIXES[period ?? SalaryPeriod.YEARLY]}`
}

/** Rows saved before the currency field existed read as USD. */
function enteredCurrency(
  currency: SalaryCurrency | null | undefined
): SalaryCurrency {
  return currency ?? SalaryCurrency.USD
}

/**
 * Explains the muted `≈` line, which otherwise reads as an unexplained number:
 * it is a yearly figure, and it is approximate.
 *
 * The rate sentence is only appended when an FX conversion actually happened.
 * A same-currency line is pure annualisation, and quoting a peso-per-dollar
 * rate next to a figure that was never converted is simply wrong.
 */
export function salaryEquivalentsHint(
  usdPhpRate: number,
  currency: SalaryCurrency | null | undefined,
  preferredCurrency: SalaryCurrency
): string {
  if (enteredCurrency(currency) === preferredCurrency) {
    return "Approximate yearly equivalent"
  }
  return `Approximate yearly equivalent, converted at ₱${usdPhpRate.toFixed(2)} per US$1`
}

/**
 * The muted second line under a salary: the yearly equivalent in the stored
 * currency (omitted when the stored figure is already yearly, since it would
 * just repeat the line above) followed by the yearly figure in the user's
 * preferred display currency — e.g. `≈ ₱960,000 / year · $16,552 / year`.
 *
 * When the salary was entered in the preferred currency there is nothing to
 * convert, so only the annualised figure is left — `≈ ₱960,000 / year`. That
 * still earns its place for an hourly or monthly salary, so it is kept; a
 * stored yearly figure would only repeat the line above, so that returns
 * `null` and the caller drops the line entirely.
 */
export function formatSalaryEquivalents(
  salary: number,
  period: SalaryPeriod | null | undefined,
  currency: SalaryCurrency | null | undefined,
  usdPhpRate: number,
  preferredCurrency: SalaryCurrency
): string | null {
  const from = enteredCurrency(currency)
  const to = preferredCurrency
  const annual = annualizeSalary(salary, period)
  const storedYearly = (period ?? SalaryPeriod.YEARLY) === SalaryPeriod.YEARLY

  if (from === to) {
    if (storedYearly) return null
    return `≈ ${formatSalary(Math.round(annual), SalaryPeriod.YEARLY, from)}`
  }

  const parts: string[] = []
  if (!storedYearly) {
    parts.push(formatSalary(Math.round(annual), SalaryPeriod.YEARLY, from))
  }
  parts.push(
    formatSalary(
      Math.round(convertSalary(annual, from, to, usdPhpRate)),
      SalaryPeriod.YEARLY,
      to
    )
  )

  return `≈ ${parts.join(" · ")}`
}
