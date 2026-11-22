import type Decimal from "decimal.js"

import type { SalaryPeriod } from "@/generated/prisma/enums"

import type { CurrencyCode } from "@/shared/lib/money/currencies"
import type { DecimalLike } from "@/shared/lib/money/money"

/**
 * Opportunity Value: what a job is actually worth to *this* person.
 *
 * The seven-factor profile fit (skills, seniority, location, work mode,
 * authorization, pay overlap, freshness) answers "does this match what I said I
 * want". It cannot answer "is this a good deal": a posting can match every
 * preference and still be a 60-hour on-call role that pays below the floor, and
 * a posting can match poorly and pay extraordinarily.
 *
 * This engine keeps those two questions separate. It never re-scores or replaces
 * the seven factors; it reads them as `fit`, alongside eligibility, confidence
 * and risk from the existing qualification, and adds the dimensions fit has no
 * opinion about: verified compensation, effective hourly pay, workload and
 * application friction.
 *
 * Every claim is evidence-backed or explicitly `UNKNOWN`. The engine never
 * infers workload from a job title, never assumes 40 hours, and never converts a
 * currency to make a comparison work.
 */

/**
 * How much a statement can be trusted.
 *
 * `UNCERTAIN` is the important middle: the posting says something, but it is
 * conditional ("may include on-call"), qualitative ("occasional travel"), or
 * contradicted elsewhere in the same posting. Treating that as `SUPPORTED` is
 * how an app starts inventing workload.
 */
export type SignalState = "SUPPORTED" | "UNCERTAIN" | "UNKNOWN"

export type SignalId =
  // compensation
  | "PAY_STATED"
  | "PAY_MISSING"
  | "PAY_CURRENCY_UNKNOWN"
  | "PAY_INCOMPARABLE_CURRENCY"
  | "PAY_BELOW_FLOOR"
  | "COMMISSION_ONLY"
  | "VARIABLE_COMPONENT"
  // workload
  | "ON_CALL"
  | "OVERTIME"
  | "SHIFTS"
  | "QUOTAS"
  | "TRAVEL"
  | "ROLE_BREADTH"
  | "SCHEDULE_RIGIDITY"
  | "FLEXIBLE_SCHEDULE"
  // friction
  | "ASSESSMENT"
  | "INTERVIEW_STAGES"
  | "UNPAID_TASK"
  | "REQUIRED_DOCUMENTS"
  // eligibility / restrictions
  | "WORK_AUTHORIZATION"
  | "LOCATION_RESTRICTION"
  // hours
  | "HOURS_STATED"
  | "HOURS_MISSING"

export type WorkloadIndicatorId =
  | "ON_CALL"
  | "OVERTIME"
  | "SHIFTS"
  | "QUOTAS"
  | "TRAVEL"
  | "ROLE_BREADTH"
  | "SCHEDULE_RIGIDITY"
  | "FLEXIBLE_SCHEDULE"

export type FrictionIndicatorId =
  | "ASSESSMENT"
  | "INTERVIEW_STAGES"
  | "UNPAID_TASK"
  | "REQUIRED_DOCUMENTS"

/** Where a quoted excerpt came from, so the UI never shows a claim without one. */
export interface SignalEvidence {
  /** The sentence or clause, verbatim from the posting. */
  excerpt: string
  /** The posting URL when the caller supplied one. */
  sourceUrl: string | null
  source: "POSTING_TEXT" | "STRUCTURED_FIELD" | "PROFILE" | "DERIVED"
}

export interface Signal {
  id: SignalId
  state: SignalState
  /** One plain sentence a candidate can read without a legend. */
  reason: string
  evidence: SignalEvidence | null
}

export interface CompensationReading {
  /** Bounds as the posting states them, in the posting's own currency. */
  min: Decimal | null
  max: Decimal | null
  currency: CurrencyCode | null
  period: SalaryPeriod | null
  /** Annual bounds; null when the period or term is unknown. */
  annualMin: Decimal | null
  annualMax: Decimal | null
  /** Annual midpoint used for the ratio. */
  annualMidpoint: Decimal | null
  /** The user's annual expectation midpoint, in the same currency. */
  expectedMidpoint: Decimal | null
  /** midpoint / expectation. Null when either side or the currency is unknown. */
  ratio: number | null
  /** 0-100, null when pay cannot be read or compared. */
  score: number | null
  state: SignalState
  reason: string
  signals: Signal[]
}

export interface HourlyReading {
  /** Annual pay divided by the posting's stated working hours. */
  effectiveHourly: Decimal | null
  hoursPerWeek: number | null
  weeksPerYear: number | null
  /** Expected annual pay divided by the same calendar, for comparison. */
  expectedHourly: Decimal | null
  ratio: number | null
  score: number | null
  state: SignalState
  reason: string
  evidence: SignalEvidence | null
}

export interface WorkloadReading {
  indicators: Signal[]
  /** 0-100, 100 = lightest. Null when nothing was stated at all. */
  score: number | null
  state: SignalState
  reason: string
}

export interface FrictionReading {
  indicators: Signal[]
  /** Number of interview stages the posting itself states, when it does. */
  interviewStages: number | null
  /** 0-100, 100 = least friction. Null when the posting says nothing. */
  score: number | null
  state: SignalState
  reason: string
}

export type OpportunityDimensionId =
  | "COMPENSATION"
  | "EFFECTIVE_HOURLY"
  | "WORKLOAD"
  | "FRICTION"
  | "ELIGIBILITY"
  | "CONFIDENCE"
  | "FIT"
  | "RISK"

