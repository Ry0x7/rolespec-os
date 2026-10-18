"use server"

import { revalidatePath } from "next/cache"

import { Prisma } from "@/generated/prisma/client"
import {
  ApplicationStatus,
  InterviewQuestionSource,
  JobRiskSource,
  JobSource,
} from "@/generated/prisma/enums"
import { auth } from "@/features/auth/config"
import { loadCareerProfile } from "@/features/career-profile/services/career-profile.service"
import { extractEmployerQuestions } from "@/features/jobs/services/interview-questions.service"
import { extractJobRequirements } from "@/features/jobs/services/job-requirements.service"
import { assessJobRiskHeuristics } from "@/features/jobs/services/job-risk.service"
import {
  createJobApplicationWithJob,
  findExistingJob,
} from "@/features/jobs/services/job-record.service"
import {
  DISCOVERY_ADD_URL_RATE_LIMIT,
  DISCOVERY_RUN_RATE_LIMIT,
} from "@/features/settings/constants/data"
import { parsePreferences } from "@/features/settings/schemas/preferences.schema"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_MESSAGE,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

import {
  DISCOVERY_PROBE_BOARDS_BUCKET,
  DISCOVERY_PROBE_BOARDS_RATE_LIMIT,
} from "../constants/rate-limits"
import {
  addJobByUrlSchema,
  probeCompanyBoardsSchema,
  saveDiscoveredJobSchema,
  type SaveDiscoveredJobInput,
} from "../schemas/discovery.schema"
import { SOURCE_ADAPTERS } from "../services/adapters"
import { ADAPTER_FETCH_BUDGET_MS, isAbortError } from "../services/adapters/fetch-memo"
import {
  deriveBoardSlugs,
  probeBoards,
  type BoardProbeHit,
} from "../services/company-board-probe.service"
import {
  MAX_JOB_LINKS,
  detectListing,
  extractAllJobPostings,
} from "../services/careers-listing.service"
import { deriveDiscoveryQueries } from "../services/derive-queries.service"
import {
  POSTING_FETCH_TIMEOUT_MS,
  extractPostingFromHtml,
  fetchPostingPage,
  fetchPostingFromUrl,
  jobPostingToRaw,
  type ExtractionMethod,
  type PostingFetchFailureReason,
  type PostingFetchResult,
} from "../services/fetch-posting.service"
import type { MarketFit } from "../services/market-fit.service"
import {
  canonicalizeUrl,
  normalizeAndDedupe,
  normalizePosting,
} from "../services/normalize.service"
import {
  CONFIDENCE_RANK,
  assessOpportunityConfidence,
  type OpportunityConfidence,
  type OpportunityConfidenceLevel,
} from "../services/opportunity-confidence.service"
import {
  readQualificationProfileRow,
  type QualificationProfileRow,
} from "../services/qualification-profile.service"
import {
  toStoredQualification,
  type StoredQualification,
} from "../services/qualification-snapshot.service"
import {
  countKeywordMentions,
  qualifyCandidate,
  toQualificationProfile,
  type Qualification,
  type QualificationPosting,
  type QualificationVerdict,
} from "../services/qualify.service"
import type { DiscoveryRunContext, NormalizedPosting, RawPosting } from "../types"

/**
 * Job discovery: `Career Profile → queries → source adapters → normalize →
 * dedupe → candidates`. No AI runs here; enrichment on save is the same
 * deterministic heuristics the extension endpoint uses.
 *
 * Nothing in a run is persisted, and nothing is ever applied to. A candidate
 * becomes a user-owned job only when the user presses Save.
 */

const log = logger("discovery")

/** Ceiling on one adapter run, including every query it fans out to. */
const DISCOVERY_TIMEOUT_MS = 10_000

/** What became of one provider's share of a run. */
export type DiscoverySourceStatus = "ok" | "timeout" | "error" | "skipped"

/**
 * One provider's contribution to a run, for logging and for the Discover line.
 *
 * `count` is postings *after* dedupe, so two sources carrying the same posting
 * do not both claim it. `ms` is the slowest of that provider's queries, since
 * they run concurrently and the slowest one is what the user waited for.
 */
export interface DiscoverySourceReport {
  provider: string
  label: string
  count: number
  ms: number
  status: DiscoverySourceStatus
}

/** A normalized posting plus whether this user already has it on their board. */
export interface DiscoveryCandidate extends Omit<NormalizedPosting, "postedAt"> {
  /** ISO string: server actions serialise to the client, so no Date crosses. */
  postedAt?: string
  alreadySaved: boolean
  /** Id of the existing job when `alreadySaved`, so the row can link to it. */
  savedJobId?: string
  /** Deterministic Career-Profile qualification. No AI ran to produce it. */
  qualification: Qualification
  /**
   * "Is this posting worth my time?", kept separate from the qualification on
   * purpose: fit is about the user, confidence is about the posting.
   */
  confidence: OpportunityConfidence
}

