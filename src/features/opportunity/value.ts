import Decimal from "decimal.js"

import type { SalaryPeriod } from "@/generated/prisma/enums"

import { parseSalary, type NormalizedSalary } from "@/features/ranking/salary"
import { payCalendar } from "@/shared/lib/money/pay-calendar"
import { dec, type DecimalLike } from "@/shared/lib/money/money"

import { readPostingSignals, type PostingSignals } from "./signals"
import {
  PRESET_WEIGHTS,
  type CompensationReading,
  type FrictionReading,
  type HourlyCalendar,
  type HourlyReading,
  type OpportunityDimension,
  type OpportunityDimensionId,
  type OpportunityGrade,
  type OpportunityInput,
  type OpportunityRejection,
  type OpportunitySettings,
  type OpportunityValue,
  type OpportunityWeights,
  type Signal,
  type SignalEvidence,
  type WorkloadReading,
} from "./types"

/**
 * Deterministic Opportunity Value.
 *
 * Same posting + same profile + same settings always produce the same result;
 * there is no clock, no network and no model in here. Two consequences that
 * matter:
 *
 * - A score can be re-derived and audited later. Every number in the result
 *   points at a signal, and every signal points at a quoted sentence.
 * - Missing data lowers `coverage` instead of lowering the score. A posting that
 *   says nothing about workload is not treated as a light one.
 */

const DEFAULT_CALENDAR: HourlyCalendar = { hoursPerWeek: 40, weeksPerYear: 52 }

/** Piecewise pay curve, anchored on what the ratios actually feel like. */
const PAY_POINTS: Array<[number, number]> = [
  [0.55, 0],
  [0.7, 25],
  [0.8, 45],
  [0.9, 65],
  [1.0, 85],
  [1.15, 100],
]

function interpolate(points: Array<[number, number]>, x: number): number {
  if (x <= points[0]![0]) return points[0]![1]
  const last = points[points.length - 1]!
  if (x >= last[0]) return last[1]
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i]!
    const [x0, y0] = points[i - 1]!
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0)
      return Math.round(y0 + t * (y1 - y0))
    }
  }
  return last[1]
}

