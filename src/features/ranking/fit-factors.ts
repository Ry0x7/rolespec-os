import type { ExperienceLevel } from "@/generated/prisma/enums"

import { classifyMarketFit } from "@/features/discovery/services/market-fit.service"
import { JOB_REQUIREMENT_FLAGS } from "@/features/jobs/services/job-requirements.service"
import { hasComparableAnnualRange, parseSalary } from "./salary"
import type {
  FitFactor,
  FitFactorId,
  FitFactorState,
  RankingPosting,
  RankingProfile,
} from "./types"

/**
 * The seven deterministic fit factors behind a ranking score.
 *
 * Each factor is independent, reads only posting text plus confirmed profile
 * facts, and answers with one of MATCH / PARTIAL / MISMATCH / UNKNOWN. Missing
 * data is UNKNOWN: it earns no points, stays visible in the explanation, and
 * reduces the result's coverage rather than being rounded up to a match.
 *
 * No factor ever reads the posting as evidence of a capability the profile has
 * not confirmed. `SKILLS` only counts the user's confirmed capabilities that
 * the posting happens to mention.
 */

const WEIGHTS: Record<FitFactorId, number> = {
  SKILLS: 25,
  EXPERIENCE: 15,
  LOCATION: 15,
  WORK_MODE: 10,
  SALARY: 10,
  AUTHORIZATION: 15,
  FRESHNESS: 10,
}

const LABELS: Record<FitFactorId, string> = {
  SKILLS: "Skills",
  EXPERIENCE: "Experience level",
  LOCATION: "Location",
  WORK_MODE: "Work mode",
  SALARY: "Salary",
  AUTHORIZATION: "Work authorization",
  FRESHNESS: "Posting freshness",
}

/** Confirmed capabilities a posting should name before skills reads MATCH. */
const SKILLS_MATCH_THRESHOLD = 3

const SENIORITY_MARKERS: Array<{ level: ExperienceLevel; words: string[] }> = [
  { level: "EXECUTIVE", words: ["chief", "cto", "cio", "vp", "vice president", "director", "executive"] },
  { level: "LEAD", words: ["lead", "staff", "principal", "head of", "manager"] },
  { level: "SENIOR", words: ["senior", "sr"] },
  { level: "JUNIOR", words: ["junior", "jr", "intern", "internship", "entry level", "graduate", "trainee"] },
]

const LEVEL_RANK: Record<ExperienceLevel, number> = {
  JUNIOR: 0,
  MID: 1,
  SENIOR: 2,
  LEAD: 3,
  EXECUTIVE: 4,
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function mentions(haystack: string, needle: string): boolean {
  if (!needle) return false
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack)
}

function statePoints(state: FitFactorState): number {
  if (state === "MATCH") return 1
  if (state === "PARTIAL") return 0.5
  return 0
}

function factor(
  id: FitFactorId,
  state: FitFactorState,
  reason: string,
  evidence: string[] = []
): FitFactor {
  return { id, label: LABELS[id], state, weight: WEIGHTS[id], reason, evidence }
}

/** Seniority a title announces, or null when it names none. */
export function seniorityFromTitle(title: string): ExperienceLevel | null {
  const normalized = normalize(title)
  for (const marker of SENIORITY_MARKERS) {
    if (marker.words.some((word) => mentions(normalized, word))) return marker.level
  }
  return null
}

function skillsFactor(posting: RankingPosting, profile: RankingProfile): FitFactor {
  const confirmed = profile.capabilities
    .filter((capability) => capability.confirmed)
    .map((capability) => capability.name.trim())
    .filter((name) => name.length >= 2)
  if (confirmed.length === 0) {
    return factor("SKILLS", "UNKNOWN", "No confirmed capabilities in your profile yet.")
  }
  const description = posting.description ?? ""
  if (!description.trim()) {
    return factor("SKILLS", "UNKNOWN", "The posting has no description to compare with your skills.")
  }

  const haystack = normalize(`${posting.title} ${description}`)
  const matched = confirmed.filter((name) => mentions(haystack, normalize(name)))
  if (matched.length === 0) {
    return factor(
      "SKILLS",
      "MISMATCH",
      `None of your ${confirmed.length} confirmed skills appear in this posting.`,
      []
    )
  }
  const state: FitFactorState =
    matched.length >= Math.min(SKILLS_MATCH_THRESHOLD, confirmed.length)
      ? "MATCH"
      : "PARTIAL"
  return factor(
    "SKILLS",
    state,
    `The posting names ${matched.length} of your ${confirmed.length} confirmed skills.`,
    matched
  )
}