/** Sort order for the candidate list: the ones worth reading first come first. */
const VERDICT_RANK: Record<QualificationVerdict, number> = {
  STRONG: 0,
  WORTH_A_LOOK: 1,
  WEAK: 2,
  BLOCKED: 3,
}

/**
 * Tie-break inside a verdict band: the postings that can actually hire someone
 * where the user lives come first. RESTRICTED rows are already capped at WEAK,
 * but this still orders them against the other WEAK rows, and orders an
 * in-market posting above a worldwide one that scored the same.
 */
const MARKET_FIT_RANK: Record<MarketFit, number> = {
  IN_MARKET: 0,
  REGION: 1,
  OPEN: 2,
  UNKNOWN: 3,
  RESTRICTED: 4,
}

/**
 * The band a candidate is actually sorted in.
 *
 * A LOW-confidence posting costs itself one band: an undisclosed employer on a
 * 60-day-old repost is not one of the first things the user should read, however
 * well it matched. It is a demotion, never a promotion, and it is clamped at
 * WEAK so a thin STRONG can never sort below a posting the checks actually ruled
 * out — BLOCKED stays where it is, since nothing should lift into it either.
 */
function sortRank(
  verdict: QualificationVerdict,
  confidenceLevel: OpportunityConfidenceLevel
): number {
  const base = VERDICT_RANK[verdict]
  if (verdict === "BLOCKED" || confidenceLevel !== "LOW") return base
  return Math.min(base + 1, VERDICT_RANK.WEAK)
}

export interface RunDiscoveryResult {
  queries: string[]
  candidates: DiscoveryCandidate[]
  /** One entry per adapter in the registry, in registry order. */
  sources: DiscoverySourceReport[]
}

/** One (adapter × query) call's outcome, before it is folded per provider. */
interface AdapterCallTiming {
  provider: string
  ms: number
  status: DiscoverySourceStatus
}

/** Worst wins, so a provider that broke once is not reported as fine. */
const SOURCE_STATUS_RANK: Record<DiscoverySourceStatus, number> = {
  error: 0,
  timeout: 1,
  ok: 2,
  skipped: 3,
}

/**
 * Folds per-call timings and the deduped postings into one row per adapter.
 *
 * Every registered adapter appears, including the ones that returned nothing —
 * a source that is quietly contributing zero postings is exactly what this is
 * meant to make visible.
 */
function summarizeSources(
  timings: AdapterCallTiming[],
  normalized: NormalizedPosting[]
): DiscoverySourceReport[] {
  const counts = new Map<string, number>()
  for (const posting of normalized) {
    counts.set(posting.provider, (counts.get(posting.provider) ?? 0) + 1)
  }

  return SOURCE_ADAPTERS.map((adapter) => {
    const calls = timings.filter((timing) => timing.provider === adapter.id)
    const status = calls.reduce<DiscoverySourceStatus>(
      (worst, call) =>
        SOURCE_STATUS_RANK[call.status] < SOURCE_STATUS_RANK[worst] ? call.status : worst,
      "skipped"
    )
    return {
      provider: adapter.id,
      label: adapter.label,
      count: counts.get(adapter.id) ?? 0,
      ms: Math.round(Math.max(0, ...calls.map((call) => call.ms))),
      status,
    }
  })
}

/**
 * Runs every source adapter across every derived query and returns candidates.
 *
 * Nothing is written. `alreadySaved` is a read against the caller's own jobs,
 * matched on either the canonical URL or the raw `jobLink` so jobs saved before
 * `canonicalUrl` existed (or clipped by the extension) still count.
 */
