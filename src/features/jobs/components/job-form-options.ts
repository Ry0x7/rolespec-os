import {
  ApplicationStatus,
  JobType,
  SalaryCurrency,
  SalaryPeriod,
  WorkType,
} from "@/generated/prisma/enums"
import Decimal from "decimal.js"

import {
  CURRENCY_REGISTRY,
  SUPPORTED_CURRENCIES,
  currencyOptions,
} from "@/shared/lib/money/currencies"
import {
  PAY_PERIOD_SELECT_LABELS,
  formatSalaryRange,
} from "@/shared/lib/money/money"
import { payCalendar } from "@/shared/lib/money/pay-calendar"

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

export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = PAY_PERIOD_SELECT_LABELS

export const SALARY_PERIOD_OPTIONS: { value: SalaryPeriod; label: string }[] = (
  Object.keys(SALARY_PERIOD_LABELS) as SalaryPeriod[]
).map((value) => ({ value, label: SALARY_PERIOD_LABELS[value] }))

/** Symbol per currency, straight from the ISO 4217 registry. */
export const SALARY_CURRENCY_SYMBOLS: Record<SalaryCurrency, string> = Object.fromEntries(
  SUPPORTED_CURRENCIES.map((code) => [code, CURRENCY_REGISTRY[code].symbol])
) as Record<SalaryCurrency, string>

export const SALARY_CURRENCY_OPTIONS: { value: SalaryCurrency; label: string }[] =
  currencyOptions()

/**
 * The amount expressed per year, through the configured working calendar.
 * Rows with no period read as yearly (the historical default). Returns `null` for
 * a contract total, whose annual value depends on a term this call does not have.
 */
export function annualizeSalary(
  salary: Decimal | string | number | null | undefined,
  period: SalaryPeriod | null | undefined
): Decimal | null {
  if (salary === null || salary === undefined) return null
  let amount: Decimal
  try {
    amount = salary instanceof Decimal ? salary : new Decimal(String(salary))
  } catch {
    return null
  }
  if (!amount.isFinite()) return null

  const calendar = payCalendar()
  switch (period) {
    case SalaryPeriod.HOURLY:
      return amount.mul(calendar.hoursPerYear)
    case SalaryPeriod.DAILY:
      return amount.mul(calendar.daysPerYear)
    case SalaryPeriod.WEEKLY:
      return amount.mul(calendar.weeksPerYear)
    case SalaryPeriod.MONTHLY:
      return amount.mul(calendar.monthsPerYear)
    case SalaryPeriod.CONTRACT:
      return null
    default:
      return amount
  }
}

/** `$85,000 – $95,000 per year`. */
export function formatSalary(
  salary: number,
  period: SalaryPeriod | null | undefined,
  currency: SalaryCurrency
): string {
  return formatSalaryRange(salary, salary, currency, period) ?? ""
}
