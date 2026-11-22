import Decimal from "decimal.js"

import type { ExperienceLevel, JobRiskLevel, SalaryPeriod, WorkType } from "@/generated/prisma/enums"
import { parseStoredSalary } from "@/features/ranking/salary"
import { isCurrencyCode, type CurrencyCode } from "@/shared/lib/money/currencies"
import { dec, type DecimalLike } from "@/shared/lib/money/money"

import type { OpportunityGrade } from "./types"

/**
 * One filter vocabulary for every screen that lists opportunities.
 *
 * Saved jobs, discovery results and the ranking leaderboard all render the same
 * facts, so they filter through this module rather than each growing its own
 * predicate set. Three rules are inherited from the engine and matter here:
 *
 * 1. A pay filter only applies when the posting's currency matches the filter's.
 *    There is no client-side conversion; a mismatch is `unknown`, not a pass.
 * 2. `unknown` is a real bucket. A posting that states no workload is not a
 *    light one, and grouping says so instead of quietly passing it.
 * 3. Excluded always carries a reason, so the UI can show why.
 */

export type QuickPresetId =
  | "BEST_OVERALL"
  | "HIGH_PAY"
  | "HIGH_PAY_LIGHT_LOAD"
  | "EASY_APPLY"
  | "CUSTOM"

export type OpportunitySortKey =
  | "BEST_VALUE"
  | "PAY_DESC"
  | "EASIEST"
  | "FRESHEST"
  | "NEWEST"

export type RemoteEligibility = "ANY" | "REMOTE" | "REMOTE_OR_HYBRID"

export interface OpportunityFilterCriteria {
  /** 0 = unset. Annual, in `currency`. */
  minPay: string | null
  currency: CurrencyCode | null
  period: SalaryPeriod | "ANY"
  remote: RemoteEligibility
  location: string
  experience: ExperienceLevel | "ANY"
  /** Workload indicators the posting must explicitly carry (e.g. ON_CALL). */
  workload: string[]
  /** Minimum friction score (0-100); null = unset. */
  minFriction: number | null
  /** Maximum posting age in days; null = unset. */
  maxAgeDays: number | null
  risk: JobRiskLevel | "ANY"
  /** True: a posting that does not state pay is unknown, not a guess. */
  requireKnownPay: boolean
  /** Minimum workload score (0-100, 100 = lightest); null = unset. */
  minWorkload: number | null
  sort: OpportunitySortKey
}

export const DEFAULT_CRITERIA: OpportunityFilterCriteria = {
  minPay: null,
  currency: null,
  period: "ANY",
  remote: "ANY",
  location: "",
  experience: "ANY",
  workload: [],
  minFriction: null,
  maxAgeDays: null,
  risk: "ANY",
  requireKnownPay: false,
  minWorkload: null,
  sort: "BEST_VALUE",
}

export interface QuickPreset {
  id: Exclude<QuickPresetId, "CUSTOM">
  label: string
  description: string
  criteria: Partial<OpportunityFilterCriteria>
}

export const QUICK_PRESETS: QuickPreset[] = [
  {
    id: "BEST_OVERALL",
    label: "Best overall",
    description: "Everything, ordered by Opportunity Value.",
    criteria: { sort: "BEST_VALUE" },
  },
  {
    id: "HIGH_PAY",
    label: "High pay",
    description: "Only postings whose pay is stated, highest first.",
    criteria: { sort: "PAY_DESC", requireKnownPay: true },
  },
  {
    id: "HIGH_PAY_LIGHT_LOAD",
    label: "High pay / lighter workload",
    description: "Stated pay plus a workload the posting describes as light.",
    criteria: { sort: "BEST_VALUE", requireKnownPay: true, minWorkload: 55 },
  },
  {
    id: "EASY_APPLY",
    label: "Easy to apply",
    description: "Short processes: few stages, no unpaid task, few documents.",
    criteria: { sort: "EASIEST", minFriction: 70 },
  },
]

/**
 * The parts of an Opportunity Value a list needs. Structural on purpose: it
 * accepts the engine's object and the serialized payload alike.
 */