export async function runDiscovery(): Promise<RunDiscoveryResult | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  const userId = session.user.id

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.DISCOVERY_RUN,
    userId,
    DISCOVERY_RUN_RATE_LIMIT
  )
  if (!allowed) return { error: RATE_LIMIT_MESSAGE }

  let queries: ReturnType<typeof deriveDiscoveryQueries>
  let qualificationProfile: ReturnType<typeof toQualificationProfile>
  try {
    const profile = await loadCareerProfile(userId)
    queries = deriveDiscoveryQueries(profile.targetRoles, profile.capabilities)
    // The same read the queries come from — qualification costs no extra query.
    qualificationProfile = toQualificationProfile(profile)
  } catch (err) {
    log.error("Failed to derive discovery queries", { err, userId })
    return { error: "Could not read your career profile. Please try again." }
  }

  if (queries.length === 0) return { queries: [], candidates: [], sources: [] }

  // The ATS adapters have no cross-company search, so they need this user's
  // watchlist. A read failure falls back to the defaults rather than the
  // error screen — the run is still useful without the user's edits.
  let context: DiscoveryRunContext
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    })
    context = { atsWatchlist: parsePreferences(user?.preferences).atsWatchlist }
  } catch (err) {
    log.warn("Failed to read the ATS watchlist preference", { err, userId })
    context = { atsWatchlist: parsePreferences(null).atsWatchlist }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)

  const timings: AdapterCallTiming[] = []
  const runStarted = performance.now()

  let raw: RawPosting[] = []
  try {
    const settled = await Promise.allSettled(
      SOURCE_ADAPTERS.flatMap((adapter) => {
        // No board to ask — reported as "skipped", not as a source that found
        // nothing, and no request is made.
        if (adapter.isConfigured && !adapter.isConfigured(context)) return []

        return queries.map(async (query) => {
          // Own budget, still bounded by the run: whichever fires first wins.
          // Adapters swallow their own AbortError and resolve empty, so the
          // signal is what says "ran out of time", not a rejection.
          // The run-wide signal alone made every source share one deadline, so
          // a single slow provider could spend the whole budget and there was
          // no way to see which one did. The budget is the adapters' own
          // constant, so a call and the request behind it expire together.
          const signal = AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(ADAPTER_FETCH_BUDGET_MS),
          ])
          const started = performance.now()
          try {
            const postings = await adapter.search(query, signal, context)
            timings.push({
              provider: adapter.id,
              ms: performance.now() - started,
              status: signal.aborted ? "timeout" : "ok",
            })
            return postings
          } catch (err) {
            timings.push({
              provider: adapter.id,
              ms: performance.now() - started,
              // An abort is a deadline, not a broken source — including one
              // inherited from a memoized request another query started, where
              // this call's own signal never fired.
              status: signal.aborted || isAbortError(err) ? "timeout" : "error",
            })
            throw err
          }
        })
      })
    )
    for (const result of settled) {
      if (result.status === "fulfilled") raw = raw.concat(result.value)
      // An adapter is contracted to resolve; a rejection means it broke its
      // contract, which costs that one search and nothing else.
      else log.warn("A discovery source rejected", { err: result.reason, userId })
    }
  } finally {
    clearTimeout(timer)
  }

  const normalized = normalizeAndDedupe(raw)
  const sources = summarizeSources(timings, normalized)

  // The one line that says where a slow run went. Per-provider, so the source
  // that spent the budget can be named instead of guessed at.
  log.info("discovery run sources", {
    userId,
    totalMs: Math.round(performance.now() - runStarted),
    sources,
  })

  const canonicalUrls = normalized.map((posting) => posting.canonicalUrl).filter(Boolean)
  const urls = normalized.map((posting) => posting.url)

  // Read against `Job`, which owns the dedupe keys, and map back to the
  // application the row should link to.
  let existing: Array<{
    canonicalUrl: string | null
    url: string | null
    applications: Array<{ id: string }>
  }> = []
  if (normalized.length > 0) {
    try {
      existing = await prisma.job.findMany({
        where: {
          userId,
          OR: [{ canonicalUrl: { in: canonicalUrls } }, { url: { in: urls } }],
        },
        select: {
          canonicalUrl: true,
          url: true,
          applications: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
        },
      })
    } catch (err) {
      // Worst case the user sees a Save button on something they already have;
      // `saveDiscoveredJob` checks again before writing.
      log.warn("Failed to check for already-saved postings", { err, userId })
    }
  }

  const savedByKey = new Map<string, string>()
  for (const job of existing) {
    // A posting whose application was deleted is not "already saved" — there is
    // nothing left for the row to link to.
    const applicationId = job.applications[0]?.id
    if (!applicationId) continue
    if (job.canonicalUrl) savedByKey.set(job.canonicalUrl, applicationId)
    if (job.url) savedByKey.set(canonicalizeUrl(job.url) || job.url, applicationId)
  }

  // Every query carries the same profile keywords; the union keeps that true
  // even if a future change makes them per-role.
  const keywords = [...new Set(queries.flatMap((query) => query.keywords ?? []))]

  const ranked = normalized.map((posting) => {
    const savedJobId = savedByKey.get(posting.canonicalUrl || posting.url)
    return {
      candidate: {
        ...posting,
        postedAt: posting.postedAt?.toISOString(),
        alreadySaved: Boolean(savedJobId),
        savedJobId,
        qualification: qualifyCandidate(posting, qualificationProfile),
        confidence: assessOpportunityConfidence({
          provider: posting.provider,
          source: JobSource.DISCOVERY,
          url: posting.canonicalUrl || posting.url,
          postedAt: posting.postedAt,
          companyName: posting.companyName,
          description: posting.description,
        }),
      } satisfies DiscoveryCandidate,
      // Ranking only: this never removes a posting from the list.
      keywordHits: countKeywordMentions(posting, keywords),
    }
  })

  // Best first — with a LOW-confidence posting costing itself a band, so a thin
  // Strong fit does not outrank a solid posting the user could act on today —
  // then the ones that can hire where the user is, then the ones whose posting
  // is worth the user's time, then the ones that mention more of the user's
  // confirmed capabilities. `sort` is stable, so postings no key can tell apart
  // keep the order the sources returned them in.
  ranked.sort(
    (a, b) =>
      sortRank(a.candidate.qualification.verdict, a.candidate.confidence.level) -
        sortRank(b.candidate.qualification.verdict, b.candidate.confidence.level) ||
      MARKET_FIT_RANK[a.candidate.qualification.marketFit.fit] -
        MARKET_FIT_RANK[b.candidate.qualification.marketFit.fit] ||
      CONFIDENCE_RANK[a.candidate.confidence.level] -
        CONFIDENCE_RANK[b.candidate.confidence.level] ||
      b.keywordHits - a.keywordHits
  )

  const candidates: DiscoveryCandidate[] = ranked.map((entry) => entry.candidate)

  log.info("Discovery run complete", {
    userId,
    queries: queries.length,
    raw: raw.length,
    candidates: candidates.length,
  })

  return { queries: queries.map((query) => query.role), candidates, sources }
}