export function payScore(ratio: number): number {
  return Math.max(0, Math.min(100, interpolate(PAY_POINTS, ratio)))
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

/** Annual bounds for a posting salary, without inventing a period or currency. */
function readAnnualBounds(salary: NormalizedSalary | null): {
  annualMin: Decimal | null
  annualMax: Decimal | null
} {
  if (!salary) return { annualMin: null, annualMax: null }
  return { annualMin: salary.annualMin, annualMax: salary.annualMax }
}

function expectationMidpoint(
  min: DecimalLike | null,
  max: DecimalLike | null
): Decimal | null {
  if (min === null && max === null) return null
  const low = min !== null ? dec(min) : dec(max!)
  const high = max !== null ? dec(max) : dec(min!)
  return low.plus(high).div(2)
}

function midpoint(min: Decimal | null, max: Decimal | null): Decimal | null {
  if (min === null && max === null) return null
  if (min === null) return max
  if (max === null) return min
  return min.plus(max).div(2)
}

function evidenceFor(signal: Signal | null): SignalEvidence[] {
  return signal?.evidence ? [signal.evidence] : []
}

function signalReason(signals: Signal[]): string {
  const supported = signals.filter((signal) => signal.state === "SUPPORTED")
  if (supported.length > 0) return supported.map((signal) => signal.reason).join(" ")
  const uncertain = signals.filter((signal) => signal.state === "UNCERTAIN")
  if (uncertain.length > 0) return uncertain.map((signal) => signal.reason).join(" ")
  return "The posting does not describe its workload."
}

// ---------------------------------------------------------------------------
// Compensation
// ---------------------------------------------------------------------------

function readCompensation(
  input: OpportunityInput,
  signals: PostingSignals
): CompensationReading {
  const raw = input.posting.salary ?? null
  const parsed = raw
    ? parseSalary({
        salaryMin: raw.min,
        salaryMax: raw.max,
        currency: raw.currency,
        period: raw.period,
        termMonths: raw.termMonths ?? null,
        salaryText: raw.text ?? null,
        provenance: raw.text ? "POSTING_TEXT" : "PROVIDER_STRUCTURED",
      })
    : null

  let { annualMin, annualMax } = readAnnualBounds(parsed)
  // The shared parser annualizes hourly pay on the default 2,080-hour calendar.
  // A posting that states its own hours is not on that calendar: $50/hour at 20
  // hours a week is $52,000 a year, not $104,000. Re-annualize from the stated
  // hours so effective hourly pay is the quoted rate rather than double it.
  if (
    parsed?.period === "HOURLY" &&
    signals.hoursPerWeek !== null &&
    parsed.annualMin !== null &&
    parsed.annualMax !== null
  ) {
    const hoursPerYear = new Decimal(signals.hoursPerWeek).mul(
      (input.calendar ?? DEFAULT_CALENDAR).weeksPerYear
    )
    annualMin = parsed.min !== null ? parsed.min.mul(hoursPerYear) : null
    annualMax = parsed.max !== null ? parsed.max.mul(hoursPerYear) : null
  }
  const postingMid = midpoint(annualMin, annualMax)
  const expectationCurrency = input.expectation.currency
  const postingCurrency = parsed?.currency ?? null
  const expectedMid = expectationMidpoint(
    input.expectation.annualMin,
    input.expectation.annualMax
  )

  const signalsOut: Signal[] = []
  const base = {
    min: parsed?.min ?? null,
    max: parsed?.max ?? null,
    currency: postingCurrency,
    period: (parsed?.period ?? null) as SalaryPeriod | null,
    annualMin,
    annualMax,
    annualMidpoint: postingMid,
    expectedMidpoint: expectedMid,
  }

  if (!raw || (raw.min === null && raw.max === null)) {
    signalsOut.push({
      id: "PAY_MISSING",
      state: "UNKNOWN",
      reason: "The posting does not state pay.",
      evidence: raw?.text
        ? { excerpt: raw.text, sourceUrl: input.posting.url ?? null, source: "POSTING_TEXT" }
        : null,
    })
    return {
      ...base,
      ratio: null,
      score: null,
      state: "UNKNOWN",
      reason: "The posting does not state pay, so compensation cannot be scored.",
      signals: signalsOut,
    }
  }

  if (!postingCurrency) {
    signalsOut.push({
      id: "PAY_CURRENCY_UNKNOWN",
      state: "UNKNOWN",
      reason: "The posting's pay does not say which currency it is in.",
      evidence: raw.text
        ? { excerpt: raw.text, sourceUrl: input.posting.url ?? null, source: "POSTING_TEXT" }
        : null,
    })
    return {
      ...base,
      ratio: null,
      score: null,
      state: "UNKNOWN",
      reason: "Pay is stated without a currency, so it cannot be compared.",
      signals: signalsOut,
    }
  }

  if (!expectationCurrency || expectationCurrency !== postingCurrency || expectedMid === null) {
    signalsOut.push({
      id: "PAY_INCOMPARABLE_CURRENCY",
      state: "UNKNOWN",
      reason: !expectationCurrency
        ? "You have not set a salary expectation in a currency, so pay cannot be compared."
        : expectationCurrency !== postingCurrency
          ? `The posting pays in ${postingCurrency}; your expectation is in ${expectationCurrency}. No exchange rate is assumed.`
          : "Your salary expectation is not set.",
      evidence: null,
    })
    return {
      ...base,
      ratio: null,
      score: null,
      state: "UNKNOWN",
      reason:
        expectationCurrency && expectationCurrency !== postingCurrency
          ? "Pay is in a different currency from your expectation, so no comparison is made."
          : "No salary expectation is set, so pay cannot be scored against one.",
      signals: signalsOut,
    }
  }

  if (postingMid === null) {
    signalsOut.push({
      id: "PAY_STATED",
      state: "UNKNOWN",
      reason:
        parsed?.reason === "CONTRACT_TERM_MISSING"
          ? "The posting quotes a contract total without a contract length."
          : "The posting's pay cannot be read as a yearly figure.",
      evidence: raw.text
        ? { excerpt: raw.text, sourceUrl: input.posting.url ?? null, source: "POSTING_TEXT" }
        : null,
    })
    return {
      ...base,
      ratio: null,
      score: null,
      state: "UNKNOWN",
      reason: "Pay is stated, but not in a form that can be compared to a yearly expectation.",
      signals: signalsOut,
    }
  }

  const ratio = postingMid.div(expectedMid).toNumber()
  const score = payScore(ratio)
  const verified = raw.verified !== false
  const commissionOnly = signals.commissionOnly

  signalsOut.push({
    id: "PAY_STATED",
    state: verified && !commissionOnly ? "SUPPORTED" : "UNCERTAIN",
    reason: commissionOnly
      ? "The posting quotes pay in a commission-only structure, so the figure is not guaranteed."
      : verified
        ? `The posting pays about ${(ratio * 100).toFixed(0)}% of your expected midpoint.`
        : "The pay figure is a provider estimate rather than the employer's own.",
    evidence: raw.text
      ? { excerpt: raw.text, sourceUrl: input.posting.url ?? null, source: "POSTING_TEXT" }
      : null,
  })

  if (commissionOnly) {
    signalsOut.push({
      id: "COMMISSION_ONLY",
      state: "SUPPORTED",
      reason: "The posting describes commission-only compensation.",
      evidence: null,
    })
  } else if (signals.variableComponent) {
    signalsOut.push({
      id: "VARIABLE_COMPONENT",
      state: "UNCERTAIN",
      reason: "Part of the pay is variable, so the stated figure may be an on-target estimate.",
      evidence: null,
    })
  }

  const reason = commissionOnly
    ? "Pay is commission-only, so the stated figure is treated as unverified."
    : verified
      ? "Pay is compared with your salary expectation in the same currency."
      : "Pay comes from a provider estimate, so it is treated as approximate."

  return {
    ...base,
    ratio,
    score: commissionOnly ? Math.min(score, 60) : score,
    state: commissionOnly || !verified ? "UNCERTAIN" : "SUPPORTED",
    reason,
    signals: signalsOut,
  }
}

// ---------------------------------------------------------------------------
// Effective hourly
// ---------------------------------------------------------------------------

function readHourly(
  input: OpportunityInput,
  compensation: CompensationReading,
  signals: PostingSignals
): HourlyReading {
  const calendar = input.calendar ?? DEFAULT_CALENDAR
  const hoursPerWeek = signals.hoursPerWeek

  if (hoursPerWeek === null) {
    return {
      effectiveHourly: null,
      hoursPerWeek: null,
      weeksPerYear: calendar.weeksPerYear,
      expectedHourly: null,
      ratio: null,
      score: null,
      state: "UNKNOWN",
      reason:
        "The posting does not state working hours, so effective hourly pay cannot be estimated.",
      evidence: null,
    }
  }

  const evidence: SignalEvidence | null = signals.hoursSentence
    ? { excerpt: signals.hoursSentence, sourceUrl: input.posting.url ?? null, source: "POSTING_TEXT" }
    : null

  if (compensation.annualMidpoint === null) {
    return {
      effectiveHourly: null,
      hoursPerWeek,
      weeksPerYear: calendar.weeksPerYear,
      expectedHourly: null,
      ratio: null,
      score: null,
      state: "UNKNOWN",
      reason: "The posting states hours but not a comparable annual salary.",
      evidence,
    }
  }

  const annualHours = new Decimal(hoursPerWeek).mul(calendar.weeksPerYear)
  const effectiveHourly = compensation.annualMidpoint.div(annualHours)

  if (compensation.expectedMidpoint === null) {
    return {
      effectiveHourly,
      hoursPerWeek,
      weeksPerYear: calendar.weeksPerYear,
      expectedHourly: null,
      ratio: null,
      score: null,
      state: "UNCERTAIN",
      reason: "Hours are known, but there is no salary expectation to compare the hourly rate with.",
      evidence,
    }
  }

  const expectedHourly = compensation.expectedMidpoint.div(
    new Decimal(calendar.hoursPerWeek).mul(calendar.weeksPerYear)
  )
  const ratio = effectiveHourly.div(expectedHourly).toNumber()

  return {
    effectiveHourly,
    hoursPerWeek,
    weeksPerYear: calendar.weeksPerYear,
    expectedHourly,
    ratio,
    score: payScore(ratio),
    state: "SUPPORTED",
    reason: `At ${hoursPerWeek} hours a week the role pays about ${effectiveHourly.toFixed(2)} ${compensation.currency} an hour.`,
    evidence,
  }
}

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

const WORKLOAD_PENALTY: Record<string, number> = {
  ON_CALL: 10,
  OVERTIME: 12,
  SHIFTS: 15,
  QUOTAS: 12,
  TRAVEL: 6,
  ROLE_BREADTH: 8,
  SCHEDULE_RIGIDITY: 10,
  FLEXIBLE_SCHEDULE: -6,
}

const PREFERENCE_MULTIPLIER = { LIGHTER: 1.25, BALANCED: 1, INTENSE: 0.75 } as const

function travelPenalty(signal: Signal): number {
  if (signal.state === "UNKNOWN") return 0
  const match = signal.reason.match(/(\d{1,3})\s*%/)
  const percent = match ? Number(match[1]) : null
  const base =
    percent === null ? 6 : percent >= 25 ? 15 : percent >= 10 ? 9 : percent > 0 ? 4 : 0
  return signal.state === "UNCERTAIN" ? base / 2 : base
}

function readWorkload(signals: PostingSignals, settings: OpportunitySettings): WorkloadReading {
  const multiplier = PREFERENCE_MULTIPLIER[settings.workloadPreference]
  let penalty = 0
  let known = 0

  for (const signal of signals.workload) {
    if (signal.state === "UNKNOWN") continue
    known += 1
    const base =
      signal.id === "TRAVEL" ? travelPenalty(signal) : WORKLOAD_PENALTY[signal.id] ?? 0
    const weight = signal.state === "UNCERTAIN" ? 0.5 : 1
    // A flexible schedule is a benefit: scaling a negative penalty still works,
    // and clamping happens once at the end.
    penalty += (base * weight * multiplier)
  }

  if (known === 0) {
    return {
      indicators: signals.workload,
      score: null,
      state: "UNKNOWN",
      reason: "The posting does not describe its workload, so none is assumed.",
    }
  }

  const supported = signals.workload.some((signal) => signal.state === "SUPPORTED")
  return {
    indicators: signals.workload,
    score: clamp(100 - penalty),
    state: supported ? "SUPPORTED" : "UNCERTAIN",
    reason: signalReason(signals.workload),
  }
}

// ---------------------------------------------------------------------------
// Friction
// ---------------------------------------------------------------------------

function readFriction(signals: PostingSignals): FrictionReading {
  let penalty = 0
  let known = 0

  for (const signal of signals.friction) {
    if (signal.state === "UNKNOWN") continue
    known += 1
    const weight = signal.state === "UNCERTAIN" ? 0.5 : 1
    switch (signal.id) {
      case "ASSESSMENT":
        penalty += 12 * weight
        break
      case "UNPAID_TASK":
        penalty += 20 * weight
        break
      case "REQUIRED_DOCUMENTS":
        penalty += 8 * weight
        break
      case "INTERVIEW_STAGES": {
        const stages = signals.interviewStages ?? 0
        penalty += Math.min(Math.max(stages - 2, 0) * 6, 24) * weight
        break
      }
      default:
        break
    }
  }

  if (known === 0) {
    return {
      indicators: signals.friction,
      interviewStages: null,
      score: null,
      state: "UNKNOWN",
      reason: "The posting does not describe its application process.",
    }
  }

  const supported = signals.friction.some(
    (signal) => signal.state === "SUPPORTED" && signal.id !== "UNPAID_TASK"
  )
  return {
    indicators: signals.friction,
    interviewStages: signals.interviewStages,
    score: clamp(100 - penalty),
    state: supported ? "SUPPORTED" : "UNCERTAIN",
    reason: signalReason(signals.friction),
  }
}

// ---------------------------------------------------------------------------
// Dimensions and composite
// ---------------------------------------------------------------------------

const DIMENSION_LABELS: Record<OpportunityDimensionId, string> = {
  COMPENSATION: "Verified compensation",
  EFFECTIVE_HOURLY: "Effective hourly pay",
  WORKLOAD: "Workload",
  FRICTION: "Application friction",
  ELIGIBILITY: "Eligibility",
  CONFIDENCE: "Job confidence",
  FIT: "Profile fit",
  RISK: "Risk",
}

const ELIGIBILITY_SCORE = { GOOD: 100, NEUTRAL: 60, CONCERN: 25, BLOCKER: 0 } as const
const CONFIDENCE_SCORE = { HIGH: 100, MEDIUM: 60, LOW: 30 } as const
const RISK_SCORE = { LOW: 100, MEDIUM: 50, HIGH: 0 } as const

function dimension(
  id: OpportunityDimensionId,
  score: number | null,
  weight: number,
  state: Signal["state"],
  reason: string,
  evidence: SignalEvidence[] = []
): OpportunityDimension {
  return { id, label: DIMENSION_LABELS[id], score, weight, state, reason, evidence }
}

function buildDimensions(
  input: OpportunityInput,
  compensation: CompensationReading,
  hourly: HourlyReading,
  workload: WorkloadReading,
  friction: FrictionReading,
  weights: OpportunityWeights
): OpportunityDimension[] {
  const context = input.context
  return [
    dimension(
      "COMPENSATION",
      compensation.score,
      weights.compensation,
      compensation.state,
      compensation.reason,
      compensation.signals.flatMap((signal) => evidenceFor(signal))
    ),
    dimension(
      "EFFECTIVE_HOURLY",
      hourly.score,
      weights.effectiveHourly,
      hourly.state,
      hourly.reason,
      hourly.evidence ? [hourly.evidence] : []
    ),
    dimension("WORKLOAD", workload.score, weights.workload, workload.state, workload.reason),
    dimension("FRICTION", friction.score, weights.friction, friction.state, friction.reason),
    dimension(
      "ELIGIBILITY",
      context.eligibility ? ELIGIBILITY_SCORE[context.eligibility] : null,
      weights.eligibility,
      context.eligibility ? "SUPPORTED" : "UNKNOWN",
      context.eligibility
        ? `The qualification check says ${context.eligibility.toLowerCase()}.`
        : "Eligibility has not been checked yet."
    ),
    dimension(
      "CONFIDENCE",
      context.confidence ? CONFIDENCE_SCORE[context.confidence] : null,
      weights.confidence,
      context.confidence ? "SUPPORTED" : "UNKNOWN",
      context.confidence
        ? `Posting confidence is ${context.confidence.toLowerCase()}.`
        : "There is not enough posting data to judge confidence."
    ),
    dimension(
      "FIT",
      context.fitScore === null ? null : clamp(context.fitScore),
      weights.fit,
      context.fitScore === null ? "UNKNOWN" : "SUPPORTED",
      context.fitScore === null
        ? "The profile fit has not been scored yet."
        : `Profile fit is ${Math.round(context.fitScore)} of 100.`
    ),
    dimension(
      "RISK",
      context.risk ? RISK_SCORE[context.risk] : null,
      weights.risk,
      context.risk ? "SUPPORTED" : "UNKNOWN",
      context.risk ? `Posting risk is ${context.risk.toLowerCase()}.` : "Risk has not been assessed."
    ),
  ]
}

function normalizeWeights(weights: OpportunityWeights): OpportunityWeights {
  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= 0) return PRESET_WEIGHTS.BALANCED
  const scale = 100 / total
  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, Math.max(0, value) * scale])
  ) as unknown as OpportunityWeights
}