export interface OpportunityValueSummary {
  score: number
  grade: OpportunityGrade
  coverage: number
  accepted: boolean
  rejections: Array<{ severity: "BLOCK" | "WARN"; message: string }>
  workload?: { score: number | null; indicators?: Array<{ id: string }> }
  friction?: { score: number | null }
}

/** Everything a card/list needs to filter one opportunity. */
export interface FilterableOpportunity {
  id: string
  /** Stored pay, in the posting's own currency and period. */
  salary: {
    min: DecimalLike | null
    max: DecimalLike | null
    currency: CurrencyCode | null
    period: SalaryPeriod | null
    termMonths?: number | null
  }
  workType: WorkType | null
  location: string | null
  experience: ExperienceLevel | null
  risk: JobRiskLevel | null
  /** Posting age in days, server-computed against the user's day. */
  ageDays: number | null
  value: OpportunityValueSummary | null
}

export interface OpportunityGrouping {
  eligible: FilterableOpportunity[]
  unknown: FilterableOpportunity[]
  excluded: Array<{ item: FilterableOpportunity; reasons: string[] }>
}

function salaryMidpoint(item: FilterableOpportunity): Decimal | null {
  const parsed = parseStoredSalary({
    salaryMin: item.salary.min,
    salaryMax: item.salary.max,
    salaryCurrency: item.salary.currency,
    salaryPeriod: item.salary.period,
    salaryTermMonths: item.salary.termMonths ?? null,
  })
  if (!parsed) return null
  const low = parsed.annualMin
  const high = parsed.annualMax
  if (low === null && high === null) return null
  if (low === null) return high
  if (high === null) return low
  return low.plus(high).div(2)
}

function matchesLocation(item: FilterableOpportunity, needle: string): boolean {
  const query = needle.trim().toLowerCase()
  if (query === "") return true
  return (item.location ?? "").toLowerCase().includes(query)
}

function matchesRemote(item: FilterableOpportunity, remote: RemoteEligibility): boolean {
  if (remote === "ANY") return true
  if (remote === "REMOTE") return item.workType === "REMOTE"
  return item.workType === "REMOTE" || item.workType === "HYBRID"
}

/**
 * Why an item fails a criterion, or null when it passes.
 *
 * The distinction between "fails" and "cannot tell" is returned separately:
 * `unknown` means the posting does not state the fact the filter needs.
 */
export function evaluateCriteria(
  item: FilterableOpportunity,
  criteria: OpportunityFilterCriteria
): { pass: boolean; unknown: boolean; reasons: string[] } {
  const reasons: string[] = []
  let unknown = false

  if (criteria.requireKnownPay && salaryMidpoint(item) === null) {
    unknown = true
  }

  if (criteria.minPay !== null && criteria.currency !== null) {
    const floor = dec(criteria.minPay)
    const midpoint = salaryMidpoint(item)
    if (item.salary.currency === null || item.salary.period === null) {
      unknown = true
    } else if (item.salary.currency !== criteria.currency) {
      // Never convert in a filter: a peso posting is not "below" a dollar floor.
      unknown = true
    } else if (midpoint === null) {
      unknown = true
    } else if (midpoint.lt(floor)) {
      reasons.push(`Pay is below ${criteria.currency} ${criteria.minPay}.`)
    }
  }

  if (criteria.period !== "ANY") {
    if (item.salary.period === null) unknown = true
    else if (item.salary.period !== criteria.period) {
      reasons.push(`Pay is quoted ${item.salary.period.toLowerCase()}, not ${criteria.period.toLowerCase()}.`)
    }
  }

  if (criteria.remote !== "ANY") {
    if (item.workType === null) unknown = true
    else if (!matchesRemote(item, criteria.remote)) reasons.push("Work mode does not match.")
  }

  if (criteria.location.trim() !== "") {
    if (item.location === null) unknown = true
    else if (!matchesLocation(item, criteria.location)) reasons.push("Location does not match.")
  }

  if (criteria.experience !== "ANY") {
    if (item.experience === null) unknown = true
    else if (item.experience !== criteria.experience) reasons.push("Experience level does not match.")
  }

  if (criteria.risk !== "ANY") {
    if (item.risk === null) unknown = true
    else if (item.risk !== criteria.risk) reasons.push(`Risk is ${item.risk.toLowerCase()}.`)
  }
  if (criteria.maxAgeDays !== null) {
    if (item.ageDays === null) unknown = true
    else if (item.ageDays > criteria.maxAgeDays) reasons.push(`Posting is ${item.ageDays} days old.`)
  }

  const indicators = item.value?.workload?.indicators ?? []

  if (criteria.workload.length > 0) {
    const stated = new Set(indicators.map((signal) => signal.id.toUpperCase()))
    const missing = criteria.workload.filter((id) => !stated.has(id.toUpperCase()))
    if (indicators.length === 0) unknown = true
    else if (missing.length > 0) reasons.push("Stated workload indicators do not include the ones you selected.")
  }

  if (criteria.minWorkload !== null) {
    const score = item.value?.workload?.score ?? null
    if (score === null) unknown = true
    else if (score < criteria.minWorkload) reasons.push("Workload is heavier than this preset allows.")
  }

  if (criteria.minFriction !== null) {
    const score = item.value?.friction?.score ?? null
    if (score === null) unknown = true
    else if (score < criteria.minFriction) reasons.push("Application friction is higher than you allowed.")
  }

  return { pass: reasons.length === 0, unknown: reasons.length === 0 && unknown, reasons }
}