/** What a careers index page turned out to hold, so the UI can say so. */
export interface ListingSummary {
  /** The page after redirects — what the links were resolved against. */
  pageUrl: string
  pageTitle?: string
  host: string
  /** Posting links found on the page that were not already covered by JSON-LD. */
  totalLinks: number
  /** Links consumed so far, including earlier batches. What "Fetch more" skips. */
  fetched: number
  /** Of the links fetched in this batch, how many produced no posting. */
  skipped: number
  /** Links past `fetched`, untouched. The UI only counts these. */
  remaining: string[]
}

export type AddJobByUrlResult =
  | { candidate: DiscoveryCandidate; extractionMethod: ExtractionMethod }
  | { listing: ListingSummary; candidates: DiscoveryCandidate[] }
  | { error: string; reason: PostingFetchFailureReason }

// A "use server" module may only export async functions, so these stay local.
/** How many posting links one add-by-URL spends its budget on. */
const MAX_LISTING_FETCH = 8

/** Links in flight at once. Four keeps eight inside the 10s outer budget. */
const LISTING_FETCH_CONCURRENCY = 4

/** Ceiling on `offset`, so "Fetch more" cannot be replayed into a long walk. */
const MAX_LISTING_OFFSET = MAX_JOB_LINKS

/**
 * "Add by URL": one pasted URL becomes one candidate — or, when the page is a
 * careers index rather than a posting, the postings on it — through the same
 * normalize → qualify path a source adapter's posting takes.
 *
 * Nothing is written — the rows the user gets back are saved by the same
 * `saveDiscoveredJob` every other candidate uses, under the `web` provider.
 *
 * `options.offset` is the only thing "Fetch more" carries: detection re-runs
 * on the same page and the next slice of links is fetched, so there is no
 * server-side state between the two calls.
 */
