/**
 * Deterministic "is this posting likely current, actionable and worth my time?"
 * for one posting.
 *
 * Kept strictly apart from the Career-Profile qualification:
 *
 * `Profile Match = does this fit me?`
 * `Opportunity Confidence = is this posting worth my time?`
 *
 * Nothing here reads the user's profile, and nothing here claims a posting is
 * real or fake. It reports observable signals — where the listing came from, how
 * old it is, whether an employer is named, how much the posting actually says —
 * and lands on `HIGH | MEDIUM | LOW | UNKNOWN`. A low score is triage, not an
 * accusation, which is why the badge never uses the error tint.
 *
 * Pure, offline and AI-free, and computed at read time: nothing is stored, so
 * changing a threshold changes every screen at once and never leaves a stale
 * assessment behind on a row.
 */

export type OpportunityConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"

/** How one signal reads: is it working for the posting, against it, or silent? */
export type ConfidenceSignalTone = "positive" | "negative" | "neutral" | "unknown"

export interface ConfidenceSignal {
  /** Stable identifier for the signal family, for keys and tests. */
  key: "provenance" | "freshness" | "employer" | "completeness"
  /** Already user-facing, and short enough for a line in a list. */
  label: string
  tone: ConfidenceSignalTone
}

export interface OpportunityConfidence {
  level: OpportunityConfidenceLevel
  /** The summed signal contributions. Exposed for tests and debugging only. */
  score: number
  signals: ConfidenceSignal[]
  /** One sentence built from the signal labels, for a `title` attribute. */
  summary: string
}

export interface OpportunityConfidenceInput {
  /** Discovery source adapter id, when the posting came from a discovery run. */
  provider?: string | null
  /**
   * How the job reached the board. Accepted so callers can pass the column
   * straight through, but deliberately not scored: what the row claims about
   * itself is weaker evidence than the URL it points at, and an EXTENSION save
   * from a company careers page and one from LinkedIn are the same `source`.
   */
  source?: "MANUAL" | "EXTENSION" | "DISCOVERY" | null
  url?: string | null
  postedAt?: Date | string | null
  discoveredAt?: Date | string | null
  createdAt?: Date | string | null
  companyName?: string | null
  description?: string | null
  /**
   * Length of the posting body when the caller deliberately did not select the
   * body itself (the dashboard query, for one). Leave both this and
   * `description` unset and the completeness signal is omitted rather than
   * scored as a short posting.
   */
  descriptionLength?: number | null
  /** Injected so the freshness wording is testable. */
  now?: Date
}

/** Discovery adapters that read an employer-controlled ATS board directly. */
const ATS_PROVIDERS = new Set(["greenhouse", "lever", "ashby"])

/**
 * Hosts that mean "an employer publishing their own vacancy". Registrable
 * domains only: subdomain-per-employer is exactly how these products work.
 */
const ATS_HOSTS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "smartrecruiters.com",
  "myworkdayjobs.com",
  "jobvite.com",
  "recruitee.com",
  "bamboohr.com",
  "breezy.hr",
  "teamtailor.com",
]

/**
 * Job boards and aggregators. A listing here is still a real listing — it just
 * is not the employer speaking, so it earns no provenance credit either way.
 *
 * Deliberately modest: an unrecognized host is treated as a direct company link,
 * and over-listing here would quietly demote the company careers pages this
 * signal exists to reward.
 */
const AGGREGATOR_HOSTS = [
  "remotive.com",
  "remotive.io",
  "arbeitnow.com",
  "kalibrr.com",
  "onlinejobs.ph",
  "jobstreet.com",
  "jobstreet.com.ph",
  "bossjob.ph",
  "bossjob.com",
  "indeed.com",
  "linkedin.com",
  "glassdoor.com",
  "jooble.org",
  "careerjet.com",
  "jobs.ph",
  "ziprecruiter.com",
  "monster.com",
  "simplyhired.com",
  "weworkremotely.com",
  "remoteok.com",
  "wellfound.com",
  "jora.com",
  "foundit.com.ph",
]

/** Score per signal outcome. Named so the thresholds below can be read. */
const SCORE = {
  ATS_BOARD: 2,
  DIRECT_LINK: 1,
  JOB_BOARD: 0,
  FRESH: 2,
  RECENT: 1,
  AGING: 0,
  STALE: -2,
  /**
   * A date we inferred ourselves — when the posting was discovered, or when the
   * row was created — is capped. It says when *we* first saw the listing, which
   * is not evidence about how current the posting is, so it can neither earn the
   * full freshness credit nor carry the full staleness penalty.
   */
  SEEN_RECENT: 1,
  SEEN_AGING: 0,
  SEEN_STALE: -1,
  NAMED_EMPLOYER: 1,
  UNDISCLOSED_EMPLOYER: -1,
  DETAILED: 1,
  BRIEF: 0,
  VERY_SHORT: -1,
  UNKNOWN: 0,
} as const

