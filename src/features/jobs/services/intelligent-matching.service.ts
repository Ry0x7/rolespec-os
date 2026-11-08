import type { ExperienceLevel, SalaryPeriod, SalaryCurrency, WorkType } from "@/generated/prisma/enums"
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
  deadline?: Date | null
  postedAt?: Date | null
  discoveredAt?: Date | null
  requirementFlags?: JobRequirementFlag[] | string[] | null
}

export interface DimensionScore {
  score: number // 0-100
  weight: number // 0-1
  label: string
  status: "GOOD" | "NEUTRAL" | "CONCERN" | "BLOCKED"
  explanation: string
}

export interface IntelligentMatchingResult {
  compositeScore: number // 0-100
  priority: "HIGH" | "MODERATE" | "LOW" | "INELIGIBLE"
  summary: string
  dimensions: {
    evidence: DimensionScore
    skills: DimensionScore
    experience: DimensionScore
    locationAndWorkMode: DimensionScore
    salary: DimensionScore
    eligibility: DimensionScore
    freshness: DimensionScore
  }
  strengths: string[]
  gaps: string[]
}

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

export function detectJobSeniority(title: string, description: string = ""): ExperienceLevel | null {
  for (const { level, pattern } of SENIORITY_PATTERNS) {
    if (pattern.test(title)) return level
  }
  for (const { level, pattern } of SENIORITY_PATTERNS) {
    if (pattern.test(description)) return level
  }
  return null
}