function experienceFactor(posting: RankingPosting, profile: RankingProfile): FitFactor {
  const postedLevel = seniorityFromTitle(posting.title)
  if (!postedLevel) {
    return factor("EXPERIENCE", "UNKNOWN", "The title does not state a seniority level.")
  }
  if (!profile.experienceLevel) {
    return factor("EXPERIENCE", "UNKNOWN", "Your profile has no experience level set.")
  }

  const difference = LEVEL_RANK[postedLevel] - LEVEL_RANK[profile.experienceLevel]
  if (difference > 1) {
    return factor(
      "EXPERIENCE",
      "MISMATCH",
      `The role is ${postedLevel.toLowerCase()}, above your ${profile.experienceLevel.toLowerCase()} level.`,
      [posting.title]
    )
  }
  if (difference < -1) {
    return factor(
      "EXPERIENCE",
      "PARTIAL",
      `The role is ${postedLevel.toLowerCase()}, below your ${profile.experienceLevel.toLowerCase()} level.`,
      [posting.title]
    )
  }
  return factor(
    "EXPERIENCE",
    "MATCH",
    `The role's ${postedLevel.toLowerCase()} level matches your profile.`,
    [posting.title]
  )
}

function locationFactor(posting: RankingPosting, profile: RankingProfile): FitFactor {
  const fit = classifyMarketFit(
    {
      location: posting.location ?? null,
      workTypeHint: posting.workType ?? null,
      description: posting.description ?? null,
      url: posting.url ?? null,
    },
    { locations: profile.locations, openToRelocation: profile.openToRelocation }
  )

  if (fit.fit === "RESTRICTED") {
    if (profile.openToRelocation) {
      return factor(
        "LOCATION",
        "PARTIAL",
        `${fit.reason} You are open to relocating, so this is not ruled out.`,
        [fit.restrictedTo ?? fit.label]
      )
    }
    return factor("LOCATION", "MISMATCH", fit.reason, [fit.restrictedTo ?? fit.label])
  }
  if (fit.fit === "UNKNOWN") {
    return factor("LOCATION", "UNKNOWN", fit.reason)
  }
  return factor("LOCATION", "MATCH", fit.reason, [fit.label])
}

function workModeFactor(posting: RankingPosting, profile: RankingProfile): FitFactor {
  if (!posting.workType) {
    return factor("WORK_MODE", "UNKNOWN", "The posting does not state a work mode.")
  }
  if (profile.workModes.length === 0) {
    return factor("WORK_MODE", "UNKNOWN", "Your profile does not state preferred work modes.")
  }
  if (profile.workModes.includes(posting.workType)) {
    return factor(
      "WORK_MODE",
      "MATCH",
      `${posting.workType.toLowerCase()} is one of your preferred work modes.`
    )
  }
  return factor(
    "WORK_MODE",
    "MISMATCH",
    `The posting is ${posting.workType.toLowerCase()}, outside your preferred work modes.`,
    [posting.workType]
  )
}

function salaryFactor(posting: RankingPosting, profile: RankingProfile): FitFactor {
  const postingSalary = parseSalary({
    salaryText: posting.salaryText,
    salary: posting.salary,
    currency: posting.salaryCurrency,
    period: posting.salaryPeriod,
  })
  if (!postingSalary || postingSalary.min === null) {
    return factor("SALARY", "UNKNOWN", "The posting does not state pay.")
  }
  if (!hasComparableAnnualRange(postingSalary)) {
    return factor(
      "SALARY",
      "UNKNOWN",
      "The posting's currency or pay period could not be read, so it cannot be compared."
    )
  }

  const profileSalary = parseSalary({
    salary: profile.salaryMin ?? undefined,
    currency: profile.salaryCurrency,
    period: profile.salaryPeriod,
  })
  // The upper bound is part of the profile preference, not a second posting.
  const profileMax =
    profile.salaryMax ?? profile.salaryMin ?? null
  if (
    profileSalary === null ||
    !hasComparableAnnualRange(profileSalary) ||
    profileMax === null
  ) {
    return factor("SALARY", "UNKNOWN", "Your profile does not state a comparable salary range.")
  }
  if (postingSalary.currency !== profileSalary.currency) {
    return factor(
      "SALARY",
      "UNKNOWN",
      `The posting pays in ${postingSalary.currency}; your preference is in ${profileSalary.currency}. No exchange rate is assumed.`
    )
  }

  const preferredMin = profileSalary.annualMin
  const preferredMax = annualizeProfileMax(profileMax, profileSalary)
  if (preferredMax === null) {
    return factor("SALARY", "UNKNOWN", "Your salary ceiling could not be normalized.")
  }
  if (postingSalary.annualMax < preferredMin) {
    return factor(
      "SALARY",
      "MISMATCH",
      "The posting's pay is below the minimum you set.",
      [posting.salaryText ?? ""]
    )
  }
  return factor(
    "SALARY",
    "MATCH",
    "The posting's pay overlaps the range you set.",
    [posting.salaryText ?? ""]
  )
}