export async function addJobByUrl(
  url: string,
  options?: { offset?: number }
): Promise<AddJobByUrlResult> {
  // One debug line per invocation, so a latency claim about this action can be
  // checked against a breakdown instead of re-derived from a stopwatch.
  const startedAt = Date.now()
  const marks: Record<string, number> = {}
  let lastMark = startedAt
  const mark = (name: string) => {
    const now = Date.now()
    marks[name] = now - lastMark
    lastMark = now
  }
  // Every exit past the cheap guards emits, so the failure paths are measured
  // too — an unmeasured path is where a double-digit wall time would hide.
  const emitTiming = (
    outcome: "ok" | "fetch-failed" | "profile-failed",
    extra?: Record<string, unknown>
  ) => {
    log.debug("addJobByUrl timing", {
      ...marks,
      totalMs: Date.now() - startedAt,
      outcome,
      ...extra,
    })
  }

  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized", reason: "invalid-url" }
  const userId = session.user.id
  mark("authMs")

  const parsed = addJobByUrlSchema.safeParse({ url })
  if (!parsed.success) return { error: "Paste a posting URL.", reason: "invalid-url" }

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.DISCOVERY_ADD_URL,
    userId,
    DISCOVERY_ADD_URL_RATE_LIMIT
  )
  mark("rateLimitMs")
  if (!allowed) return { error: RATE_LIMIT_MESSAGE, reason: "unavailable" }

  // Same read `runDiscovery` uses, for the same reason: one query serves both
  // the profile and the qualification. Started before the posting fetch and
  // awaited after it — the two are independent, and the fetch is the long pole.
  const profilePromise = loadCareerProfile(userId).then(
    (profile) => ({ ok: true as const, profile }),
    (err) => {
      log.error("Failed to read the career profile for an add-by-URL", { err, userId })
      return { ok: false as const }
    }
  )

  const offset = Math.min(Math.max(Math.trunc(options?.offset ?? 0), 0), MAX_LISTING_OFFSET)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POSTING_FETCH_TIMEOUT_MS)
  let result: PostingFetchResult
  let listing: Awaited<ReturnType<typeof collectListingPostings>> | null = null
  try {
    const page = await fetchPostingPage(parsed.data.url, controller.signal, mark)

    if (!page.ok) {
      result = page
    } else if (page.kind === "ats-api") {
      result = { ok: true, posting: page.posting, extractionMethod: "ats-api" }
    } else {
      const detected = detectListing({ html: page.html, url: page.finalUrl.toString() })
      if (detected.kind === "single") {
        result = extractPostingFromHtml(page.html, page.finalUrl)
      } else {
        listing = await collectListingPostings(
          page.html,
          page.finalUrl,
          detected.links,
          offset,
          controller.signal
        )
        // Unreachable: the `if (listing)` branch below returns first. Present
        // only so `result` is definitely assigned on every path.
        result = { ok: false, reason: "no-posting", message: LISTING_EMPTY_MESSAGE }
      }
    }
  } finally {
    clearTimeout(timer)
  }
  mark("fetchPostingMs")

  const profileResult = await profilePromise
  mark("profileJoinMs")
  if (!profileResult.ok) {
    emitTiming("profile-failed", { ...(result.ok ? {} : { reason: result.reason }) })
    return {
      error: "Could not read your career profile. Please try again.",
      reason: "unavailable",
    }
  }
  const qualificationProfile = toQualificationProfile(profileResult.profile)

  if (listing) {
    const candidates = await buildListingCandidates(
      userId,
      listing.postings,
      qualificationProfile
    )
    log.info("Added a careers listing by URL", {
      userId,
      host: listing.summary.host,
      totalLinks: listing.summary.totalLinks,
      fetched: listing.summary.fetched,
      candidates: candidates.length,
    })
    mark("qualifyMs")
    emitTiming("ok", { listing: true, candidates: candidates.length })

    if (candidates.length === 0) {
      return { error: LISTING_EMPTY_MESSAGE, reason: "no-posting" }
    }
    return { listing: listing.summary, candidates }
  }

  if (!result.ok) {
    log.info("Add by URL produced no posting", { userId, reason: result.reason })
    emitTiming("fetch-failed", { reason: result.reason })
    return { error: result.message, reason: result.reason }
  }

  const posting = result.posting

  // Same already-saved read as a run, narrowed to this one posting.
  let savedJobId: string | undefined
  try {
    const existing = await prisma.job.findMany({
      where: {
        userId,
        OR: [
          ...(posting.canonicalUrl ? [{ canonicalUrl: posting.canonicalUrl }] : []),
          { url: posting.url },
        ],
      },
      select: {
        applications: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
      },
    })
    savedJobId = existing.map((job) => job.applications[0]?.id).find(Boolean) ?? undefined
  } catch (err) {
    // Worst case the user sees a Save button on something they already have;
    // `saveDiscoveredJob` checks again before writing.
    log.warn("Failed to check whether an added URL is already saved", { err, userId })
  }
  mark("savedCheckMs")

  log.info("Added a posting by URL", {
    userId,
    extractionMethod: result.extractionMethod,
    host: posting.canonicalUrl || posting.url,
  })

  const qualification = qualifyCandidate(posting, qualificationProfile)
  mark("qualifyMs")
  emitTiming("ok", { extractionMethod: result.extractionMethod })

  return {
    candidate: {
      ...posting,
      postedAt: posting.postedAt?.toISOString(),
      alreadySaved: Boolean(savedJobId),
      savedJobId,
      qualification,
      confidence: assessOpportunityConfidence({
        provider: posting.provider,
        source: JobSource.MANUAL,
        url: posting.canonicalUrl || posting.url,
        postedAt: posting.postedAt,
        companyName: posting.companyName,
        description: posting.description,
      }),
    },
    extractionMethod: result.extractionMethod,
  }
}

/**
 * What the user is told when a page is recognisably a careers index but none of
 * its postings could be read — a JS-rendered board, or links that all failed.
 * It names the two things that do work instead rather than just failing.
 */
const LISTING_EMPTY_MESSAGE =
  "That page looks like a careers listing, but none of its postings could be read — " +
  "it probably builds the list in the browser. Add a posting's own URL, watch the " +
  "company's board under Watched companies, or clip the page with the browser extension."

