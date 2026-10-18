import { parseJobRisk } from "./job-risk"
import {
  parseConfidence,
  parseMarketFit,
  parseQualification,
  parseRequirements,
} from "./qualification"
import { JOB_RISK_LEVELS, QUALIFICATION_VERDICTS } from "./types"
import type {
  ClippedJob,
  ColdEmailRequest,
  EmailReplyRequest,
  JobConfidence,
  JobMarketFit,
  JobQualification,
  JobRisk,
  JobRiskLevel,
  QualificationVerdict,
  ResumeSummary,
  Settings,
  WorkType,
} from "./types"

export type SaveResult =
  | {
      ok: true
      kind: "saved"
      id: string
      risk?: JobRisk
      /** Eligibility flags, e.g. `NO_SPONSORSHIP`. Empty against an older server. */
      requirements: string[]
      qualification?: JobQualification
      /** Where the posting is open, relative to the user's market. */
      marketFit?: JobMarketFit
      /** Read-time "is this posting worth my time?". Separate from the match. */
      confidence?: JobConfidence
    }
  /**
   * The tab was already clipped. A success, not a failure: the user has the job
   * they wanted, it just already existed, so the panel points at it instead of
   * reporting an error. `id` is the JobApplication id the route returns, which
   * is what `/jobs/{id}` addresses.
   */
  | { ok: true; kind: "duplicate"; id: string }
  | {
      ok: false
      kind: "unauthorized" | "rate_limited" | "validation" | "network" | "unknown"
      message: string
    }

/**
 * POST /api/extension/jobs — the only network call the extension makes, and only
 * in response to the user pressing Save.
 */
export async function postJob(
  settings: Settings,
  job: ClippedJob
): Promise<SaveResult> {
  let response: Response
  try {
    response = await fetch(`${settings.appUrl}/api/extension/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiToken}`,
      },
      body: JSON.stringify(job),
    })
  } catch {
    return {
      ok: false,
      kind: "network",
      message: `Could not reach ${settings.appUrl}. Check the App URL in options and that RoleSpec is running.`,
    }
  }

  let payload: Record<string, unknown> = {}
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch {
    payload = {}
  }
  const serverError =
    typeof payload.error === "string" && payload.error.trim().length > 0
      ? payload.error.trim()
      : undefined

  if (response.status === 201) {
    const id = typeof payload.id === "string" ? payload.id : ""
    // `risk` is optional and only sent by newer servers; a malformed one is dropped
    // rather than allowed to spoil a save that already went through.
    const risk = parseJobRisk(payload.risk)
    // `requirements` and `qualification` ride along on the same 201 and follow the
    // same rule: an older server sends neither, and a malformed one is dropped.
    const requirements = parseRequirements(payload.requirements)
    const qualification = parseQualification(payload.qualification)
    // `marketFit` and `confidence` ride the same 201 under the same contract.
    const marketFit = parseMarketFit(payload.marketFit)
    const confidence = parseConfidence(payload.confidence)
    const result: Extract<SaveResult, { kind: "saved" }> = {
      ok: true,
      kind: "saved",
      id,
      requirements,
    }
    if (risk) result.risk = risk
    if (qualification) result.qualification = qualification
    if (marketFit) result.marketFit = marketFit
    if (confidence) result.confidence = confidence
    return result
  }
  // A re-clip of a tab the user already saved. The route answers 200 with the
  // existing application, and that is the whole result: no verdict, no risk, no
  // second row.
  if (response.status === 200 && payload.duplicate === true) {
    const id = typeof payload.id === "string" ? payload.id : ""
    return { ok: true, kind: "duplicate", id }
  }
  if (response.status === 401) {
    return {
      ok: false,
      kind: "unauthorized",
      message: serverError ?? "Token rejected. Paste a fresh API token in options.",
    }
  }
  if (response.status === 429) {
    return {
      ok: false,
      kind: "rate_limited",
      message: serverError ?? "Too many clips. Wait a minute and try again.",
    }
  }
  if (response.status === 400) {
    return {
      ok: false,
      kind: "validation",
      message: serverError ?? "RoleSpec rejected this job. Check the fields above.",
    }
  }
  return {
    ok: false,
    kind: "unknown",
    message: serverError ?? `Unexpected response from RoleSpec (${response.status}).`,
  }
}

