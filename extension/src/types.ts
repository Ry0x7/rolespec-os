/** Job types accepted by POST /api/extension/jobs (mirrors the Prisma JobType enum). */
export const JOB_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERNSHIP",
  "FREELANCE",
  "TEMPORARY",
] as const

export type JobType = (typeof JOB_TYPES)[number]

/** Work types accepted by POST /api/extension/jobs (mirrors the Prisma WorkType enum). */
export const WORK_TYPES = ["REMOTE", "HYBRID", "ONSITE"] as const

export type WorkType = (typeof WORK_TYPES)[number]

/** Salary periods accepted by POST /api/extension/jobs (Prisma SalaryPeriod enum). */
export const SALARY_PERIODS = ["HOURLY", "MONTHLY", "YEARLY"] as const

export type SalaryPeriod = (typeof SALARY_PERIODS)[number]

/** Salary currencies accepted by POST /api/extension/jobs (Prisma SalaryCurrency enum). */
export const SALARY_CURRENCIES = ["USD", "PHP"] as const

export type SalaryCurrency = (typeof SALARY_CURRENCIES)[number]

/** Request body of POST /api/extension/jobs. */
export interface ClippedJob {
  companyName: string
  jobTitle: string
  jobLink?: string
  jobDescription?: string
  location?: string
  salary?: number
  salaryPeriod?: SalaryPeriod
  salaryCurrency?: SalaryCurrency
  jobType?: JobType
  workType?: WorkType
  /**
   * When the posting says it was published, as a calendar date (`YYYY-MM-DD`)
   * read from JSON-LD `datePosted`. Feeds the server's read-time Opportunity
   * Confidence, which is why it is sent even though the user never types it.
   */
  postedAt?: string
  /**
   * The application deadline (`YYYY-MM-DD`) from JSON-LD `validThrough`. A
   * calendar date, not a timestamp: a deadline is a day, everywhere.
   */
  deadline?: string
  /**
   * Display-only: the full "min–max CURRENCY / PERIOD" range when a posting
   * states a salary band instead of one number. `salary` above is always a
   * single factual value actually stated in the posting (never a guessed
   * midpoint), so this exists purely so the user can see the band it came
   * from. Extractor output only — `readForm()` in sidepanel.ts builds the
   * POST body field-by-field and never includes it, so it never reaches the
   * API.
   */
  salaryRangeText?: string
}

export const MAX_DESCRIPTION_LENGTH = 20000

/** Risk levels a 201 from POST /api/extension/jobs may flag the posting with. */
export const JOB_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const

export type JobRiskLevel = (typeof JOB_RISK_LEVELS)[number]

/**
 * Optional `risk` on a 201 from POST /api/extension/jobs: the server's ghost-job /
 * scam heuristics. Omitted entirely when nothing looked suspicious, and older servers
 * never send it, so absence must read as "not flagged" rather than "unknown".
 */
export interface JobRisk {
  level: JobRiskLevel
  reasons: string[]
}

/**
 * Verdicts a 201 from POST /api/extension/jobs may carry on the optional
 * `qualification` object. Anything outside this list is treated as no verdict at
 * all rather than shown raw.
 */
export const QUALIFICATION_VERDICTS = ["STRONG", "WORTH_A_LOOK", "WEAK", "BLOCKED"] as const

export type QualificationVerdict = (typeof QUALIFICATION_VERDICTS)[number]

/**
 * One step of the qualification breakdown. `level` is a server-owned string
 * (GOOD/NEUTRAL/CONCERN/BLOCKER, or LOW/MEDIUM/HIGH on the risk step) kept as a
 * plain string so a new level never turns a good save into a dropped one.
 */
export interface QualificationStep {
  level: string
  reasons: string[]
}

/** The match step, which reports capabilities instead of reasons. */
export interface QualificationMatch {
  level: string
  matchedCapabilities: string[]
  confirmedCount: number
}

/**
 * Optional `qualification` on a 201 from POST /api/extension/jobs: the server's
 * read on whether this posting is worth the user's time. Absent when the user has
 * no Career Profile or the computation failed, and older servers never send it, so
 * absence must read as "nothing to say" rather than "unqualified".
 */
export interface JobQualification {
  verdict: QualificationVerdict
  nextAction: string
  worthIt: QualificationStep
  eligible: QualificationStep
  match: QualificationMatch
  risk: QualificationStep
}

/**
 * Optional `marketFit` on a 201 from POST /api/extension/jobs: where this posting
 * is open, relative to the market the user's Career Profile resolves to. `fit` is
 * a server-owned string (IN_MARKET / REGION / OPEN / RESTRICTED / UNKNOWN) kept
 * opaque for the same reason the step levels are — a new value must not cost the
 * user the label. `label` is the chip text, `reason` the sentence behind it.
 */