function gradeFor(score: number, blocked: boolean): OpportunityGrade {
  if (blocked) return "BLOCKED"
  if (score >= 75) return "STRONG"
  if (score >= 55) return "DECENT"
  return "WEAK"
}

function rejectionsFor(
  input: OpportunityInput,
  compensation: CompensationReading,
  hourly: HourlyReading,
  workload: WorkloadReading,
  signals: PostingSignals
): OpportunityRejection[] {
  const out: OpportunityRejection[] = []
  const settings = input.settings
  const floor =
    settings.minimumAnnualPay && settings.minimumPayCurrency
      ? dec(settings.minimumAnnualPay)
      : null

  if (floor !== null) {
    if (settings.minimumPayCurrency !== compensation.currency) {
      out.push({
        code: "MINIMUM_PAY",
        message:
          "Your minimum pay is in a different currency from this posting, so it was not applied.",
        severity: "WARN",
      })
    } else if (compensation.annualMax !== null) {
      const below = compensation.annualMax.lt(floor)
      // A commission-only figure is not a promise, so it can never hard-block.
      const blockable = settings.minimumPayStrict && compensation.state === "SUPPORTED"
      if (below) {
        out.push({
          code: "MINIMUM_PAY",
          message: compensation.state === "SUPPORTED"
            ? "The posting's top of range is below your minimum pay."
            : "The stated pay is below your minimum, but the figure is not verified.",
          severity: blockable ? "BLOCK" : "WARN",
        })
      }
    }
  }

  if (compensation.state === "UNKNOWN" && compensation.min === null && compensation.max === null) {
    if (settings.unknownPay === "REJECT") {
      out.push({
        code: "UNKNOWN_PAY",
        message: "The posting does not state pay, and your settings reject unknown pay.",
        severity: "BLOCK",
      })
    } else if (settings.unknownPay === "FLAG") {
      out.push({
        code: "UNKNOWN_PAY",
        message: "The posting does not state pay.",
        severity: "WARN",
      })
    }
  }

  if (signals.commissionOnly) {
    out.push({
      code: "COMMISSION_ONLY",
      message:
        "The posting is commission-only, so any stated figure is an on-target estimate rather than guaranteed pay.",
      severity: "WARN",
    })
  }

  if (signals.interviewStages !== null && signals.interviewStages >= 5) {
    out.push({
      code: "WORKLOAD",
      message: `The hiring process has ${signals.interviewStages} stages.`,
      severity: "WARN",
    })
  }

  if (settings.workloadPreference === "LIGHTER" && workload.score !== null && workload.score < 35) {
    out.push({
      code: "WORKLOAD",
      message: "This role reads as heavier than the workload you said you want.",
      severity: "WARN",
    })
  }

  if (input.context.eligibility === "BLOCKER") {
    out.push({
      code: "ELIGIBILITY",
      message: "A stated requirement rules you out.",
      severity: "BLOCK",
    })
  }

  const restriction = signals.eligibility.find(
    (signal) => signal.id === "LOCATION_RESTRICTION" && signal.state === "SUPPORTED"
  )
  if (restriction) {
    out.push({
      code: "LOCATION_RESTRICTION",
      message: restriction.reason,
      severity: "WARN",
    })
  }

  if (
    compensation.period === "CONTRACT" &&
    compensation.annualMidpoint === null &&
    compensation.min !== null
  ) {
    out.push({
      code: "CONTRACT_TERM",
      message: "The posting quotes a contract total without a contract length, so it cannot be annualized.",
      severity: "WARN",
    })
  }

  return out
}