/**
 * One requirement the draft mentions that the user's resume does not back, as
 * decided server-side by the evidence check. Absent when the draft is clean, and
 * absent entirely against a RoleSpec older than the check.
 */
export type GroundingNote = { keyword: string; reason: string }

/**
 * The two halves of the server's evidence check. `claimed` is the one that
 * matters — mentions with nothing around them to say the user has not done the
 * thing. `namedAsGap` is the draft owning up ("Kafka is new to me"), reported
 * quietly. Both are empty against a clean draft, and `namedAsGap` is always
 * empty against a RoleSpec older than the split.
 */
export type GroundingSummary = {
  claimed: GroundingNote[]
  namedAsGap: GroundingNote[]
}

/**
 * The deterministic name check the server runs on the draft it just returned.
 * Only two kinds ever arrive: the draft signed a name that is not the user's, or
 * it signed one when RoleSpec had none to give. A third kind exists server-side
 * (an unsigned draft) and is deliberately never sent — it is a style finding.
 * Absent on a clean draft, and absent entirely against a RoleSpec older than the
 * check.
 */
export type SignatureFinding = {
  issue: "wrong_name" | "unexpected_name"
  /** The name the sign-off should have carried, or null when there was none. */
  expectedName: string | null
  /** What stood there instead, verbatim, as evidence for a human. */
  offending: string[]
}

export type ColdEmailResult =
  | {
      ok: true
      subject: string
      body: string
      grounding: GroundingSummary
      signature: SignatureFinding | null
    }
  | {
      ok: false
      kind:
        | "unauthorized"
        | "rate_limited"
        | "validation"
        | "network"
        | "unknown"
      message: string
    }

/** The reply route returns the same envelope as the cold-email route. */
export type EmailReplyResult = ColdEmailResult

/**
 * Both draft routes run a blocking model call with `maxDuration = 60`, so the client
 * budget has to sit above it — a shorter timeout would abort a request the server is
 * still paying for.
 */
const DRAFT_TIMEOUT_MS = 70000

/**
 * Read the optional grounding block off a draft response, defensively: it is
 * absent on a clean draft and on any RoleSpec deployed before the evidence check
 * existed, so anything unexpected degrades to "nothing to warn about".
 */
export function parseGrounding(value: unknown): GroundingSummary {
  if (typeof value !== "object" || value === null) {
    return { claimed: [], namedAsGap: [] }
  }
  const { claimed, namedAsGap } = value as {
    claimed?: unknown
    namedAsGap?: unknown
  }
  return { claimed: parseNotes(claimed), namedAsGap: parseNotes(namedAsGap) }
}

/**
 * One grounding array. A missing or malformed array is no notes at all — an
 * older server sends no `namedAsGap` field and must read as "nothing quiet to
 * report", not as an error.
 */
function parseNotes(value: unknown): GroundingNote[] {
  if (!Array.isArray(value)) return []
  const notes: GroundingNote[] = []
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue
    const { keyword, reason } = entry as { keyword?: unknown; reason?: unknown }
    if (typeof keyword !== "string" || !keyword.trim()) continue
    notes.push({
      keyword: keyword.trim(),
      reason: typeof reason === "string" ? reason : "",
    })
  }
  return notes
}

/**
 * Read the optional signature finding off a draft response, defensively — same
 * rule as `parseGrounding`: anything unexpected degrades to "nothing to warn
 * about", because an older RoleSpec sends no such field and that must read as a
 * clean draft, not as an error.
 *
 * The `issue` allowlist is defence in depth. The server already withholds
 * `missing_name` (an unsigned draft is odd, not wrong), and refusing it here too
 * means a future server that changed its mind cannot start nagging an installed
 * extension.
 */
export function parseSignature(value: unknown): SignatureFinding | null {
  if (typeof value !== "object" || value === null) return null
  const { issue, expectedName, offending } = value as {
    issue?: unknown
    expectedName?: unknown
    offending?: unknown
  }
  if (issue !== "wrong_name" && issue !== "unexpected_name") return null
  if (!Array.isArray(offending)) return null

  const lines = offending
    .filter((line): line is string => typeof line === "string" && !!line.trim())
    .map((line) => line.trim())
  // Nothing to quote is nothing to show: the sentence is built around the line
  // that stood where the name belongs.
  if (lines.length === 0) return null

  return {
    issue,
    expectedName: typeof expectedName === "string" && expectedName.trim() ? expectedName.trim() : null,
    offending: lines,
  }
}