export interface JobMarketFit {
  fit: string
  label: string
  reason: string
}

/** Opportunity-Confidence levels a 201 may carry. Anything else reads as no chip. */
export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

/**
 * Optional `confidence` on a 201 from POST /api/extension/jobs: the server's
 * read-time "is this posting likely current, actionable and worth my time?".
 * Separate from the profile match on purpose, and never an accusation — a LOW
 * reading is triage. Absent against an older server.
 */
export interface JobConfidence {
  level: ConfidenceLevel
  /** One sentence built from the signals, shown as the chip's `title`. */
  summary: string
}

/** `person` in the body of POST /api/extension/cold-email. */
export interface LinkedInProfile {
  name: string
  headline?: string
  company?: string
  about?: string
  profileUrl?: string
}

/** Fields of a profile read that carry provenance. `profileUrl` is not diagnosed. */
export type LinkedInProfileField = "name" | "headline" | "company" | "about"

/** Which extraction strategy filled a field: embedded JSON, DOM, og meta or selection. */
export type LinkedInProfileSource = "json" | "dom" | "og" | "selection"

/**
 * What `extractLinkedInProfile` returns: the profile fields plus a per-field record of
 * which strategy produced them (null = nothing found). `sources` is omitted entirely
 * when no field could be read at all, so an unreadable page still returns `{}`.
 */
export interface LinkedInProfileExtraction extends Partial<LinkedInProfile> {
  sources?: Record<LinkedInProfileField, LinkedInProfileSource | null>
}

/** Field caps mirrored from the route's zod schema. */
export const MAX_PROFILE_NAME_LENGTH = 200
export const MAX_PROFILE_HEADLINE_LENGTH = 300
export const MAX_PROFILE_COMPANY_LENGTH = 200
export const MAX_PROFILE_ABOUT_LENGTH = 5000
export const MAX_PROFILE_URL_LENGTH = 500
export const MAX_INSTRUCTIONS_LENGTH = 1000

/**
 * `messageType` in the body of POST /api/extension/cold-email. A connection note and a
 * LinkedIn DM come back with an empty subject; only the cold email has one.
 */
export const MESSAGE_TYPES = ["cold_email", "connection_note", "linkedin_dm"] as const

export type MessageType = (typeof MESSAGE_TYPES)[number]

/** Server-side cap on a connection note, mirrored so the panel can show a counter. */
export const MAX_CONNECTION_NOTE_LENGTH = 200

/**
 * Request body of POST /api/extension/cold-email. `tone` is optional on both sides:
 * an older server ignores it.
 */
export interface ColdEmailRequest {
  person: LinkedInProfile
  messageType?: MessageType
  resumeId?: string
  instructions?: string
  tone?: OutreachTone
}

/** `tone` in the body of POST /api/extension/email-reply. Omitted = professional. */
export const REPLY_TONES = ["professional", "warm", "direct"] as const

export type ReplyTone = (typeof REPLY_TONES)[number]

/**
 * `tone` in the body of POST /api/extension/cold-email — the same three values as the
 * reply route, aliased so the outreach flow does not read as a reply one.
 */
export const OUTREACH_TONES = REPLY_TONES

export type OutreachTone = ReplyTone

/** `length` in the body of POST /api/extension/email-reply. Omitted = standard. */
export const REPLY_LENGTHS = ["brief", "standard", "detailed"] as const

export type ReplyLength = (typeof REPLY_LENGTHS)[number]

/**
 * Request body of POST /api/extension/email-reply. `tone`, `length`, `priorThread`
 * and `previousDraft` are optional on both sides: an older server ignores them.
 */
export interface EmailReplyRequest {
  receivedEmail: string
  job?: {
    companyName?: string
    jobTitle?: string
    jobDescription?: string
  }
  resumeId?: string
  instructions?: string
  tone?: ReplyTone
  length?: ReplyLength
  priorThread?: string
  previousDraft?: string
}

/** Field caps mirrored from the reply route's zod schema. */
export const MAX_RECEIVED_EMAIL_LENGTH = 8000
export const MAX_JOB_CONTEXT_LENGTH = 200
export const MAX_JOB_DESCRIPTION_CONTEXT_LENGTH = 5000
export const MAX_PRIOR_THREAD_LENGTH = 6000
export const MAX_PREVIOUS_DRAFT_LENGTH = 4000

/** One entry of GET /api/extension/resumes, used to fill the resume pickers. */
export interface ResumeSummary {
  id: string
  title: string
  atsScore: number | null
  updatedAt: string
}

export interface Settings {
  appUrl: string
  apiToken: string
}