/**
 * Reads the postings off one careers index: the page's own structured data
 * first, then one slice of its posting links.
 *
 * The JSON-LD postings are free — they are already in the HTML that was
 * fetched — so they are taken whole and only the links they do not already
 * cover are spent on. They are only returned for the first slice; "Fetch more"
 * is asking for the next links, not for the same header rows again.
 *
 * A link that fails is skipped, never fatal: eight strangers' pages will not
 * all answer, and a page that 403s should not lose the seven that did.
 */
async function collectListingPostings(
  html: string,
  finalUrl: URL,
  links: string[],
  offset: number,
  signal: AbortSignal
): Promise<{ summary: ListingSummary; postings: NormalizedPosting[] }> {
  const jsonLdPostings = offset === 0 ? postingsFromJsonLd(html, finalUrl) : []
  const covered = new Set(jsonLdPostings.map((posting) => posting.canonicalUrl || posting.url))

  const uncovered = links.filter((link) => !covered.has(canonicalizeUrl(link) || link))
  const batch = uncovered.slice(offset, offset + MAX_LISTING_FETCH)
  const fetchedPostings = await fetchPostingsInParallel(batch, signal)

  return {
    summary: {
      pageUrl: finalUrl.toString(),
      pageTitle: html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || undefined,
      host: finalUrl.hostname.replace(/^www\./, ""),
      totalLinks: uncovered.length,
      fetched: offset + batch.length,
      skipped: batch.length - fetchedPostings.length,
      remaining: uncovered.slice(offset + batch.length),
    },
    postings: [...jsonLdPostings, ...fetchedPostings],
  }
}

/**
 * Every `JobPosting` in the page's structured data, each filed under its own
 * `url` when it states one — otherwise they would all canonicalise to the index
 * page and collapse into a single candidate.
 */
function postingsFromJsonLd(html: string, finalUrl: URL): NormalizedPosting[] {
  const postings: NormalizedPosting[] = []

  for (const node of extractAllJobPostings(html)) {
    let nodeUrl = finalUrl
    const stated = typeof node.url === "string" ? node.url : undefined
    if (stated) {
      try {
        const resolved = new URL(stated, finalUrl)
        if (resolved.protocol === "http:" || resolved.protocol === "https:") nodeUrl = resolved
      } catch {
        // Keep the page URL; a malformed `url` is not worth dropping a posting for.
      }
    }

    const raw = jobPostingToRaw(node, nodeUrl)
    const posting = raw ? normalizePosting(raw) : null
    if (posting) postings.push(posting)
  }

  return postings
}

/** Runs the link fetches `LISTING_FETCH_CONCURRENCY` at a time, in page order. */
async function fetchPostingsInParallel(
  links: string[],
  signal: AbortSignal
): Promise<NormalizedPosting[]> {
  const results: (NormalizedPosting | null)[] = links.map(() => null)
  let next = 0

  const worker = async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= links.length || signal.aborted) return
      try {
        const result = await fetchPostingFromUrl(links[index] as string, signal)
        if (result.ok) results[index] = result.posting
        else log.info("A listing link produced no posting", { reason: result.reason })
      } catch (err) {
        log.warn("A listing link threw while being fetched", { err })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(LISTING_FETCH_CONCURRENCY, links.length) }, worker)
  )

  return results.filter((posting): posting is NormalizedPosting => posting !== null)
}

/**
 * The listing postings become candidates through the same already-saved →
 * qualify → confidence path one pasted posting takes. The saved check is one
 * query for the whole batch rather than one per posting.
 */
async function buildListingCandidates(
  userId: string,
  postings: NormalizedPosting[],
  qualificationProfile: ReturnType<typeof toQualificationProfile>
): Promise<DiscoveryCandidate[]> {
  const deduped: NormalizedPosting[] = []
  const seen = new Set<string>()
  for (const posting of postings) {
    const key = posting.canonicalUrl || posting.url
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(posting)
  }

  const savedByUrl = new Map<string, string>()
  try {
    const existing = await prisma.job.findMany({
      where: {
        userId,
        OR: [
          {
            canonicalUrl: {
              in: deduped
                .map((posting) => posting.canonicalUrl)
                .filter((value): value is string => Boolean(value)),
            },
          },
          { url: { in: deduped.map((posting) => posting.url) } },
        ],
      },
      select: {
        url: true,
        canonicalUrl: true,
        applications: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
      },
    })
    for (const job of existing) {
      const applicationId = job.applications[0]?.id
      if (!applicationId) continue
      if (job.canonicalUrl) savedByUrl.set(job.canonicalUrl, applicationId)
      if (job.url) savedByUrl.set(job.url, applicationId)
    }
  } catch (err) {
    // Same tolerance as the single-posting path: `saveDiscoveredJob` checks again.
    log.warn("Failed to check whether listing postings are already saved", { err, userId })
  }

  return deduped.map((posting) => {
    const savedJobId =
      (posting.canonicalUrl ? savedByUrl.get(posting.canonicalUrl) : undefined) ??
      savedByUrl.get(posting.url)

    return {
      ...posting,
      postedAt: posting.postedAt?.toISOString(),
      alreadySaved: Boolean(savedJobId),
      savedJobId,
      qualification: qualifyCandidate(posting, qualificationProfile),
      confidence: assessOpportunityConfidence({
        provider: posting.provider,
        source: JobSource.MANUAL,
        url: posting.canonicalUrl || posting.url,
        postedAt: posting.postedAt,
        companyName: posting.companyName,
        description: posting.description,
      }),
    }
  })
}