/**
 * Shared transport for the two `{subject, body}` draft routes. They differ only in
 * path, request body and the copy on a 400.
 */
async function postDraft(
  settings: Settings,
  path: string,
  payload: unknown,
  copy: { timeout: string; empty: string; validation: string }
): Promise<ColdEmailResult> {
  let response: Response
  try {
    response = await fetch(`${settings.appUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError"
    return {
      ok: false,
      kind: "network",
      message: timedOut
        ? copy.timeout
        : `Could not reach ${settings.appUrl}. Check the App URL in options and that RoleSpec is running.`,
    }
  }

  let data: Record<string, unknown> = {}
  try {
    data = (await response.json()) as Record<string, unknown>
  } catch {
    data = {}
  }
  const serverError =
    typeof data.error === "string" && data.error.trim().length > 0 ? data.error.trim() : undefined

  if (response.ok) {
    const subject = typeof data.subject === "string" ? data.subject : ""
    const body = typeof data.body === "string" ? data.body : ""
    if (!body) {
      return { ok: false, kind: "unknown", message: copy.empty }
    }
    return {
      ok: true,
      subject,
      body,
      grounding: parseGrounding(data.grounding),
      signature: parseSignature(data.signature),
    }
  }
  if (response.status === 401) {
    return {
      ok: false,
      kind: "unauthorized",
      message: serverError ?? "Token rejected. Sign in to RoleSpec again.",
    }
  }
  if (response.status === 429) {
    return {
      ok: false,
      kind: "rate_limited",
      message: serverError ?? "Too many requests. Wait a minute and try again.",
    }
  }
  if (response.status === 400) {
    return { ok: false, kind: "validation", message: serverError ?? copy.validation }
  }
  return {
    ok: false,
    kind: "unknown",
    message: serverError ?? `Unexpected response from RoleSpec (${response.status}).`,
  }
}

/**
 * POST /api/extension/cold-email. A `connection_note` or `linkedin_dm` comes back
 * with an empty subject.
 */
export function generateColdEmail(
  settings: Settings,
  payload: ColdEmailRequest
): Promise<ColdEmailResult> {
  return postDraft(settings, "/api/extension/cold-email", payload, {
    timeout: "RoleSpec took too long to write the email. Try again in a moment.",
    empty: "RoleSpec returned an empty email. Try again.",
    validation: "RoleSpec rejected this profile. Check the fields above.",
  })
}

/**
 * POST /api/extension/email-reply — same envelope as the cold-email route.
 */
export function generateEmailReply(
  settings: Settings,
  payload: EmailReplyRequest
): Promise<EmailReplyResult> {
  return postDraft(settings, "/api/extension/email-reply", payload, {
    timeout: "RoleSpec took too long to write the reply. Try again in a moment.",
    empty: "RoleSpec returned an empty reply. Try again.",
    validation: "RoleSpec rejected this reply request. Check the fields above.",
  })
}

export type ResumeListResult =
  | { ok: true; resumes: ResumeSummary[] }
  | {
      ok: false
      kind: "unauthorized" | "rate_limited" | "network" | "unknown"
      message: string
    }

/**
 * No model call sits behind the resume list, so it gets a short budget: it only fills a
 * picker, and a slow one must never hold up the panel.
 */
const RESUME_LIST_TIMEOUT_MS = 10000

/** Reads one row of the list defensively — an unusable entry is dropped, not guessed at. */
function toResumeSummary(entry: unknown): ResumeSummary | null {
  if (typeof entry !== "object" || entry === null) return null
  const row = entry as Record<string, unknown>
  if (typeof row.id !== "string" || row.id.length === 0) return null
  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : "",
    atsScore: typeof row.atsScore === "number" ? row.atsScore : null,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
  }
}

/**
 * GET /api/extension/resumes — the non-archived resumes, newest first, for the two
 * resume pickers. Callers treat every failure as "no list": drafting still works
 * without one because the server falls back to the newest resume.
 */
export async function fetchResumes(settings: Settings): Promise<ResumeListResult> {
  let response: Response
  try {
    response = await fetch(`${settings.appUrl}/api/extension/resumes`, {
      method: "GET",
      headers: { Authorization: `Bearer ${settings.apiToken}` },
      signal: AbortSignal.timeout(RESUME_LIST_TIMEOUT_MS),
    })
  } catch {
    return {
      ok: false,
      kind: "network",
      message: `Could not reach ${settings.appUrl} to list your resumes.`,
    }
  }

  let data: Record<string, unknown> = {}
  try {
    data = (await response.json()) as Record<string, unknown>
  } catch {
    data = {}
  }
  const serverError =
    typeof data.error === "string" && data.error.trim().length > 0 ? data.error.trim() : undefined

  if (response.ok) {
    const rows = Array.isArray(data.resumes) ? data.resumes : []
    return {
      ok: true,
      resumes: rows
        .map(toResumeSummary)
        .filter((resume): resume is ResumeSummary => resume !== null),
    }
  }
  if (response.status === 401) {
    return {
      ok: false,
      kind: "unauthorized",
      message: serverError ?? "Token rejected. Sign in to RoleSpec again.",
    }
  }
  if (response.status === 429) {
    return {
      ok: false,
      kind: "rate_limited",
      message: serverError ?? "Too many requests. Wait a minute and try again.",
    }
  }
  return {
    ok: false,
    kind: "unknown",
    message: serverError ?? `Unexpected response from RoleSpec (${response.status}).`,
  }
}

export type SearchLinkBoard = "LINKEDIN" | "INDEED" | "JOBSTREET"

/** One prebuilt job-board search URL for a target role. */
export interface SearchLink {
  board: SearchLinkBoard
  label: string
  query: string
  location: string | null
  url: string
}

export interface SearchLinkGroup {
  role: string
  links: SearchLink[]
}

/** 200 body of GET /api/extension/search-links. */
export interface SearchLinksResponse {
  groups: SearchLinkGroup[]
  activeTargetRoleCount: number
}

export type SearchLinksResult =
  | { ok: true; data: SearchLinksResponse }
  | {
      ok: false
      kind: "unauthorized" | "rate_limited" | "network" | "unknown"
      message: string
    }

const SEARCH_LINK_BOARDS: readonly SearchLinkBoard[] = ["LINKEDIN", "INDEED", "JOBSTREET"]

/** No model call sits behind the links either, so it shares the resume list's budget. */
const SEARCH_LINKS_TIMEOUT_MS = 10000

/** Reads one link defensively — an unusable entry is dropped, not guessed at. */
function toSearchLink(entry: unknown): SearchLink | null {
  if (typeof entry !== "object" || entry === null) return null
  const row = entry as Record<string, unknown>
  if (!(SEARCH_LINK_BOARDS as readonly unknown[]).includes(row.board)) return null
  if (typeof row.url !== "string" || !/^https?:\/\//i.test(row.url)) return null
  return {
    board: row.board as SearchLinkBoard,
    label: typeof row.label === "string" ? row.label : "",
    query: typeof row.query === "string" ? row.query : "",
    location: typeof row.location === "string" && row.location.trim() ? row.location : null,
    url: row.url,
  }
}

function toSearchLinkGroup(entry: unknown): SearchLinkGroup | null {
  if (typeof entry !== "object" || entry === null) return null
  const row = entry as Record<string, unknown>
  if (typeof row.role !== "string" || !row.role.trim()) return null
  const links = (Array.isArray(row.links) ? row.links : [])
    .map(toSearchLink)
    .filter((link): link is SearchLink => link !== null)
  if (links.length === 0) return null
  return { role: row.role, links }
}

/**
 * GET /api/extension/search-links — job-board search URLs built from the user's
 * Career Profile target roles. Same error mapping as `fetchResumes`.
 */
export async function fetchSearchLinks(settings: Settings): Promise<SearchLinksResult> {
  let response: Response
  try {
    response = await fetch(`${settings.appUrl}/api/extension/search-links`, {
      method: "GET",
      headers: { Authorization: `Bearer ${settings.apiToken}` },
      signal: AbortSignal.timeout(SEARCH_LINKS_TIMEOUT_MS),
    })
  } catch {
    return {
      ok: false,
      kind: "network",
      message: `Could not reach ${settings.appUrl} to load your search links.`,
    }
  }

  let data: Record<string, unknown> = {}
  try {
    data = (await response.json()) as Record<string, unknown>
  } catch {
    data = {}
  }
  const serverError =
    typeof data.error === "string" && data.error.trim().length > 0 ? data.error.trim() : undefined

  if (response.ok) {
    const groups = (Array.isArray(data.groups) ? data.groups : [])
      .map(toSearchLinkGroup)
      .filter((group): group is SearchLinkGroup => group !== null)
    const count = data.activeTargetRoleCount
    return {
      ok: true,
      data: {
        groups,
        activeTargetRoleCount:
          typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
      },
    }
  }
  if (response.status === 401) {
    return {
      ok: false,
      kind: "unauthorized",
      message: serverError ?? "Token rejected. Sign in to RoleSpec again.",
    }
  }
  if (response.status === 429) {
    return {
      ok: false,
      kind: "rate_limited",
      message: serverError ?? "Too many requests. Wait a minute and try again.",
    }
  }
  return {
    ok: false,
    kind: "unknown",
    message: serverError ?? `Unexpected response from RoleSpec (${response.status}).`,
  }
}

/** One posting on screen, as sent to POST /api/extension/qualify. */
export interface QualifyPosting {
  /** Canonical job URL; the server echoes it back on the matching result. */
  key: string
  title: string
  /** Absolute job URL, when the page has one. */
  url?: string
  companyName?: string
  location?: string
  workType?: WorkType | null
  description?: string
}

/** One verdict as the server returns it. */
export interface QualifyVerdict {
  key: string
  verdict: QualificationVerdict
  riskLevel: JobRiskLevel | null
  marketFit: string | null
  confirmedCount: number
  matched: string[]
}

export type QualifyResult =
  | { ok: true; profileComplete: boolean; results: QualifyVerdict[] }
  | { ok: false; reason: "unauthorized" | "rate_limited" | "validation" | "network" | "unknown" }

/** The route caps one request at this many postings. */
export const MAX_QUALIFY_POSTINGS = 40

/** No model call sits behind the verdicts, and a badge is never worth a long wait. */
const QUALIFY_TIMEOUT_MS = 15000

/**
 * Read a 200 from the qualify route defensively: an unusable result is dropped, never
 * guessed at, and anything but an explicit `profileComplete: true` reads as incomplete
 * (which renders no badges at all).
 */
export function parseQualifyResponse(value: unknown): { profileComplete: boolean; results: QualifyVerdict[] } {
  if (typeof value !== "object" || value === null) return { profileComplete: false, results: [] }
  const { profileComplete, results } = value as { profileComplete?: unknown; results?: unknown }
  const parsed: QualifyVerdict[] = []
  for (const entry of Array.isArray(results) ? results : []) {
    if (typeof entry !== "object" || entry === null) continue
    const row = entry as Record<string, unknown>
    if (typeof row.key !== "string" || !row.key) continue
    if (!(QUALIFICATION_VERDICTS as readonly unknown[]).includes(row.verdict)) continue
    parsed.push({
      key: row.key,
      verdict: row.verdict as QualificationVerdict,
      riskLevel: (JOB_RISK_LEVELS as readonly unknown[]).includes(row.riskLevel)
        ? (row.riskLevel as JobRiskLevel)
        : null,
      marketFit: typeof row.marketFit === "string" ? row.marketFit : null,
      confirmedCount:
        typeof row.confirmedCount === "number" && Number.isFinite(row.confirmedCount) && row.confirmedCount > 0
          ? Math.floor(row.confirmedCount)
          : 0,
      matched: Array.isArray(row.matched)
        ? row.matched.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim())
        : [],
    })
  }
  return { profileComplete: profileComplete === true, results: parsed }
}

/**
 * POST /api/extension/qualify — the heuristic fit verdicts behind the in-page badges.
 * Called only by the background worker, never from a page.
 */
export async function qualifyPostings(settings: Settings, postings: QualifyPosting[]): Promise<QualifyResult> {
  let response: Response
  try {
    response = await fetch(`${settings.appUrl}/api/extension/qualify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiToken}`,
      },
      body: JSON.stringify({ postings: postings.slice(0, MAX_QUALIFY_POSTINGS) }),
      signal: AbortSignal.timeout(QUALIFY_TIMEOUT_MS),
    })
  } catch {
    return { ok: false, reason: "network" }
  }
  if (response.status === 401) return { ok: false, reason: "unauthorized" }
  if (response.status === 429) return { ok: false, reason: "rate_limited" }
  if (response.status === 400) return { ok: false, reason: "validation" }
  if (!response.ok) return { ok: false, reason: "unknown" }
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    return { ok: false, reason: "unknown" }
  }
  return { ok: true, ...parseQualifyResponse(data) }
}
