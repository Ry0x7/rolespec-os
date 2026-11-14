import type { ExperienceLevel, SalaryPeriod, SalaryCurrency, WorkType } from "@/generated/prisma/enums"
import { extractRequirementTerms } from "@/shared/lib/application-grounding"
import { annualizeSalary, formatSalary } from "../components/job-form-options"
import type { JobRequirementFlag } from "./job-requirements.service"

export interface IntelligentMatchingProfile {
  experienceLevel?: ExperienceLevel | null
  locations?: string[]
  workModes?: WorkType[]
  workAuthorization?: string | null
  requiresSponsorship?: boolean | null
  salaryMin?: number | null
  salaryMax?: number | null
  salaryPeriod?: SalaryPeriod | null
  salaryCurrency?: SalaryCurrency
  capabilities?: Array<{
    name: string
    depth?: "EXPOSURE" | "WORKING" | "DEEP"
    confirmedCount?: number
  }>
}

export interface IntelligentMatchingJob {
  title: string
  description?: string | null
  location?: string | null
  workType?: WorkType | null
  salary?: number | null
  salaryPeriod?: SalaryPeriod | null
  salaryCurrency?: SalaryCurrency
  postedAt?: Date | null
  requirementFlags?: JobRequirementFlag[] | string[] | null
}

export type DimensionStatus = "GOOD" | "NEUTRAL" | "CONCERN" | "BLOCKED" | "UNKNOWN"

export interface DimensionScore {
  /** Null means the inputs needed to judge this dimension were not available. */
  score: number | null
  weight: number
  label: string
  status: DimensionStatus
  explanation: string
}

export type MatchDimensionKey =
  | "eligibility"
  | "skills"
  | "evidence"
  | "experience"
  | "locationAndWorkMode"
  | "salary"
  | "freshness"

export interface IntelligentMatchingResult {
  /**
   * Weighted score over the dimensions that had enough evidence. Null when
   * less than half the weight could be judged, rather than guessing the rest.
   */
  compositeScore: number | null
  priority: "HIGH" | "MODERATE" | "LOW" | "INELIGIBLE" | "UNKNOWN"
  summary: string
  dimensions: Record<MatchDimensionKey, DimensionScore>
  /** Sum of weights for the dimensions with a real score, 0–1. */
  knownWeight: number
  /** How many of the seven dimensions had enough evidence to score. */
  knownDimensions: number
  strengths: string[]
  gaps: string[]
}

const DIMENSION_WEIGHTS = {
  eligibility: 0.25,
  skills: 0.25,
  evidence: 0.15,
  experience: 0.15,
  locationAndWorkMode: 0.1,
  salary: 0.05,
  freshness: 0.05,
} as const satisfies Record<MatchDimensionKey, number>

const SENIORITY_RANKS: Record<ExperienceLevel, number> = {
  JUNIOR: 1,
  MID: 2,
  SENIOR: 3,
  LEAD: 4,
  EXECUTIVE: 5,
}

const SENIORITY_PATTERNS: Array<{ level: ExperienceLevel; pattern: RegExp }> = [
  { level: "EXECUTIVE", pattern: /\b(vp|vice president|director|head of|chief|c-level|cxo)\b/i },
  { level: "LEAD", pattern: /\b(lead|principal|staff|architect|manager)\b/i },
  { level: "SENIOR", pattern: /\b(senior|sr\.?|advanced)\b/i },
  { level: "JUNIOR", pattern: /\b(junior|jr\.?|entry[- ]level|associate|intern|graduate)\b/i },
  { level: "MID", pattern: /\b(mid[- ]level|intermediate)\b/i },
]

export function detectJobSeniority(title: string): ExperienceLevel | null {
  for (const { level, pattern } of SENIORITY_PATTERNS) {
    if (pattern.test(title)) return level
  }
  return null
}

function unknownDimension(
  key: MatchDimensionKey,
  explanation: string,
  status: DimensionStatus = "UNKNOWN"
): DimensionScore {
  return {
    score: null,
    weight: DIMENSION_WEIGHTS[key],
    label: DIMENSION_LABELS[key],
    status,
    explanation,
  }
}

