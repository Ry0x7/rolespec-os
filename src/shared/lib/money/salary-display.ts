import type Decimal from "decimal.js"

import type { SalaryPeriod } from "@/generated/prisma/enums"

import {
  convertForDisplay,
  fxRateCaption,
  fxUnavailableMessage,
  type FxFailureReason,
  type FxRateSet,
} from "@/shared/lib/fx"
import type { CurrencyCode } from "@/shared/lib/money/currencies"
import {
  formatMoneyRange,
  formatSalaryRange,
  type DecimalLike,
} from "@/shared/lib/money/money"
import { annualizeAmount, salaryReasonLabel, type SalaryReason } from "@/features/ranking/salary"

/**
 * One place that decides how pay is written on screen.
 *
 * Every surface (job row, job detail, application card, profile preference)
 * needs the same three answers: what the posting says, what it is roughly worth
 * in the reader's currency, and how trustworthy that second figure is. Keeping
 * the wording together means the rate date and the "no rate available" caveat
 * cannot drift between screens — and no caller can quietly print a converted
 * number without saying which day it came from.
 */

export interface SalaryDisplayInput {
  min: DecimalLike | null
  /** Omitted means a single figure. */
  max?: DecimalLike | null
  /** Bounds expressed per year in the posting's currency, when normalization read them. */
  annualMin?: DecimalLike | null
  annualMax?: DecimalLike | null
  currency: CurrencyCode | null
  period: SalaryPeriod | null
  /** The posting's own words, used when there are no figures to format. */
  text?: string | null
  /** Why the figures could not be read as a comparable range, if they could not. */
  reason?: SalaryReason | null
}

export interface SalaryDisplayOptions {
  /** The reader's currency. Equals `input.currency` when no conversion is wanted. */
  preferredCurrency: CurrencyCode
  /** Null when rates are still loading or could not be fetched at all. */
  rates: FxRateSet | null
  /** Present only when the last lookup failed, so the UI can explain the gap. */
  failure?: FxFailureReason | null
  locale?: string
}

function annualFrom(
  amount: DecimalLike | null,
  period: SalaryPeriod | null
): Decimal | null {
  if (amount === null || period === null || period === "YEARLY") return null
  return annualizeAmount(amount, period)
}

export interface SalaryDisplay {
  /** `$120,000 – $150,000 per year`; the posting's own wording when unparsed. */
  primary: string | null
  /** Annual equivalent in the reader's currency, only when a real rate exists. */
  equivalent: string | null
  /** `2026-11-22 · frankfurter`, or why the equivalent is missing. */
  equivalentNotice: string | null
  /** Why the pay could not be read as a comparable range, when that applies. */
  caveat: string | null
}



export function describeSalary(
  input: SalaryDisplayInput,
  options: SalaryDisplayOptions
): SalaryDisplay {
  const caveat = salaryReasonLabel(input.reason ?? null)
  const max = input.max ?? null
  const hasFigures = input.min !== null || max !== null

  if (!hasFigures) {
    const text = input.text?.trim() || null
    return {
      primary: text,
      equivalent: null,
      equivalentNotice: null,
      caveat: caveat ?? (text ? null : "The posting does not state pay."),
    }
  }

  if (!input.currency) {
    return {
      primary: input.text?.trim() || null,
      equivalent: null,
      equivalentNotice: null,
      caveat: caveat ?? salaryReasonLabel("UNKNOWN_CURRENCY"),
    }
  }

  const currency = input.currency
  const primary =
    formatSalaryRange(input.min, max, currency, input.period, {
      locale: options.locale,
    }) ?? input.text?.trim() ?? null

  // A sub-yearly figure is never compared to a yearly preference by
  // multiplying here: normalization already stored the annual bounds through
  // the configured calendar, and those are the only honest yearly numbers.
  const yearly = input.period === "YEARLY"
  // Sub-yearly pay is annualized through the configured calendar (the same one
  // the stored `salaryAnnualMin/Max` come from), never with a multiplier invented
  // here. A contract total needs its term, which the input carries only if
  // normalization read one.
  const annualMin = yearly
    ? input.min
    : (input.annualMin ?? annualFrom(input.min, input.period))
  const annualMax = yearly ? max : (input.annualMax ?? annualFrom(max, input.period))
  const comparableMin = yearly ? input.min : annualMin
  const comparableMax = yearly ? max : annualMax

  if (!yearly && annualMin === null && annualMax === null) {
    return {
      primary,
      equivalent: null,
      equivalentNotice: null,
      caveat:
        caveat ??
        (input.period === "CONTRACT"
          ? salaryReasonLabel("CONTRACT_TERM_MISSING")
          : "The posting does not say enough to compare this pay to a yearly figure."),
    }
  }

  // Same currency: the annual figure is pure arithmetic, so it needs no rate
  // and no rate date — but it still earns its line, because an hourly figure
  // is hard to weigh against a yearly budget.
  if (currency === options.preferredCurrency) {
    return {
      primary,
      equivalent: yearly
        ? null
        : formatMoneyRange(annualMin, annualMax, currency, { fractionDigits: 0 }),
      equivalentNotice: null,
      caveat,
    }
  }

  const converted = convertForDisplay(
    comparableMin ?? comparableMax!,
    currency,
    options.preferredCurrency,
    options.rates
  )

  if (!converted) {
    return {
      primary,
      equivalent: null,
      equivalentNotice: options.failure
        ? fxUnavailableMessage(options.failure, currency, options.preferredCurrency)
        : `No ${currency}→${options.preferredCurrency} rate available, so no equivalent is shown.`,
      caveat,
    }
  }

  const convert = (value: DecimalLike) =>
    convertForDisplay(value, currency, options.preferredCurrency, options.rates)

  const low = comparableMin !== null ? convert(comparableMin) : null
  const high = comparableMax !== null ? convert(comparableMax) : null

  return {
    primary,
    // An equivalent is an approximation from a daily reference rate; showing
    // centavos would imply a precision the rate does not have.
    equivalent: formatMoneyRange(
      low?.amount ?? null,
      high?.amount ?? null,
      options.preferredCurrency,
      { locale: options.locale, fractionDigits: 0 }
    ),
    equivalentNotice: fxRateCaption(options.rates!, converted.quote),
    caveat,
  }
}