/** Applies the user's own rejection reasons first, then the filter criteria. */
export function groupOpportunities(
  items: FilterableOpportunity[],
  criteria: OpportunityFilterCriteria
): OpportunityGrouping {
  const grouping: OpportunityGrouping = { eligible: [], unknown: [], excluded: [] }

  for (const item of items) {
    const blocking = (item.value?.rejections ?? [])
      .filter((rejection) => rejection.severity === "BLOCK")
      .map((rejection) => rejection.message)

    if (item.value && !item.value.accepted) {
      grouping.excluded.push({ item, reasons: blocking.length > 0 ? blocking : ["This posting was excluded."] })
      continue
    }

    const evaluation = evaluateCriteria(item, criteria)
    if (!evaluation.pass) {
      grouping.excluded.push({ item, reasons: evaluation.reasons })
      continue
    }
    // "Needs more info" is about the *filters*, not the score's coverage: a
    // posting with thin evidence is still a result when nothing was asked of
    // it. The card shows its own coverage figure separately.
    if (evaluation.unknown) {
      grouping.unknown.push(item)
      continue
    }
    grouping.eligible.push(item)
  }

  return grouping
}

export function sortOpportunities(
  items: FilterableOpportunity[],
  sort: OpportunitySortKey,
  /** Pay ordering never crosses currencies; this one is listed first. */
  currency: CurrencyCode | null = null
): FilterableOpportunity[] {
  const withValue = (item: FilterableOpportunity) => item.value?.score ?? null
  const midpointOf = (item: FilterableOpportunity) => salaryMidpoint(item)

  return [...items].sort((a, b) => {
    switch (sort) {
      case "PAY_DESC": {
        // 100 USD is not "more" than 5,000 PHP. Compare like with like, then
        // group the rest by currency code so the order stays deterministic.
        const left = midpointOf(a)
        const right = midpointOf(b)
        const leftCurrency = a.salary.currency ?? ""
        const rightCurrency = b.salary.currency ?? ""
        const leftFirst = currency !== null && leftCurrency === currency
        const rightFirst = currency !== null && rightCurrency === currency
        if (leftFirst !== rightFirst) return leftFirst ? -1 : 1
        if (leftCurrency !== rightCurrency) return leftCurrency.localeCompare(rightCurrency)
        if (left === null && right === null) return 0
        if (left === null) return 1
        if (right === null) return -1
        return right.comparedTo(left)
      }
      case "EASIEST": {
        const left = a.value?.friction?.score ?? null
        const right = b.value?.friction?.score ?? null
        if (left === null && right === null) return 0
        if (left === null) return 1
        if (right === null) return -1
        return right - left
      }
      case "FRESHEST": {
        const left = a.ageDays ?? Number.POSITIVE_INFINITY
        const right = b.ageDays ?? Number.POSITIVE_INFINITY
        return left - right
      }
      case "NEWEST":
        return b.id.localeCompare(a.id)
      case "BEST_VALUE":
      default: {
        const left = withValue(a)
        const right = withValue(b)
        if (left === null && right === null) return 0
        if (left === null) return 1
        if (right === null) return -1
        return right - left
      }
    }
  })
}