function explanationFor(
  dimensions: OpportunityDimension[],
  compensation: CompensationReading,
  hourly: HourlyReading,
  workload: WorkloadReading,
  friction: FrictionReading
): string[] {
  const lines: string[] = []
  const known = dimensions.filter((item) => item.score !== null)
  const best = [...known].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
  const worst = [...known].sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0]

  if (best) lines.push(`${best.label}: ${best.reason}`)
  if (worst && worst.id !== best?.id) lines.push(`${worst.label}: ${worst.reason}`)

  if (compensation.ratio !== null) {
    lines.push(
      `Pay is ${(compensation.ratio * 100).toFixed(0)}% of your expectation midpoint.`
    )
  }
  if (hourly.effectiveHourly !== null && hourly.hoursPerWeek !== null) {
    lines.push(
      `Effective hourly pay is about ${hourly.effectiveHourly.toFixed(2)} ${compensation.currency} at ${hourly.hoursPerWeek} hours a week.`
    )
  }
  if (workload.score === null) lines.push("Workload is unknown; nothing was assumed.")
  if (friction.score === null) lines.push("Application friction is unknown; nothing was assumed.")

  const unknown = dimensions.filter((item) => item.score === null)
  if (unknown.length > 0) {
    lines.push(
      `Not scored: ${unknown.map((item) => item.label.toLowerCase()).join(", ")}.`
    )
  }
  return lines
}