/** Age bands in whole days, measured from the best date the caller had. */
const FRESH_MAX_DAYS = 14
const RECENT_MAX_DAYS = 45
const AGING_MAX_DAYS = 90

/** Posting-body length bands, in characters. */
const DETAILED_MIN_CHARS = 600
const BRIEF_MIN_CHARS = 200

/** The provenance label that earns no credit, named so the level cap can test it. */
const JOB_BOARD_LABEL = "Job board listing"

/** Score floors for each level. Anything below `MEDIUM_MIN_SCORE` is LOW. */
const HIGH_MIN_SCORE = 4
const MEDIUM_MIN_SCORE = 2

/** Employer strings that name no employer at all. */
const UNDISCLOSED_EMPLOYER = /undisclosed|confidential|private employer|hiring company/i

const MS_PER_DAY = 86_400_000

/** Sort key for a confidence level, best first. LOW sorts below UNKNOWN. */
export const CONFIDENCE_RANK: Record<OpportunityConfidenceLevel, number> = {
  HIGH: 0,
  MEDIUM: 1,
  UNKNOWN: 2,
  LOW: 3,
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Lowercased registrable host, `www.` stripped, or null if the URL is unusable. */
function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.startsWith("www.") ? host.slice(4) : host
  } catch {
    return null
  }
}