function annualizeProfileMax(
  max: number,
  normalized: { annualMin: number; annualMax: number; min: number | null; max: number | null }
): number | null {
  // The profile bounds are in one currency/period; normalize the ceiling with
  // the same annualization the floor already went through.
  if (normalized.min === null || normalized.max === null) return null
  if (normalized.max === normalized.min) {
    // A single value: derive the multiplier from the annual floor.
    return normalized.annualMin === 0 ? null : Math.round((normalized.annualMin / normalized.min) * max)
  }
  const multiplier = normalized.annualMax / normalized.max
  return Math.round(max * multiplier)
}

function authorizationFactor(posting: RankingPosting, profile: RankingProfile): FitFactor {
  if (profile.requiresSponsorship === null) {
    return factor(
      "AUTHORIZATION",
      "UNKNOWN",
      "Your profile does not say whether you need sponsorship."
    )
  }
  if (profile.requiresSponsorship === false) {
    return factor(
      "AUTHORIZATION",
      "MATCH",
      "You do not require sponsorship, so this posting's authorization stance is not a barrier."
    )
  }

  const flags = new Set(posting.requirementFlags ?? [])
  if (flags.has(JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP)) {
    return factor(
      "AUTHORIZATION",
      "MISMATCH",
      "The posting states it does not sponsor work visas, and you need sponsorship.",
      [JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP]
    )
  }
  if (flags.has(JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE)) {
    return factor(
      "AUTHORIZATION",
      "MATCH",
      "The posting states sponsorship is available.",
      [JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE]
    )
  }
  return factor(
    "AUTHORIZATION",
    "UNKNOWN",
    "The posting does not say whether it sponsors visas."
  )
}

function freshnessFactor(posting: RankingPosting, now: Date): FitFactor {
  if (!posting.postedAt) {
    return factor("FRESHNESS", "UNKNOWN", "The posting has no publication date.")
  }
  const posted = new Date(posting.postedAt)
  if (Number.isNaN(posted.getTime())) {
    return factor("FRESHNESS", "UNKNOWN", "The posting's publication date could not be read.")
  }
  const days = Math.floor((now.getTime() - posted.getTime()) / 86_400_000)
  if (days <= 14) {
    return factor("FRESHNESS", "MATCH", days <= 0 ? "Posted today." : `Posted ${days} day(s) ago.`)
  }
  if (days <= 30) {
    return factor("FRESHNESS", "PARTIAL", `Posted ${days} days ago.`)
  }
  return factor("FRESHNESS", "MISMATCH", `Posted ${days} days ago; it may already be filled.`)
}

/** Evaluates all seven factors in a fixed order. */
export function evaluateFitFactors(
  posting: RankingPosting,
  profile: RankingProfile,
  now: Date = new Date()
): FitFactor[] {
  return [
    skillsFactor(posting, profile),
    experienceFactor(posting, profile),
    locationFactor(posting, profile),
    workModeFactor(posting, profile),
    salaryFactor(posting, profile),
    authorizationFactor(posting, profile),
    freshnessFactor(posting, now),
  ]
}

export interface FitScore {
  /** 0-100 weighted points. UNKNOWN and MISMATCH earn nothing. */
  score: number
  /** Share of the 100 points backed by known data, 0-1. */
  coverage: number
}

/** Weighted score. Unknown weight stays in the denominator. */
export function scoreFitFactors(factors: readonly FitFactor[]): FitScore {
  const totalWeight = factors.reduce((sum, entry) => sum + entry.weight, 0)
  if (totalWeight === 0) return { score: 0, coverage: 0 }
  const points = factors.reduce(
    (sum, entry) => sum + entry.weight * statePoints(entry.state),
    0
  )
  const knownWeight = factors
    .filter((entry) => entry.state !== "UNKNOWN")
    .reduce((sum, entry) => sum + entry.weight, 0)
  return {
    score: Math.round((points / totalWeight) * 100),
    coverage: knownWeight / totalWeight,
  }
}