export interface OpportunityDimension {
  id: OpportunityDimensionId
  label: string
  /** 0-100, or null when the dimension has no data. */
  score: number | null
  /** Configured importance. Weights are normalised over non-null dimensions. */
  weight: number
  state: SignalState
  reason: string
  evidence: SignalEvidence[]
}

export type RejectionCode =
  | "MINIMUM_PAY"
  | "UNKNOWN_PAY"
  | "WORKLOAD"
  | "ELIGIBILITY"
  | "COMMISSION_ONLY"
  | "LOCATION_RESTRICTION"
  | "CONTRACT_TERM"

export interface OpportunityRejection {
  code: RejectionCode
  message: string
  /** BLOCK removes the posting from a filtered run; WARN keeps it visible. */
  severity: "BLOCK" | "WARN"
}

export type OpportunityGrade = "STRONG" | "DECENT" | "WEAK" | "BLOCKED"

export interface OpportunityValue {
  /** 0-100 weighted composite over dimensions that have data. */
  score: number
  grade: OpportunityGrade
  preset: OpportunityPresetId
  dimensions: OpportunityDimension[]
  compensation: CompensationReading
  hourly: HourlyReading
  workload: WorkloadReading
  friction: FrictionReading
  rejections: OpportunityRejection[]
  /**
   * Sentences that disagree with each other. Both are kept: the engine reports
   * the conflict instead of picking the convenient half.
   */
  contradictions: Array<{ id: SignalId; excerpts: [string, string] }>
  /** False only when a BLOCK rejection applies. */
  accepted: boolean
  /** Share of configured weight backed by real data, 0-1. */
  coverage: number
  /** Plain sentences: what helped, what hurt, what is unknown. */
  explanation: string[]
}

export type OpportunityPresetId = "BALANCED" | "PAY_OVER_LOAD"

export interface OpportunityWeights {
  compensation: number
  effectiveHourly: number
  workload: number
  friction: number
  eligibility: number
  confidence: number
  fit: number
  risk: number
}

export type WorkloadPreference = "LIGHTER" | "BALANCED" | "INTENSE"

/** What a run does with a posting that states no pay at all. */
export type UnknownPayPolicy = "ALLOW" | "FLAG" | "REJECT"

/** The user's Opportunity Value settings, stored in `preferences`. */
export interface OpportunitySettings {
  preset: OpportunityPresetId
  /** Null means "use the preset's weights". */
  weights: OpportunityWeights | null
  /** Annual floor in `minimumPayCurrency`, serialized decimal string. */
  minimumAnnualPay: string | null
  minimumPayCurrency: CurrencyCode | null
  /** True: a posting known to pay below the floor is blocked outright. */
  minimumPayStrict: boolean
  workloadPreference: WorkloadPreference
  unknownPay: UnknownPayPolicy
}

/** The profile's salary expectation, already parsed. */
export interface OpportunityExpectation {
  annualMin: DecimalLike | null
  annualMax: DecimalLike | null
  currency: CurrencyCode | null
  /** True when the expectation was expressed over a contract with a known term. */
  isContract?: boolean
}

/** The posting, as the engine reads it. */
export interface OpportunityPosting {
  title: string
  companyName: string
  url?: string | null
  description?: string | null
  /** Formatted labels the existing extractor already produced (H1B, clearance…). */
  requirementFlags?: string[]
  salary?: {
    min: DecimalLike | null
    max: DecimalLike | null
    currency: CurrencyCode | null
    period: SalaryPeriod | null
    termMonths?: number | null
    text?: string | null
    /** True when the figure came from the employer, false for a provider estimate. */
    verified?: boolean
  } | null
}

/** What the existing systems already decided. Passed through, never recomputed. */
export interface OpportunityContext {
  /** Seven-factor fit score, 0-100, from ranking. */
  fitScore: number | null
  /** Qualification steps, as signals the engine reuses. */
  eligibility?: "GOOD" | "NEUTRAL" | "CONCERN" | "BLOCKER" | null
  confidence?: "HIGH" | "MEDIUM" | "LOW" | null
  risk?: "LOW" | "MEDIUM" | "HIGH" | null
  /** Deadline/posting staleness, 0-100, from the existing freshness factor. */
  freshness?: number | null
}

/** Working calendar used for hourly pay, injectable for tests. */
export interface HourlyCalendar {
  hoursPerWeek: number
  weeksPerYear: number
}

/** Everything the engine needs. Pure data: no Prisma, no clock, no network. */
export interface OpportunityInput {
  posting: OpportunityPosting
  expectation: OpportunityExpectation
  context: OpportunityContext
  settings: OpportunitySettings
  calendar?: HourlyCalendar
}

/** A preset is just a named weight set; both are ordinary configurations. */
export const PRESET_WEIGHTS: Record<OpportunityPresetId, OpportunityWeights> = {
  /** Fit and eligibility lead; pay matters but does not dominate. */
  BALANCED: {
    compensation: 22,
    effectiveHourly: 8,
    workload: 15,
    friction: 10,
    eligibility: 15,
    confidence: 8,
    fit: 17,
    risk: 5,
  },
  /** "High pay / lighter workload": pay and workload lead, fit still counts. */
  PAY_OVER_LOAD: {
    compensation: 30,
    effectiveHourly: 12,
    workload: 22,
    friction: 8,
    eligibility: 12,
    confidence: 5,
    fit: 9,
    risk: 2,
  },
}

export const DEFAULT_OPPORTUNITY_SETTINGS: OpportunitySettings = {
  preset: "BALANCED",
  weights: null,
  minimumAnnualPay: null,
  minimumPayCurrency: null,
  minimumPayStrict: false,
  workloadPreference: "BALANCED",
  unknownPay: "FLAG",
}
