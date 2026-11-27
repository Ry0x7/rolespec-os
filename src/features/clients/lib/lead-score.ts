import type { JobType, WorkType } from "@/generated/prisma/enums"

import type { ClientService } from "../data/services"

/**
 * Deterministic client-lead scoring. Pure: no I/O, no AI, no profile text.
 *
 * A lead is a public post from someone who wants work done. The score answers
 * one question — "is this worth a proposal for the service I offer?" — from the
 * post's own words, how it is engaged, where the work happens, how fresh it is
 * and whether it carries scam signals. It is guidance, never a promise that a
 * client will reply, and it never becomes a claim about the user.
 */

export type ClientArrangement = "REMOTE" | "ONSITE" | "ANY"

export type LeadBand = "STRONG" | "GOOD" | "LONG_SHOT"

export type LeadEngagement = "HOURLY" | "FIXED_PRICE" | "PART_TIME" | "FULL_TIME" | "CONTRACT" | "UNKNOWN"

export const LEAD_ENGAGEMENT_LABELS: Record<LeadEngagement, string> = {
  HOURLY: "Hourly",
  FIXED_PRICE: "Fixed price",
  PART_TIME: "Part-time",
  FULL_TIME: "Full-time",
  CONTRACT: "Contract",
  UNKNOWN: "Engagement not stated",
}

export interface LeadInput {
  provider: string
  title: string
  description?: string
  location?: string
  workType?: WorkType
  salaryText?: string
  postedAt?: Date
}

export interface LeadRisk {
  level: "LOW" | "MEDIUM" | "HIGH"
  reasons: string[]
}

export interface LeadScore {
  score: number
  band: LeadBand
  /** False when the post never mentions the service; such leads are hidden. */
  relevant: boolean
  matchedTerms: string[]
  engagement: LeadEngagement
  /** The saved job's type, only when the post itself says it. */
  jobType: JobType | null
  /** Plain-language reasons, best first. */
  reasons: string[]
  /** Reasons to be careful, shown separately from the fit reasons. */
  cautions: string[]
}

/** Providers whose every item is a client project rather than an employer ad. */
const CLIENT_MARKETPLACES = new Set(["freelancer"])