export function computeIntelligentMatch(
  job: IntelligentMatchingJob,
  profile: IntelligentMatchingProfile,
  now: Date = new Date()
): IntelligentMatchingResult {
  const text = `${job.title} ${job.description ?? ""}`.toLowerCase()
  const strengths: string[] = []
  const gaps: string[] = []

  // 1. Eligibility Check (Sponsorship & Work Authorization)
  let eligibilityScore = 100
  let eligibilityStatus: "GOOD" | "NEUTRAL" | "CONCERN" | "BLOCKED" = "GOOD"
  let eligibilityExplanation = "Eligibility criteria satisfied based on profile requirements."

  const flags = (job.requirementFlags ?? []).map((f) => String(f).toUpperCase())
  const requiresSponsorship = profile.requiresSponsorship === true
  const noSponsorshipFlag = flags.includes("NO_SPONSORSHIP")
  const usOnlyFlag = flags.includes("US_ONLY")
  const securityClearanceFlag = flags.includes("SECURITY_CLEARANCE")

  if (requiresSponsorship && noSponsorshipFlag) {
    eligibilityScore = 0
    eligibilityStatus = "BLOCKED"
    eligibilityExplanation = "Job explicitly states no visa sponsorship, but profile requires sponsorship."
    gaps.push("No visa sponsorship available")
  } else if (securityClearanceFlag) {
    eligibilityScore = 30
    eligibilityStatus = "CONCERN"
    eligibilityExplanation = "Posting specifies security clearance requirement; check eligibility."
    gaps.push("Requires security clearance")
  } else if (usOnlyFlag && profile.locations && profile.locations.length > 0 && !profile.locations.some(l => /us|usa|united states/i.test(l))) {
    eligibilityScore = 40
    eligibilityStatus = "CONCERN"
    eligibilityExplanation = "Job is marked US-only and profile does not list a US location."
    gaps.push("US-only location restriction")
  } else {
    strengths.push("Meets stated eligibility and sponsorship criteria")
  }

  // 2. Skills Overlap & Depth
  let skillsScore = 50
  let skillsStatus: "GOOD" | "NEUTRAL" | "CONCERN" = "NEUTRAL"
  let skillsExplanation = "No specific capability list found in profile."

  if (profile.capabilities && profile.capabilities.length > 0) {
    let matchedWeight = 0
    let totalCapWeight = 0
    const matchedCaps: string[] = []
    const missingCaps: string[] = []

    for (const cap of profile.capabilities) {
      const capWeight = cap.depth === "DEEP" ? 1.5 : cap.depth === "WORKING" ? 1.0 : 0.7
      totalCapWeight += capWeight
      const regex = new RegExp(`\\b${cap.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
      if (regex.test(text)) {
        matchedWeight += capWeight
        matchedCaps.push(cap.name)
      } else {
        missingCaps.push(cap.name)
      }
    }

    const overlapRatio = totalCapWeight > 0 ? matchedWeight / totalCapWeight : 0
    // Scale: 40% matching caps is already a very solid match in real postings
    skillsScore = Math.min(100, Math.round(overlapRatio * 160 + (matchedCaps.length > 0 ? 20 : 0)))
    
    if (skillsScore >= 75) {
      skillsStatus = "GOOD"
      skillsExplanation = `High capability overlap: matches ${matchedCaps.length} profile skills (${matchedCaps.slice(0, 3).join(", ")})`
      strengths.push(`Matches key skills: ${matchedCaps.slice(0, 4).join(", ")}`)
    } else if (skillsScore >= 45) {
      skillsStatus = "NEUTRAL"
      skillsExplanation = `Moderate overlap: matches ${matchedCaps.length} skills.`
      if (matchedCaps.length > 0) strengths.push(`Matches: ${matchedCaps.slice(0, 3).join(", ")}`)
    } else {
      skillsStatus = "CONCERN"
      skillsExplanation = `Limited overlap with profile skills. Missing core keywords from posting.`
      gaps.push("Few directly matched skills")
    }
  }

  // 3. Confirmed Profile Evidence
  let evidenceScore = 60
  let evidenceStatus: "GOOD" | "NEUTRAL" | "CONCERN" = "NEUTRAL"
  let evidenceExplanation = "Evidence status unverified."

  if (profile.capabilities && profile.capabilities.length > 0) {
    const totalCaps = profile.capabilities.length
    const confirmedCount = profile.capabilities.filter((c) => (c.confirmedCount ?? 0) > 0).length
    const confirmedRatio = confirmedCount / totalCaps
    evidenceScore = Math.min(100, Math.round(confirmedRatio * 100))
    if (evidenceScore >= 70) {
      evidenceStatus = "GOOD"
      evidenceExplanation = `${confirmedCount} of ${totalCaps} skills backed by confirmed career evidence.`
      strengths.push("Backed by confirmed career experience and achievements")
    } else {
      evidenceExplanation = `${confirmedCount} of ${totalCaps} skills verified with evidence.`
    }
  }

  // 4. Experience & Seniority Level
  let experienceScore = 70
  let experienceStatus: "GOOD" | "NEUTRAL" | "CONCERN" = "GOOD"
  let experienceExplanation = "Seniority level aligns or not specified."

  const jobLevel = detectJobSeniority(job.title, job.description ?? "")
  if (jobLevel && profile.experienceLevel) {
    const jobRank = SENIORITY_RANKS[jobLevel]
    const userRank = SENIORITY_RANKS[profile.experienceLevel]
    const rankDiff = Math.abs(jobRank - userRank)

    if (rankDiff === 0) {
      experienceScore = 100
      experienceStatus = "GOOD"
      experienceExplanation = `Exact seniority match: both posting and profile are ${jobLevel}.`
      strengths.push(`Seniority target aligns (${jobLevel})`)
    } else if (rankDiff === 1) {
      experienceScore = 80
      experienceStatus = "NEUTRAL"
      experienceExplanation = `Near seniority match (${jobLevel} role vs ${profile.experienceLevel} profile).`
    } else {
      experienceScore = 40
      experienceStatus = "CONCERN"
      experienceExplanation = `Seniority mismatch: role appears to be ${jobLevel}, profile is ${profile.experienceLevel}.`
      gaps.push(`Seniority difference (${jobLevel} vs ${profile.experienceLevel})`)
    }
  } else if (jobLevel) {
    experienceExplanation = `Role is ${jobLevel}. Profile seniority not set.`
  }

  // 5. Location & Work Mode
  let locScore = 75
  let locStatus: "GOOD" | "NEUTRAL" | "CONCERN" = "NEUTRAL"
  let locExplanation = "Work mode and location flexible."

  if (job.workType && profile.workModes && profile.workModes.length > 0) {
    if (profile.workModes.includes(job.workType)) {
      locScore = 100
      locStatus = "GOOD"
      locExplanation = `Matches preferred work mode (${job.workType.toLowerCase()}).`
      strengths.push(`Preferred work mode (${job.workType.toLowerCase()})`)
    } else {
      locScore = 50
      locStatus = "CONCERN"
      locExplanation = `Posting is ${job.workType.toLowerCase()}, but profile preferred modes are ${profile.workModes.join(", ").toLowerCase()}.`
      gaps.push(`Work mode differs (${job.workType.toLowerCase()})`)
    }
  }

  // 6. Salary Compatibility
  let salaryScore = 70
  let salaryStatus: "GOOD" | "NEUTRAL" | "CONCERN" = "NEUTRAL"
  let salaryExplanation = "Salary not stated in posting; typical for market."

  if (job.salary && profile.salaryMin) {
    if (job.salary >= profile.salaryMin) {
      salaryScore = 100
      salaryStatus = "GOOD"
      salaryExplanation = `Stated salary meets or exceeds minimum requirement.`
      strengths.push("Salary meets minimum expectation")
    } else {
      salaryScore = 40
      salaryStatus = "CONCERN"
      salaryExplanation = `Stated salary is below profile minimum preference.`
      gaps.push("Stated salary below preference")
    }
  }

  // 7. Freshness
  let freshnessScore = 80
  let freshnessStatus: "GOOD" | "NEUTRAL" | "CONCERN" = "GOOD"
  let freshnessExplanation = "Recent opportunity."

  const dateToCheck = job.postedAt ?? job.discoveredAt
  if (dateToCheck) {
    const ageInDays = Math.max(0, (now.getTime() - new Date(dateToCheck).getTime()) / (1000 * 60 * 60 * 24))
    if (ageInDays <= 7) {
      freshnessScore = 100
      freshnessStatus = "GOOD"
      freshnessExplanation = `Fresh opportunity: posted within the last 7 days.`
      strengths.push("Fresh posting (less than a week old)")
    } else if (ageInDays <= 21) {
      freshnessScore = 80
      freshnessStatus = "GOOD"
      freshnessExplanation = `Active posting (${Math.round(ageInDays)} days old).`
    } else if (ageInDays <= 45) {
      freshnessScore = 60
      freshnessStatus = "NEUTRAL"
      freshnessExplanation = `Posted over 3 weeks ago (${Math.round(ageInDays)} days old).`
    } else {
      freshnessScore = 30
      freshnessStatus = "CONCERN"
      freshnessExplanation = `Older posting (${Math.round(ageInDays)} days old); verify if role is still open.`
      gaps.push("Older posting")
    }
  }

  // Calculate Weighted Composite Score
  const weights = {
    eligibility: 0.25,
    skills: 0.25,
    evidence: 0.15,
    experience: 0.15,
    locationAndWorkMode: 0.10,
    salary: 0.05,
    freshness: 0.05,
  }

  const weightedSum =
    eligibilityScore * weights.eligibility +
    skillsScore * weights.skills +
    evidenceScore * weights.evidence +
    experienceScore * weights.experience +
    locScore * weights.locationAndWorkMode +
    salaryScore * weights.salary +
    freshnessScore * weights.freshness

  const compositeScore = eligibilityStatus === "BLOCKED" ? 0 : Math.round(weightedSum)

  let priority: IntelligentMatchingResult["priority"] = "MODERATE"
  if (eligibilityStatus === "BLOCKED" || compositeScore < 40) {
    priority = "INELIGIBLE"
  } else if (compositeScore >= 78) {
    priority = "HIGH"
  } else if (compositeScore >= 60) {
    priority = "MODERATE"
  } else {
    priority = "LOW"
  }

  const summary =
    priority === "HIGH"
      ? `Strong match (${compositeScore}%): aligns with profile skills, experience, and eligibility.`
      : priority === "MODERATE"
        ? `Solid match (${compositeScore}%): good overlap with few differences to review.`
        : priority === "INELIGIBLE"
          ? `Ineligible or low match: contains blockers or significant gaps.`
          : `Marginal fit (${compositeScore}%): verify requirements before applying.`

  return {
    compositeScore,
    priority,
    summary,
    dimensions: {
      eligibility: {
        score: eligibilityScore,
        weight: weights.eligibility,
        label: "Eligibility & Authorization",
        status: eligibilityStatus,
        explanation: eligibilityExplanation,
      },
      skills: {
        score: skillsScore,
        weight: weights.skills,
        label: "Skills & Capabilities",
        status: skillsStatus,
        explanation: skillsExplanation,
      },
      evidence: {
        score: evidenceScore,
        weight: weights.evidence,
        label: "Verified Evidence",
        status: evidenceStatus,
        explanation: evidenceExplanation,
      },
      experience: {
        score: experienceScore,
        weight: weights.experience,
        label: "Experience & Seniority",
        status: experienceStatus,
        explanation: experienceExplanation,
      },
      locationAndWorkMode: {
        score: locScore,
        weight: weights.locationAndWorkMode,
        label: "Location & Work Mode",
        status: locStatus,
        explanation: locExplanation,
      },
      salary: {
        score: salaryScore,
        weight: weights.salary,
        label: "Salary Alignment",
        status: salaryStatus,
        explanation: salaryExplanation,
      },
      freshness: {
        score: freshnessScore,
        weight: weights.freshness,
        label: "Posting Freshness",
        status: freshnessStatus,
        explanation: freshnessExplanation,
      },
    },
    strengths,
    gaps,
  }
}
