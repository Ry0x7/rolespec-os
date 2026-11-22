import type { SalaryPeriod } from "@/generated/prisma/enums"

import { parseStoredSalary, type NormalizedSalary } from "@/features/ranking/salary"
import type { UserPreferences } from "@/features/settings/schemas/preferences.schema"
import type { CurrencyCode } from "@/shared/lib/money/currencies"
import type { DecimalLike } from "@/shared/lib/money/money"

import { computeOpportunityValue, hourlyCalendar } from "../value"
import {
  DEFAULT_OPPORTUNITY_SETTINGS,
  type HourlyCalendar,
  type OpportunityContext,
  type OpportunityExpectation,
  type OpportunityPosting,
  type OpportunitySettings,
  type OpportunityValue,
} from "../types"

/**
 * The seam between stored rows and the pure engine.
 *
 * Keeping the mapping here means every surface (discovery, saved jobs, detail
 * page, extension) builds the engine input the same way. In particular, the
 * salary expectation is read through the same `parseStoredSalary` the rest of
 * the app uses, so a profile stored with an unknown currency can never be read
 * as dollars on one screen and as pesos on another.
 */

/** The stored preference slice, completed with documented defaults. */
export function settingsFromPreferences(
  preferences: Pick<UserPreferences, "opportunityValue"> | null | undefined
): OpportunitySettings {
  const stored = preferences?.opportunityValue
  return {
    preset: stored?.preset ?? DEFAULT_OPPORTUNITY_SETTINGS.preset,
    weights: stored?.weights ?? null,
    minimumAnnualPay: stored?.minimumAnnualPay ?? null,
    minimumPayCurrency: stored?.minimumPayCurrency ?? null,
    minimumPayStrict: stored?.minimumPayStrict ?? false,
    workloadPreference: stored?.workloadPreference ?? "BALANCED",
    unknownPay: stored?.unknownPay ?? "FLAG",
  }
}

interface ProfileSalaryRow {
  salaryMin?: DecimalLike | null
  salaryMax?: DecimalLike | null
  salaryCurrency?: string | null
  salaryPeriod?: string | null
  salaryTermMonths?: number | null
}

/**
 * The user's annual expectation, annualized through the configured calendar.
 *
 * The bounds are stored in whichever period the user chose, so they are
 * annualized here once, in their own currency. Nothing is converted.
 */
export function expectationFromProfile(
  profile: ProfileSalaryRow | null | undefined
): OpportunityExpectation {
  if (!profile) return { annualMin: null, annualMax: null, currency: null }

  const parsed: NormalizedSalary | null = parseStoredSalary({
    salaryMin: profile.salaryMin ?? null,
    salaryMax: profile.salaryMax ?? null,
    salaryCurrency: profile.salaryCurrency ?? null,
    salaryPeriod: profile.salaryPeriod ?? null,
    salaryTermMonths: profile.salaryTermMonths ?? null,
  })

  return {
    annualMin: parsed?.annualMin ?? null,
    annualMax: parsed?.annualMax ?? null,
    currency: (parsed?.currency ?? null) as CurrencyCode | null,
    isContract: (parsed?.period ?? null) === ("CONTRACT" as SalaryPeriod),
  }
}

interface PostingRow {
  title: string
  companyName: string
  url?: string | null
  description?: string | null
  requirementFlags?: string[]
  salaryMin?: DecimalLike | null
  salaryMax?: DecimalLike | null
  salaryCurrency?: CurrencyCode | string | null
  salaryPeriod?: SalaryPeriod | string | null
  salaryTermMonths?: number | null
  salaryText?: string | null
  salaryProvenance?: string | null
}

function postingFromRow(row: PostingRow): OpportunityPosting {
  return {
    title: row.title,
    companyName: row.companyName,
    url: row.url ?? null,
    description: row.description ?? null,
    requirementFlags: row.requirementFlags ?? [],
    salary: {
      min: row.salaryMin ?? null,
      max: row.salaryMax ?? null,
      currency: (row.salaryCurrency as CurrencyCode | null) ?? null,
      period: (row.salaryPeriod as SalaryPeriod | null) ?? null,
      termMonths: row.salaryTermMonths ?? null,
      text: row.salaryText ?? null,
      // A row the user typed or the employer published is verified; a provider
      // scrape is not.
      verified: row.salaryProvenance !== "PROVIDER_STRUCTURED",
    },
  }
}

export interface ValueForJobArgs {
  posting: PostingRow
  profile: ProfileSalaryRow | null | undefined
  preferences: Pick<UserPreferences, "opportunityValue"> | null | undefined
  context?: OpportunityContext
  calendar?: HourlyCalendar
}

/** One call, one deterministic value. */
export function valueForJob(args: ValueForJobArgs): OpportunityValue {
  const calendar = args.calendar ?? hourlyCalendar()
  return computeOpportunityValue({
    posting: postingFromRow(args.posting),
    expectation: expectationFromProfile(args.profile),
    context: args.context ?? {
      fitScore: null,
      eligibility: null,
      confidence: null,
      risk: null,
      freshness: null,
    },
    settings: settingsFromPreferences(args.preferences),
    calendar,
  })
}

/**
 * Rehydrates a stored settings object without going through zod. Used by the
 * preferences form when it edits a value that came from the database.
 */
export function storedSettings(
  value: Partial<OpportunitySettings> | null | undefined
): OpportunitySettings {
  return { ...DEFAULT_OPPORTUNITY_SETTINGS, ...(value ?? {}) }
}