/** True when `host` is the domain itself or any subdomain of it. */
function matchesHost(host: string, domains: string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

function provenanceSignal(
  input: OpportunityConfidenceInput,
): { signal: ConfidenceSignal; score: number } {
  const provider = input.provider?.trim().toLowerCase() || null
  const host = hostOf(input.url)

  if ((provider && ATS_PROVIDERS.has(provider)) || (host && matchesHost(host, ATS_HOSTS))) {
    return {
      signal: { key: "provenance", label: "Official ATS board", tone: "positive" },
      score: SCORE.ATS_BOARD,
    }
  }

  if (host && !matchesHost(host, AGGREGATOR_HOSTS)) {
    return {
      signal: { key: "provenance", label: "Company site or direct link", tone: "positive" },
      score: SCORE.DIRECT_LINK,
    }
  }

  if (host || provider) {
    return {
      signal: { key: "provenance", label: JOB_BOARD_LABEL, tone: "neutral" },
      score: SCORE.JOB_BOARD,
    }
  }

  return {
    signal: { key: "provenance", label: "Source unknown", tone: "unknown" },
    score: SCORE.UNKNOWN,
  }
}

/** "3 days ago" / "today", so the label reads as a sentence fragment. */
function agePhrase(days: number): string {
  if (days <= 0) return "today"
  if (days === 1) return "1 day ago"
  return `${days} days ago`
}

function freshnessSignal(
  input: OpportunityConfidenceInput,
  now: Date,
): { signal: ConfidenceSignal; score: number; fallback: boolean } {
  const posted = toDate(input.postedAt)
  // A fallback date says when *we* first had the posting, not when the employer
  // published it, so the wording says both things and the score is capped.
  const seen = posted ?? toDate(input.discoveredAt) ?? toDate(input.createdAt)

  if (!seen) {
    return {
      signal: { key: "freshness", label: "Posting date unknown", tone: "unknown" },
      score: SCORE.UNKNOWN,
      fallback: false,
    }
  }

  const days = Math.floor((now.getTime() - seen.getTime()) / MS_PER_DAY)

  if (!posted) {
    if (days > AGING_MAX_DAYS) {
      return {
        signal: {
          key: "freshness",
          label: "Not seen in over 3 months · posting date unknown",
          tone: "negative",
        },
        score: SCORE.SEEN_STALE,
        fallback: true,
      }
    }
    const label = `Seen ${agePhrase(days)} · posting date unknown`
    return {
      signal: { key: "freshness", label, tone: "neutral" },
      score: days <= RECENT_MAX_DAYS ? SCORE.SEEN_RECENT : SCORE.SEEN_AGING,
      fallback: true,
    }
  }

  if (days > AGING_MAX_DAYS) {
    return {
      signal: { key: "freshness", label: "Posted over 3 months ago", tone: "negative" },
      score: SCORE.STALE,
      fallback: false,
    }
  }

  const label = `Posted ${agePhrase(days)}`
  if (days <= FRESH_MAX_DAYS) {
    return { signal: { key: "freshness", label, tone: "positive" }, score: SCORE.FRESH, fallback: false }
  }
  if (days <= RECENT_MAX_DAYS) {
    return { signal: { key: "freshness", label, tone: "positive" }, score: SCORE.RECENT, fallback: false }
  }
  return { signal: { key: "freshness", label, tone: "neutral" }, score: SCORE.AGING, fallback: false }
}

function employerSignal(
  input: OpportunityConfidenceInput,
): { signal: ConfidenceSignal; score: number } {
  const name = input.companyName?.trim() ?? ""
  if (name && !UNDISCLOSED_EMPLOYER.test(name)) {
    return {
      signal: { key: "employer", label: "Named employer", tone: "positive" },
      score: SCORE.NAMED_EMPLOYER,
    }
  }
  return {
    signal: { key: "employer", label: "Employer undisclosed", tone: "negative" },
    score: SCORE.UNDISCLOSED_EMPLOYER,
  }
}

function completenessSignal(
  input: OpportunityConfidenceInput,
): { signal: ConfidenceSignal; score: number } | null {
  const length =
    typeof input.descriptionLength === "number"
      ? input.descriptionLength
      : typeof input.description === "string"
        ? input.description.length
        : null

  // Neither given: the caller chose not to load the body. Saying nothing is
  // honest; scoring it as a short posting would punish the query, not the job.
  if (length === null) return null

  if (length >= DETAILED_MIN_CHARS) {
    return {
      signal: { key: "completeness", label: "Detailed posting", tone: "positive" },
      score: SCORE.DETAILED,
    }
  }
  if (length >= BRIEF_MIN_CHARS) {
    return {
      signal: { key: "completeness", label: "Brief posting", tone: "neutral" },
      score: SCORE.BRIEF,
    }
  }
  if (length > 0) {
    return {
      signal: { key: "completeness", label: "Very short posting", tone: "negative" },
      score: SCORE.VERY_SHORT,
    }
  }
  return {
    signal: { key: "completeness", label: "No posting text", tone: "negative" },
    score: SCORE.VERY_SHORT,
  }
}

/** "Official ATS board, posted 5 days ago, named employer." */
function buildSummary(signals: ConfidenceSignal[]): string {
  const parts = signals.map((signal, index) =>
    index === 0
      ? signal.label
      : signal.label.charAt(0).toLowerCase() + signal.label.slice(1),
  )
  return parts.length > 0 ? `${parts.join(", ")}.` : "Nothing to assess."
}

/**
 * Assesses one posting. Every field is optional: the point of the UNKNOWN level
 * is that a row with nothing to go on says so instead of guessing.
 */
export function assessOpportunityConfidence(
  input: OpportunityConfidenceInput,
): OpportunityConfidence {
  const now = input.now ?? new Date()

  const provenance = provenanceSignal(input)
  const freshness = freshnessSignal(input, now)
  const employer = employerSignal(input)
  const completeness = completenessSignal(input)

  const parts = [provenance, freshness, employer, ...(completeness ? [completeness] : [])]
  const signals = parts.map((part) => part.signal)
  const score = parts.reduce((total, part) => total + part.score, 0)

  // Nothing is known about where it came from or when it was published, so the
  // employer name and the body length alone cannot support a claim either way.
  if (provenance.signal.tone === "unknown" && freshness.signal.tone === "unknown") {
    return { level: "UNKNOWN", score, signals, summary: buildSummary(signals) }
  }

  const raw: OpportunityConfidenceLevel =
    score >= HIGH_MIN_SCORE ? "HIGH" : score >= MEDIUM_MIN_SCORE ? "MEDIUM" : "LOW"

  /**
   * A job-board listing of unknown age cannot be high confidence, whatever else
   * it has going for it: the two things that would say the posting is still live
   * — the employer publishing it themselves, and a real posted date — are both
   * missing, and a named employer with a long description is not evidence of
   * either. Capping is the product rule: never invent confidence from
   * insufficient evidence.
   */
  const thinProvenance =
    provenance.signal.tone === "unknown" || provenance.signal.label === JOB_BOARD_LABEL
  const level: OpportunityConfidenceLevel =
    raw === "HIGH" && freshness.fallback && thinProvenance ? "MEDIUM" : raw

  return { level, score, signals, summary: buildSummary(signals) }
}