export type ProbeCompanyBoardsResult =
  | {
      /** The slugs that were actually tried, so the empty state can be specific. */
      slugs: string[]
      hits: BoardProbeHit[]
    }
  | { error: string }

/** Ceiling on one probe, covering every candidate slug and provider in it. */
const BOARD_PROBE_TOTAL_TIMEOUT_MS = 10_000

/**
 * "Find a company's board": a company name becomes the ATS boards that actually
 * exist under a slug derived from it.
 *
 * Read-only and additive — nothing is written and nothing is watched by finding
 * it. Adding a hit to the watchlist stays the user's explicit act through
 * `updateAtsWatchlist`, which is the only thing that touches preferences.
 */
export async function probeCompanyBoards(name: string): Promise<ProbeCompanyBoardsResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  const userId = session.user.id

  const parsed = probeCompanyBoardsSchema.safeParse({ name })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a company name" }
  }

  // Twelve outbound requests per click is the widest fan-out a single button in
  // discovery causes, so it gets its own bucket rather than sharing one.
  const allowed = await consumeRateLimit(
    DISCOVERY_PROBE_BOARDS_BUCKET,
    userId,
    DISCOVERY_PROBE_BOARDS_RATE_LIMIT
  )
  if (!allowed) return { error: RATE_LIMIT_MESSAGE }

  const slugs = deriveBoardSlugs(parsed.data.name)
  if (slugs.length === 0) return { slugs: [], hits: [] }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BOARD_PROBE_TOTAL_TIMEOUT_MS)
  let hits: BoardProbeHit[]
  try {
    hits = await probeBoards(slugs, controller.signal)
  } finally {
    clearTimeout(timer)
  }

  log.info("Probed company boards", { userId, slugs: slugs.length, hits: hits.length })

  return { slugs, hits }
}

/**
 * Re-runs the same deterministic pass the candidate row already showed, so the
 * snapshot that lands on the posting is the server's own answer rather than
 * whatever the client posted back.
 *
 * No profile row means no snapshot — there is nothing to qualify against.
 */
function buildQualificationSnapshot(
  profileRow: QualificationProfileRow,
  posting: QualificationPosting
): StoredQualification | null {
  if (!profileRow) return null

  return toStoredQualification(qualifyCandidate(posting, toQualificationProfile(profileRow)))
}

export type SaveDiscoveredJobResult =
  | { success: true; id: string; duplicate: boolean }
  | { error: string }

/**
 * Turns one candidate into a user-owned `JobApplication` at INTERESTED.
 *
 * A posting the user already has returns that job's id with `duplicate: true`
 * rather than an error — the row's job is to end up linking somewhere useful,
 * and a second copy of the same posting helps nobody.
 */