export function criteriaForPreset(preset: QuickPresetId): OpportunityFilterCriteria {
  if (preset === "CUSTOM") return { ...DEFAULT_CRITERIA }
  const definition = QUICK_PRESETS.find((candidate) => candidate.id === preset)
  return { ...DEFAULT_CRITERIA, ...(definition?.criteria ?? {}) }
}

/** The preset that currently describes the criteria, or CUSTOM. */
export function presetForCriteria(criteria: OpportunityFilterCriteria): QuickPresetId {
  for (const preset of QUICK_PRESETS) {
    const expected = criteriaForPreset(preset.id)
    if (JSON.stringify(normalizeForCompare(expected)) === JSON.stringify(normalizeForCompare(criteria))) {
      return preset.id
    }
  }
  return "CUSTOM"
}

function normalizeForCompare(criteria: OpportunityFilterCriteria) {
  return { ...criteria, workload: [...criteria.workload].sort() }
}

const PARAMS = {
  preset: "preset",
  minPay: "paymin",
  currency: "paycur",
  period: "payperiod",
  remote: "remote",
  location: "loc",
  experience: "exp",
  workload: "load",
  minFriction: "friction",
  maxAgeDays: "fresh",
  risk: "risk",
  minWorkload: "workload",
  requireKnownPay: "haspay",
  // Deliberately not `sort`: saved jobs already owns that param for its own
  // ordering, and two sort controls sharing one key silently undo each other.
  sort: "vsort",
} as const

const SORTS: OpportunitySortKey[] = ["BEST_VALUE", "PAY_DESC", "EASIEST", "FRESHEST", "NEWEST"]
const REMOTES: RemoteEligibility[] = ["ANY", "REMOTE", "REMOTE_OR_HYBRID"]
const PERIODS: Array<SalaryPeriod | "ANY"> = ["ANY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CONTRACT"]
const EXPERIENCES: Array<ExperienceLevel | "ANY"> = [
  "ANY",
  "JUNIOR",
  "MID",
  "SENIOR",
  "LEAD",
  "EXECUTIVE",
]
const RISKS: Array<JobRiskLevel | "ANY"> = ["ANY", "LOW", "MEDIUM", "HIGH"]

function oneOf<T extends string>(values: T[], raw: string | null, fallback: T): T {
  return raw && (values as string[]).includes(raw) ? (raw as T) : fallback
}