/**
 * Computes the value of one opportunity.
 *
 * The result is total: every input produces a value, because "we do not know
 * enough" is itself an answer — it shows as low coverage and explicit unknowns,
 * not as a middling score.
 */
export function computeOpportunityValue(input: OpportunityInput): OpportunityValue {
  const settings = input.settings
  const weights = normalizeWeights(settings.weights ?? PRESET_WEIGHTS[settings.preset])
  const signals = readPostingSignals({
    title: input.posting.title,
    description: input.posting.description ?? null,
    url: input.posting.url ?? null,
  })

  const compensation = readCompensation(input, signals)
  const hourly = readHourly(input, compensation, signals)
  const workload = readWorkload(signals, settings)
  const friction = readFriction(signals)
  const dimensions = buildDimensions(input, compensation, hourly, workload, friction, weights)

  const scored = dimensions.filter((item) => item.score !== null)
  const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0)
  const scoredWeight = scored.reduce((sum, item) => sum + item.weight, 0)
  const score =
    scoredWeight > 0
      ? clamp(scored.reduce((sum, item) => sum + (item.score ?? 0) * item.weight, 0) / scoredWeight)
      : 0
  const coverage = totalWeight > 0 ? scoredWeight / totalWeight : 0

  const rejections = rejectionsFor(input, compensation, hourly, workload, signals)
  const blocked = rejections.some((rejection) => rejection.severity === "BLOCK")

  return {
    score,
    grade: gradeFor(score, blocked),
    preset: settings.preset,
    dimensions,
    compensation,
    hourly,
    workload,
    friction,
    rejections,
    contradictions: signals.contradictions,
    accepted: !blocked,
    coverage,
    explanation: explanationFor(dimensions, compensation, hourly, workload, friction),
  }
}

/** True when a run should keep the posting at all. */
export function isOpportunityAccepted(value: OpportunityValue): boolean {
  return value.accepted
}

/** The annual floor the user set, in their own currency, or null. */
export function minimumAnnualPay(settings: OpportunitySettings): Decimal | null {
  if (!settings.minimumAnnualPay || !settings.minimumPayCurrency) return null
  try {
    return dec(settings.minimumAnnualPay)
  } catch {
    return null
  }
}

/** Working calendar the profile uses for hourly comparisons. */
export function hourlyCalendar(): HourlyCalendar {
  const calendar = payCalendar()
  return {
    hoursPerWeek: calendar.hoursPerYear.div(calendar.weeksPerYear).toNumber(),
    weeksPerYear: calendar.weeksPerYear.toNumber(),
  }
}