export async function saveDiscoveredJob(
  input: SaveDiscoveredJobInput
): Promise<SaveDiscoveredJobResult> {
  // One debug line per invocation, so a latency claim about this action can be
  // checked against a breakdown instead of re-derived from a stopwatch.
  const startedAt = Date.now()
  const marks: Record<string, number> = {}
  let lastMark = startedAt
  const mark = (name: string) => {
    const now = Date.now()
    marks[name] = now - lastMark
    lastMark = now
  }
  // Every exit past the cheap guards emits, so the duplicate short-circuit and
  // the failed create are measured rather than inferred from the success path.
  const emitTiming = (outcome: "ok" | "duplicate" | "create-failed") => {
    log.debug("saveDiscoveredJob timing", {
      ...marks,
      totalMs: Date.now() - startedAt,
      outcome,
    })
  }

  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  const userId = session.user.id
  mark("authMs")

  const parsed = saveDiscoveredJobSchema.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const {
    provider,
    externalId,
    title,
    companyName,
    url,
    location,
    workType,
    salaryText,
    description,
    postedAt,
  } = parsed.data

  // Never trust the client's canonical form — re-derive it from the URL.
  const canonicalUrl = canonicalizeUrl(url)

  // The snapshot's profile read does not depend on anything the save writes, so
  // it runs alongside the duplicate check and the create rather than after them.
  // Same best-effort contract as before: a failed read costs the stored
  // reasoning only, so the rejection is absorbed here rather than thrown.
  const snapshotProfile = readQualificationProfileRow(userId).catch((err) => {
    log.warn("Failed to read the profile for the qualification snapshot", { err, userId })
    return null
  })

  try {
    const existing = await findExistingJob({
      userId,
      canonicalUrl,
      url,
      sourceProvider: provider,
      externalId,
    })
    if (existing?.applicationId) {
      mark("findExistingJobMs")
      emitTiming("duplicate")
      return { success: true, id: existing.applicationId, duplicate: true }
    }
  } catch (err) {
    // Only a fast path: the unique key on `Job` still decides the outcome.
    log.warn("Duplicate check failed before saving a discovered job", { err, userId })
  }
  mark("findExistingJobMs")

  // Awaited here rather than after the create: the snapshot rides along in the
  // posting's own INSERT, so it has to exist before the write. Best-effort as
  // ever — a missing profile row or a failed pass leaves the snapshot undefined
  // and the job is created without it.
  let qualification: StoredQualification | undefined
  try {
    qualification =
      buildQualificationSnapshot(await snapshotProfile, {
        title,
        companyName,
        url,
        ...(location && { location }),
        ...(workType && { workType }),
        ...(salaryText && { salaryText }),
        ...(description && { description }),
      }) ?? undefined
  } catch (err) {
    log.warn("Failed to build the qualification snapshot", { err, userId })
  }
  mark("snapshotProfileAndQualifyMs")

  // Best-effort, exactly as the extension endpoint does it: a missing scam flag
  // or eligibility badge never costs the user the save.
  let risk: ReturnType<typeof assessJobRiskHeuristics> = null
  try {
    risk = assessJobRiskHeuristics({
      jobTitle: title,
      companyName,
      jobDescription: description,
      jobLink: url,
      location,
    })
  } catch (err) {
    log.warn("Failed to assess job risk heuristics", { err, userId })
  }

  let requirementFlags: string[] = []
  try {
    requirementFlags = extractJobRequirements({ jobDescription: description, location })
  } catch (err) {
    log.warn("Failed to extract job requirements", { err, userId })
  }
  mark("riskAndRequirementsMs")

  try {
    const job = await createJobApplicationWithJob({
      userId,
      companyName,
      jobTitle: title,
      status: ApplicationStatus.INTERESTED,
      jobLink: url,
      location: location ?? null,
      workType: workType ?? null,
      jobDescription: description ?? null,
      // Providers publish salary as free text ("$60k – $80k"), which the
      // numeric column cannot hold; the note keeps it instead of losing it.
      notes: salaryText ? `Salary (as posted): ${salaryText}` : null,
      source: JobSource.DISCOVERY,
      sourceProvider: provider,
      externalId,
      canonicalUrl: canonicalUrl || null,
      discoveredAt: new Date(),
      postedAt: postedAt ? new Date(postedAt) : null,
      ...(risk && {
        riskLevel: risk.level,
        riskReasons: risk.reasons,
        riskSource: JobRiskSource.HEURISTIC,
        riskCheckedAt: new Date(),
      }),
      ...(requirementFlags.length > 0 && { requirementFlags }),
      // A declared interface has no index signature, which is all
      // `InputJsonValue` is missing — the value itself is plain JSON.
      ...(qualification && {
        qualification: qualification as unknown as Prisma.InputJsonValue,
      }),
    })

    mark("createTransactionMs")

    // Best-effort: questions the posting already asks are a bonus, never a
    // reason to fail a save the user just made.
    if (description) {
      const questions = extractEmployerQuestions(description)
      if (questions.length > 0) {
        try {
          await prisma.interviewQuestion.createMany({
            data: questions.map((question) => ({
              jobApplicationId: job.id,
              question,
              source: InterviewQuestionSource.SCRAPED,
            })),
          })
        } catch (err) {
          log.warn("Failed to store scraped interview questions", { err, jobId: job.id })
        }
      }
    }

    mark("interviewQuestionsMs")

    revalidatePath("/jobs")
    mark("revalidateMs")
    emitTiming("ok")
    log.info("Saved a discovered job", {
      userId,
      jobId: job.id,
      provider,
      duplicate: job.duplicate,
    })

    return { success: true, id: job.id, duplicate: job.duplicate }
  } catch (err) {
    log.error("Failed to save a discovered job", { err, userId, provider })
    emitTiming("create-failed")
    return { error: "Something went wrong. Please try again." }
  }
}