function numberParam(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Money reaches Decimal, which throws on strings Number() tolerates: `%20`,
 * `0x10`, `1e3`. Validating the written form here keeps a bad shared URL from
 * crashing the filter render instead of falling back to the default floor.
 */
function moneyParam(raw: string | null): string | null {
  if (!raw) return null
  return /^\d{1,12}(?:\.\d{1,2})?$/.test(raw) ? raw : null
}

/** Reads the filter state from a URL. Unknown values fall back, never throw. */
export function parseFilterParams(
  params: Pick<URLSearchParams, "get">,
  fallback: OpportunityFilterCriteria = DEFAULT_CRITERIA
): OpportunityFilterCriteria {
  const preset = params.get(PARAMS.preset)
  const base: OpportunityFilterCriteria =
    preset && preset !== "CUSTOM" && QUICK_PRESETS.some((entry) => entry.id === preset)
      ? criteriaForPreset(preset as QuickPresetId)
      : fallback

  const currency = params.get(PARAMS.currency)
  const minPay = params.get(PARAMS.minPay)
  return {
    minPay: moneyParam(minPay) ?? base.minPay,
    currency: currency && isCurrencyCode(currency) ? currency : base.currency,
    period: oneOf(PERIODS, params.get(PARAMS.period), base.period),
    remote: oneOf(REMOTES, params.get(PARAMS.remote), base.remote),
    location: params.get(PARAMS.location) ?? base.location,
    experience: oneOf(EXPERIENCES, params.get(PARAMS.experience), base.experience),
    workload: (params.get(PARAMS.workload) ?? "")
      .split(",")
      .map((entry) => entry.trim().toUpperCase())
      .filter(Boolean),
    minFriction:
      numberParam(params.get(PARAMS.minFriction)) ?? base.minFriction,
    maxAgeDays: numberParam(params.get(PARAMS.maxAgeDays)) ?? base.maxAgeDays,
    risk: oneOf(RISKS, params.get(PARAMS.risk), base.risk),
    requireKnownPay: params.get(PARAMS.requireKnownPay) === "1" || base.requireKnownPay,
    minWorkload: numberParam(params.get(PARAMS.minWorkload)) ?? base.minWorkload,
    sort: oneOf(SORTS, params.get(PARAMS.sort), base.sort),
  }
}

/** Writes non-default values, leaving unrelated parameters untouched. */
export function writeFilterParams(
  current: URLSearchParams,
  criteria: OpportunityFilterCriteria
): URLSearchParams {
  const params = new URLSearchParams(current.toString())
  const write = (key: string, value: string | null) => {
    if (value === null || value === "") params.delete(key)
    else params.set(key, value)
  }
  // The pay floor is an extra constraint, not a preset of its own; serialising
  // it as CUSTOM would lose the preset on the next parse.
  const preset = presetForCriteria({ ...criteria, minPay: null, currency: null })
  write(PARAMS.preset, preset === "BEST_OVERALL" ? null : preset)
  write(PARAMS.minPay, criteria.minPay)
  write(PARAMS.currency, criteria.currency)
  write(PARAMS.period, criteria.period === "ANY" ? null : criteria.period)
  write(PARAMS.remote, criteria.remote === "ANY" ? null : criteria.remote)
  write(PARAMS.location, criteria.location || null)
  write(PARAMS.experience, criteria.experience === "ANY" ? null : criteria.experience)
  write(PARAMS.workload, criteria.workload.length > 0 ? criteria.workload.join(",") : null)
  write(PARAMS.minFriction, criteria.minFriction === null ? null : String(criteria.minFriction))
  write(PARAMS.maxAgeDays, criteria.maxAgeDays === null ? null : String(criteria.maxAgeDays))
  write(PARAMS.risk, criteria.risk === "ANY" ? null : criteria.risk)
  write(PARAMS.requireKnownPay, criteria.requireKnownPay ? "1" : null)
  write(PARAMS.minWorkload, criteria.minWorkload === null ? null : String(criteria.minWorkload))
  write(PARAMS.sort, criteria.sort === "BEST_VALUE" ? null : criteria.sort)
  return params
}

/** True when anything other than the default sort is set. */
export function hasActiveCriteria(criteria: OpportunityFilterCriteria): boolean {
  return JSON.stringify(normalizeForCompare(criteria)) !== JSON.stringify(normalizeForCompare(DEFAULT_CRITERIA))
}

export const ALLOWED_WORKLOAD_FILTERS = [
  "ON_CALL",
  "OVERTIME",
  "SHIFTS",
  "QUOTAS",
  "TRAVEL",
  "ROLE_BREADTH",
  "SCHEDULE_RIGIDITY",
] as const

export type WorkloadFilterId = (typeof ALLOWED_WORKLOAD_FILTERS)[number]

export function gradeLabel(grade: OpportunityGrade): string {
  switch (grade) {
    case "STRONG":
      return "Strong value"
    case "DECENT":
      return "Decent value"
    case "WEAK":
      return "Weak value"
    case "BLOCKED":
      return "Excluded"
  }
}