const DIMENSION_LABELS: Record<MatchDimensionKey, string> = {
  eligibility: "Eligibility & Authorization",
  skills: "Skills & Capabilities",
  evidence: "Verified Evidence",
  experience: "Experience & Seniority",
  locationAndWorkMode: "Location & Work Mode",
  salary: "Salary Alignment",
  freshness: "Posting Freshness",
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Whole-token match, so React never matches Reactive Streams. */
function containsTerm(text: string, term: string): boolean {
  if (!text.trim() || !term.trim()) return false
  return new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(term)}([^a-z0-9+#]|$)`, "i").test(text)
}

/**
 * The posting names a requirement and the profile capability backs it.
 *
 * One direction only: the capability has to contain the whole requirement.
 * The reverse used to count "React" as evidence for "React Native", which
 * turned a partial match into a full one and inflated the score.
 */
function capabilityMatchesTerm(capability: string, term: string): boolean {
  return (
    containsTerm(capability, term) ||
    capability.trim().toLowerCase() === term.trim().toLowerCase()
  )
}

/**
 * Claims end at punctuation and contrasts, so an unrelated negation earlier in
 * the sentence ("I don't need sponsorship, authorized to work in the US")
 * cannot negate a later, positive claim.
 */
const CLAIM_SEGMENT = /[.;,\n]+|\b(?:but|however|although|though|yet|and)\b/i

/** Words that negate the claim that follows them in the same segment. */
const NEGATION = /\b(?:not|no|never|without|cannot|can't|unable|neither|nor|don't|doesn't|isn't|aren't)\b/i

/** A statement of citizenship or work authorization, with its position. */
const AUTHORIZATION_CLAIM =
  /\b(?:citizen(?:ship)?|authori[sz]ed|authori[sz]ation|permanent resident|green card|work permit|eligible to work)\b/i

const US_MENTION = /\b(?:us|u\.s\.|usa|united states)\b/i

/** True when the claim in `segment` is preceded by a negation in that segment. */
function isNegatedClaim(segment: string, claimIndex: number): boolean {
  return NEGATION.test(segment.slice(0, claimIndex))
}

function segments(value: string): string[] {
  return value.split(CLAIM_SEGMENT).map((segment) => segment.trim())
}

/**
 * The profile explicitly says it is authorized to work in the US.
 *
 * Free text is read one claim at a time and a negated claim never counts:
 * "not authorized to work in the US" used to satisfy the positive regex and
 * turned a disqualifying statement into a perfect eligibility score.
 */
function hasUsWorkAuthorization(value: string | null | undefined): boolean {
  if (!value) return false
  return segments(value).some((segment) => {
    if (!US_MENTION.test(segment)) return false
    const claim = AUTHORIZATION_CLAIM.exec(segment)
    if (!claim) return false
    return !isNegatedClaim(segment, claim.index)
  })
}

/** The profile explicitly claims citizenship, and not only to deny it. */
function claimsCitizenship(value: string | null | undefined): boolean {
  if (!value) return false
  return segments(value).some((segment) => {
    const claim = /\bcitizen(?:ship)?\b/i.exec(segment)
    return Boolean(claim && !isNegatedClaim(segment, claim.index))
  })
}

function formatAnnual(amount: number, currency: SalaryCurrency | undefined): string {
  return formatSalary(Math.round(amount), null, currency)
}

export function computeIntelligentMatch(
  job: IntelligentMatchingJob,
  profile: IntelligentMatchingProfile,
  now: Date = new Date()
): IntelligentMatchingResult {
  const strengths: string[] = []
  const gaps: string[] = []

  // 1. Eligibility — only call a blocker when both sides state a conflict.
  const flags = (job.requirementFlags ?? []).map((flag) => String(flag).toUpperCase())
  const requiresSponsorship = profile.requiresSponsorship
  let eligibility: DimensionScore

  if (requiresSponsorship === true && flags.includes("NO_SPONSORSHIP")) {
    eligibility = {
      score: 0,
      weight: DIMENSION_WEIGHTS.eligibility,
      label: DIMENSION_LABELS.eligibility,
      status: "BLOCKED",
      explanation:
        "The posting says it offers no visa sponsorship, and the Career Profile says you require sponsorship.",
    }
    gaps.push("No visa sponsorship available")
  } else if (flags.includes("NO_SPONSORSHIP")) {
    if (requiresSponsorship === false) {
      eligibility = {
        score: 100,
        weight: DIMENSION_WEIGHTS.eligibility,
        label: DIMENSION_LABELS.eligibility,
        status: "GOOD",
        explanation:
          "The posting offers no visa sponsorship, and the Career Profile says you do not require it.",
      }
      strengths.push("Does not need the sponsorship the posting withholds")
    } else {
      eligibility = unknownDimension(
        "eligibility",
        "The posting offers no visa sponsorship, but the Career Profile has not answered whether you need it."
      )
    }
  } else if (flags.includes("SPONSORSHIP_AVAILABLE")) {
    eligibility = {
      score: 100,
      weight: DIMENSION_WEIGHTS.eligibility,
      label: DIMENSION_LABELS.eligibility,
      status: "GOOD",
      explanation: "The posting explicitly states that visa sponsorship is available.",
    }
    strengths.push("Posting offers visa sponsorship")
  } else if (flags.includes("SECURITY_CLEARANCE")) {
    eligibility = unknownDimension(
      "eligibility",
      "The posting requires a security clearance. The Career Profile has no clearance field, so eligibility cannot be confirmed."
    )
    gaps.push("Check the security clearance requirement before applying")
  } else if (flags.includes("CITIZENSHIP_REQUIRED")) {
    if (claimsCitizenship(profile.workAuthorization)) {
      eligibility = {
        score: 100,
        weight: DIMENSION_WEIGHTS.eligibility,
        label: DIMENSION_LABELS.eligibility,
        status: "GOOD",
        explanation:
          "The posting requires citizenship, and the Career Profile states citizenship.",
      }
      strengths.push("Profile states citizenship for a citizenship-restricted posting")
    } else {
      eligibility = unknownDimension(
        "eligibility",
        "The posting requires citizenship, but the Career Profile does not state citizenship. A listed location is not proof of citizenship."
      )
      gaps.push("Check the citizenship requirement before applying")
    }
  } else if (flags.includes("US_ONLY")) {
    if (hasUsWorkAuthorization(profile.workAuthorization)) {
      eligibility = {
        score: 100,
        weight: DIMENSION_WEIGHTS.eligibility,
        label: DIMENSION_LABELS.eligibility,
        status: "GOOD",
        explanation:
          "The posting is US-restricted, and the Career Profile states US work authorization.",
      }
      strengths.push("Profile states US work authorization")
    } else {
      eligibility = unknownDimension(
        "eligibility",
        "The posting is US-restricted, but the Career Profile does not state US work authorization. A listed location is not proof of authorization."
      )
      gaps.push("Confirm US work authorization before applying")
    }
  } else if (requiresSponsorship === true) {
    eligibility = unknownDimension(
      "eligibility",
      "The Career Profile says you require sponsorship, but this posting does not state whether sponsorship is available."
    )
  } else if (flags.length === 0) {
    eligibility = unknownDimension(
      "eligibility",
      "The posting states no eligibility restrictions, and the Career Profile has no work-authorization facts to compare."
    )
  } else {
    eligibility = unknownDimension(
      "eligibility",
      "The posting's eligibility requirements are not specific enough to compare with the Career Profile."
    )
  }

  // 2. Skills — requirements the posting actually names, matched against profile capabilities.
  const capabilities = profile.capabilities ?? []
  const requirementTerms = extractRequirementTerms(job.description ?? "", [job.title]).slice(0, 12)
  let skills: DimensionScore

  if (requirementTerms.length === 0) {
    skills = unknownDimension(
      "skills",
      "The posting does not name specific skills or tools, so there is nothing to match against the profile."
    )
  } else if (capabilities.length === 0) {
    skills = unknownDimension(
      "skills",
      `The posting names ${requirementTerms.length} requirement${requirementTerms.length === 1 ? "" : "s"}, but the Career Profile has no capabilities to compare.`
    )
  } else {
    const matched = requirementTerms.filter((term) =>
      capabilities.some((capability) => capabilityMatchesTerm(capability.name, term))
    )
    const missing = requirementTerms.filter((term) => !matched.includes(term))
    const score = Math.round((matched.length / requirementTerms.length) * 100)
    const missingText = missing.slice(0, 4).join(", ")
    const matchedText = matched.slice(0, 4).join(", ")

    skills = {
      score,
      weight: DIMENSION_WEIGHTS.skills,
      label: DIMENSION_LABELS.skills,
      status: score >= 70 ? "GOOD" : score >= 40 ? "NEUTRAL" : "CONCERN",
      explanation:
        `${matched.length} of ${requirementTerms.length} posting requirements are backed by the Career Profile` +
        `${matchedText ? ` (${matchedText})` : ""}` +
        `${missingText ? `. Not evidenced: ${missingText}${missing.length > 4 ? `, +${missing.length - 4} more` : ""}` : ""}.`,
    }

    if (matched.length > 0) {
      strengths.push(`Profile backs ${matched.length} posting requirement${matched.length === 1 ? "" : "s"}: ${matchedText}`)
    }
    if (missing.length > 0) {
      gaps.push(
        `Profile does not yet show ${missing.length} named requirement${missing.length === 1 ? "" : "s"}: ${missingText}${missing.length > 4 ? `, +${missing.length - 4} more` : ""}`
      )
    }
  }

  // 3. Verified evidence — profile quality, not a guess about the posting.
  let evidence: DimensionScore
  if (capabilities.length === 0) {
    evidence = unknownDimension(
      "evidence",
      "The Career Profile has no capabilities, so there is no confirmed evidence to measure."
    )
  } else {
    const confirmedCount = capabilities.filter((capability) => (capability.confirmedCount ?? 0) > 0).length
    const score = Math.round((confirmedCount / capabilities.length) * 100)
    evidence = {
      score,
      weight: DIMENSION_WEIGHTS.evidence,
      label: DIMENSION_LABELS.evidence,
      status: score >= 70 ? "GOOD" : score >= 40 ? "NEUTRAL" : "CONCERN",
      explanation: `${confirmedCount} of ${capabilities.length} profile capabilities are backed by confirmed career evidence; ${capabilities.length - confirmedCount} are not.`,
    }
    if (confirmedCount > 0) {
      strengths.push(`${confirmedCount} profile capabilit${confirmedCount === 1 ? "y is" : "ies are"} backed by confirmed evidence`)
    }
    if (confirmedCount < capabilities.length) {
      gaps.push(`${capabilities.length - confirmedCount} profile capabilities still need confirmed evidence`)
    }
  }

  // 4. Experience — only when both the posting and the profile name a level.
  // Title only: a description that mentions "senior engineers" says who you
  // would work with, not what level the role is.
  const jobLevel = detectJobSeniority(job.title)
  let experience: DimensionScore
  if (!jobLevel) {
    experience = unknownDimension(
      "experience",
      "The posting title does not name a seniority level, so the profile's level cannot be compared."
    )
  } else if (!profile.experienceLevel) {
    experience = unknownDimension(
      "experience",
      `The posting is ${jobLevel.toLowerCase()}-level, but the Career Profile does not set a seniority level.`
    )
  } else {
    const rankDiff = Math.abs(SENIORITY_RANKS[jobLevel] - SENIORITY_RANKS[profile.experienceLevel])
    const score = rankDiff === 0 ? 100 : rankDiff === 1 ? 75 : 40
    experience = {
      score,
      weight: DIMENSION_WEIGHTS.experience,
      label: DIMENSION_LABELS.experience,
      status: rankDiff === 0 ? "GOOD" : rankDiff === 1 ? "NEUTRAL" : "CONCERN",
      explanation:
        rankDiff === 0
          ? `The posting and the Career Profile both target ${jobLevel.toLowerCase()}-level roles.`
          : `The posting is ${jobLevel.toLowerCase()}-level; the Career Profile is ${profile.experienceLevel.toLowerCase()}-level.`,
    }
    if (rankDiff === 0) strengths.push(`Seniority target aligns (${jobLevel.toLowerCase()})`)
    else if (rankDiff > 1) gaps.push(`Seniority difference (${jobLevel} vs ${profile.experienceLevel})`)
  }

  // 5. Location / work mode — never assume a preference that was not set.
  const workModes = profile.workModes ?? []
  let locationAndWorkMode: DimensionScore
  if (!job.workType) {
    locationAndWorkMode = unknownDimension(
      "locationAndWorkMode",
      "The posting does not state whether the role is remote, hybrid or on-site."
    )
  } else if (workModes.length === 0) {
    locationAndWorkMode = unknownDimension(
      "locationAndWorkMode",
      `The posting is ${job.workType.toLowerCase()}, but the Career Profile lists no preferred work modes.`
    )
  } else if (workModes.includes(job.workType)) {
    locationAndWorkMode = {
      score: 100,
      weight: DIMENSION_WEIGHTS.locationAndWorkMode,
      label: DIMENSION_LABELS.locationAndWorkMode,
      status: "GOOD",
      explanation: `Posting work mode (${job.workType.toLowerCase()}) is in the Career Profile's preferred modes (${workModes.join(", ").toLowerCase()}).`,
    }
    strengths.push(`Preferred work mode (${job.workType.toLowerCase()})`)
  } else {
    locationAndWorkMode = {
      score: 40,
      weight: DIMENSION_WEIGHTS.locationAndWorkMode,
      label: DIMENSION_LABELS.locationAndWorkMode,
      status: "CONCERN",
      explanation: `Posting is ${job.workType.toLowerCase()}, but the Career Profile prefers ${workModes.join(", ").toLowerCase()}.`,
    }
    gaps.push(`Work mode differs (${job.workType.toLowerCase()})`)
  }

  // 6. Salary — annualize both sides; never compare across currencies without a rate.
  const jobCurrency = job.salaryCurrency ?? "USD"
  const profileCurrency = profile.salaryCurrency ?? "USD"
  const jobAnnual =
    job.salary != null && job.salary > 0 ? annualizeSalary(job.salary, job.salaryPeriod ?? null) : null
  const profileAnnual =
    profile.salaryMin != null && profile.salaryMin > 0
      ? annualizeSalary(profile.salaryMin, profile.salaryPeriod ?? null)
      : null
  let salary: DimensionScore

  if (jobAnnual === null) {
    salary = unknownDimension("salary", "The posting does not state a salary, so it cannot be compared with your minimum.")
  } else if (profileAnnual === null) {
    salary = unknownDimension(
      "salary",
      `The posting pays ${formatAnnual(jobAnnual, jobCurrency)}, but the Career Profile does not set a minimum salary.`
    )
  } else if (jobCurrency !== profileCurrency) {
    salary = unknownDimension(
      "salary",
      `The posting pays ${formatAnnual(jobAnnual, jobCurrency)}; your minimum is ${formatAnnual(profileAnnual, profileCurrency)}. The currencies differ, so compare them manually.`
    )
  } else {
    const meetsMinimum = jobAnnual >= profileAnnual
    salary = {
      score: meetsMinimum ? 100 : 40,
      weight: DIMENSION_WEIGHTS.salary,
      label: DIMENSION_LABELS.salary,
      status: meetsMinimum ? "GOOD" : "CONCERN",
      explanation: `The posting pays ${formatAnnual(jobAnnual, jobCurrency)}; your minimum is ${formatAnnual(profileAnnual, profileCurrency)}.`,
    }
    if (meetsMinimum) strengths.push("Stated pay meets your minimum")
    else gaps.push("Stated pay is below your minimum")
  }

  // 7. Freshness — only the posting's own date says how old the posting is.
  // The date this app discovered or saved it is a different fact: a two-month-old
  // listing saved today would otherwise be reported as a fresh posting.
  const postedMs = job.postedAt ? new Date(job.postedAt).getTime() : Number.NaN
  let freshness: DimensionScore
  if (!job.postedAt || !Number.isFinite(postedMs)) {
    freshness = unknownDimension(
      "freshness",
      "The posting has no usable published date, so its age is unknown."
    )
  } else {
    const ageInDays = Math.max(0, (now.getTime() - postedMs) / (1000 * 60 * 60 * 24))
    if (ageInDays <= 7) {
      freshness = {
        score: 100,
        weight: DIMENSION_WEIGHTS.freshness,
        label: DIMENSION_LABELS.freshness,
        status: "GOOD",
        explanation: `Posted within the last 7 days (${Math.round(ageInDays)} days old).`,
      }
      strengths.push("Fresh posting (less than a week old)")
    } else if (ageInDays <= 21) {
      freshness = {
        score: 80,
        weight: DIMENSION_WEIGHTS.freshness,
        label: DIMENSION_LABELS.freshness,
        status: "GOOD",
        explanation: `Active posting (${Math.round(ageInDays)} days old).`,
      }
    } else if (ageInDays <= 45) {
      freshness = {
        score: 60,
        weight: DIMENSION_WEIGHTS.freshness,
        label: DIMENSION_LABELS.freshness,
        status: "NEUTRAL",
        explanation: `Posted over 3 weeks ago (${Math.round(ageInDays)} days old).`,
      }
    } else {
      freshness = {
        score: 30,
        weight: DIMENSION_WEIGHTS.freshness,
        label: DIMENSION_LABELS.freshness,
        status: "CONCERN",
        explanation: `Older posting (${Math.round(ageInDays)} days old); verify that the role is still open.`,
      }
      gaps.push("Older posting")
    }
  }

  const dimensions: Record<MatchDimensionKey, DimensionScore> = {
    eligibility,
    skills,
    evidence,
    experience,
    locationAndWorkMode,
    salary,
    freshness,
  }

  const dimensionsKnown = Object.values(dimensions).filter(
    (dimension): dimension is DimensionScore & { score: number } => dimension.score !== null
  )
  const knownWeight = dimensionsKnown.reduce((sum, dimension) => sum + dimension.weight, 0)
  const unknownLabels = Object.values(dimensions)
    .filter((dimension) => dimension.score === null)
    .map((dimension) => dimension.label)

  let compositeScore: number | null
  if (eligibility.status === "BLOCKED") {
    compositeScore = 0
  } else if (knownWeight < 0.5) {
    compositeScore = null
  } else {
    compositeScore = Math.round(
      dimensionsKnown.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0) / knownWeight
    )
  }

  let priority: IntelligentMatchingResult["priority"]
  if (eligibility.status === "BLOCKED") priority = "INELIGIBLE"
  else if (compositeScore === null) priority = "UNKNOWN"
  else if (compositeScore >= 78) priority = "HIGH"
  else if (compositeScore >= 60) priority = "MODERATE"
  else priority = "LOW"

  const factorLine = `Based on ${dimensionsKnown.length} of 7 factors (${Math.round(knownWeight * 100)}% of the score weight).`
  const unknownLine = unknownLabels.length > 0 ? ` Unknown: ${unknownLabels.join(", ")}.` : ""

  let summary: string
  if (eligibility.status === "BLOCKED") {
    summary = `Ineligible: the posting and the Career Profile conflict on sponsorship. ${factorLine}${unknownLine}`
  } else if (compositeScore === null) {
    summary = `Not enough evidence to score this job. ${factorLine}${unknownLine}`
  } else {
    const verdict =
      priority === "HIGH"
        ? "Strong evidence match"
        : priority === "MODERATE"
          ? "Moderate evidence match"
          : "Limited evidence match"
    summary = `${verdict} (${compositeScore}%). ${factorLine}${unknownLine}`
  }

  return {
    compositeScore,
    priority,
    summary,
    dimensions,
    knownWeight,
    knownDimensions: dimensionsKnown.length,
    strengths,
    gaps,
  }
}