const DAY_MS = 86_400_000

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** A whole-word, case-insensitive match that also works for "make.com" or "c++". */
function containsTerm(haystack: string, term: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term.toLowerCase())}(?=$|[^\\p{L}\\p{N}])`, "u")
  return pattern.test(haystack)
}

export function detectEngagement(input: Pick<LeadInput, "title" | "description" | "salaryText">): LeadEngagement {
  const text = `${input.title}\n${input.salaryText ?? ""}\n${input.description ?? ""}`.toLowerCase()
  if (/\bper hour\b|\bhourly\b|\/\s?(?:hr|hour)\b/.test(text)) return "HOURLY"
  if (/\bfixed[- ]price\b|\bper project\b|\bone[- ]off\b|\bproject[- ]based\b/.test(text)) return "FIXED_PRICE"
  if (/\bpart[- ]time\b/.test(text)) return "PART_TIME"
  if (/\bcontract(?:or)?\b|\bfreelance\b|\bretainer\b/.test(text)) return "CONTRACT"
  if (/\bfull[- ]time\b/.test(text)) return "FULL_TIME"
  return "UNKNOWN"
}

function jobTypeFor(provider: string, engagement: LeadEngagement): JobType | null {
  if (CLIENT_MARKETPLACES.has(provider)) return "FREELANCE"
  if (engagement === "PART_TIME") return "PART_TIME"
  if (engagement === "FULL_TIME") return "FULL_TIME"
  if (engagement === "CONTRACT" || engagement === "FIXED_PRICE" || engagement === "HOURLY") return "CONTRACT"
  return null
}

function bandFor(score: number): LeadBand {
  if (score >= 60) return "STRONG"
  if (score >= 35) return "GOOD"
  return "LONG_SHOT"
}

/**
 * Where the work happens, trusting the post's own title over a source flag.
 * Freelancer.com lets a client tick "local" on a project titled "UK Remote
 * Legal PA", which put plainly remote work into on-site searches.
 */
export function effectiveWorkType(lead: Pick<LeadInput, "title" | "workType">): WorkType | undefined {
  const title = lead.title.toLowerCase()
  if (lead.workType !== "REMOTE" && /\bremote\b|\bwork from home\b|\bwfh\b/.test(title) && !/\bon[- ]?site\b|\bhybrid\b|\bin[- ]office\b/.test(title)) {
    return "REMOTE"
  }
  return lead.workType
}

function locationMatches(postLocation: string | undefined, wanted: string | undefined): boolean {
  const place = postLocation?.toLowerCase() ?? ""
  const tokens = (wanted ?? "")
    .toLowerCase()
    .split(/[,/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
  return tokens.length > 0 && tokens.some((token) => place.includes(token))
}

export function scoreClientLead(
  lead: LeadInput,
  options: {
    service: ClientService
    arrangement: ClientArrangement
    location?: string
    risk?: LeadRisk | null
    now?: Date
  }
): LeadScore {
  const title = lead.title.toLowerCase()
  const body = (lead.description ?? "").toLowerCase()
  const reasons: string[] = []
  const cautions: string[] = []

  // Relevance: the post has to ask for the service in its own words.
  const titleTerms = options.service.terms.filter((term) => containsTerm(title, term))
  const bodyTerms = options.service.terms.filter(
    (term) => !titleTerms.includes(term) && containsTerm(body, term)
  )
  const matchedTerms = [...titleTerms, ...bodyTerms]
  const relevance = Math.min(50, titleTerms.length * 20 + bodyTerms.length * 6)
  if (titleTerms.length > 0) reasons.push(`Asks for ${titleTerms.slice(0, 3).join(", ")} in the title`)
  else if (bodyTerms.length > 0) reasons.push(`Mentions ${bodyTerms.slice(0, 3).join(", ")}`)

  // Client work: a marketplace project, or an ad that is plainly freelance.
  const engagement = detectEngagement(lead)
  let clientWork = 0
  if (CLIENT_MARKETPLACES.has(lead.provider)) {
    clientWork = 20
    reasons.push("Posted by a client looking to hire for a project")
  } else if (engagement !== "UNKNOWN" && engagement !== "FULL_TIME") {
    clientWork = 12
    reasons.push(`${LEAD_ENGAGEMENT_LABELS[engagement]} work`)
  }

  // Where the work happens.
  const workType = effectiveWorkType(lead)
  let arrangement = 0
  if (options.arrangement === "REMOTE") {
    if (workType === "REMOTE") {
      arrangement = 15
      reasons.push("Remote")
    } else if (workType === "ONSITE" || workType === "HYBRID") {
      cautions.push("Needs someone on site, but you asked for remote work")
    }
  } else if (options.arrangement === "ONSITE") {
    if (workType === "ONSITE" || workType === "HYBRID") {
      if (locationMatches(lead.location, options.location)) {
        arrangement = 15
        reasons.push(`On site in ${lead.location}`)
      } else {
        arrangement = 6
        cautions.push(
          options.location ? `On site, but not clearly near ${options.location}` : "On site; check the location"
        )
      }
    } else if (workType === "REMOTE") {
      cautions.push("Remote work, but you asked for on-site clients")
    }
  } else if (workType) {
    arrangement = 8
  }

  // Freshness: a client hires fast, and an old post is usually filled.
  let recency = 0
  if (lead.postedAt) {
    const ageDays = Math.max(0, ((options.now ?? new Date()).getTime() - lead.postedAt.getTime()) / DAY_MS)
    if (ageDays <= 3) {
      recency = 15
      reasons.push("Posted in the last 3 days")
    } else if (ageDays <= 14) recency = 8
    else if (ageDays <= 30) recency = 3
    else cautions.push("Posted more than a month ago")
  }

  let score = relevance + clientWork + arrangement + recency
  if (options.risk?.level === "HIGH") {
    score -= 40
    cautions.unshift(...options.risk.reasons.slice(0, 2).map((reason) => `Scam signal: ${reason}`))
  } else if (options.risk?.level === "MEDIUM") {
    score -= 15
    cautions.unshift(...options.risk.reasons.slice(0, 1).map((reason) => `Check first: ${reason}`))
  }
  score = Math.max(0, Math.min(100, Math.round(score)))

  return {
    score,
    band: bandFor(score),
    relevant: matchedTerms.length > 0,
    matchedTerms,
    engagement,
    jobType: jobTypeFor(lead.provider, engagement),
    reasons,
    cautions,
  }
}
