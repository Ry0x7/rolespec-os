import { logger } from "@/shared/lib/logger"
import { providerLabel } from "../../constants/providers"
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types"
import { ADAPTER_FETCH_BUDGET_MS, fetchMemoized } from "./fetch-memo"
import { matchesQuery, queryTokens } from "./query-match"

/**
 * Ashby source adapter.
 *
 * Ashby hosts a company's own board behind a free, key-less endpoint
 * (`GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`)
 * whose response is `{ jobs: [...], apiVersion: 1 }`. Each job carries `id`
 * (uuid string), `title`, `location`, `jobUrl` (`jobs.ashbyhq.com/{slug}/{id}`),
 * `publishedAt` (ISO with offset), `descriptionPlain`, `isListed`, `isRemote`,
 * `workplaceType` ("Remote" | "Hybrid" | "Onsite") and, with the compensation
 * flag, `compensation.compensationTierSummary` as free text. There is no
 * company name in the payload, so the slug stands in. Verified live on
 * 2026-09-09 against the ashby, linear, ramp, vanta and clickup boards.
 *
 * The documented POST form of this URL answers 401 without an API key; the GET
 * form is the public one and is what this uses.
 *
 * Unlike Greenhouse there is no lean mode — descriptions are always inlined, so
 * a large board is a multi-megabyte response. That is the reason the default
 * watchlist is short and the reason the per-URL memo matters here more than
 * anywhere else.
 *
 * There is no cross-company search, so the adapter fans out over the user's
 * watchlist and filters the query locally. Source etiquette: one request per
 * watched company per run, no pagination walk, and a User-Agent that says who is
 * calling. Everything it returns is untrusted input.
 */

const log = logger("discovery")

/**
 * Exported so add-by-URL's ATS path and the company-board probe call the same
 * host this adapter does, rather than each writing the URL out again.
 */
export const ASHBY_ENDPOINT = "https://api.ashbyhq.com/posting-api/job-board"

/** Stored on saved jobs as `sourceProvider`. */
export const ASHBY_PROVIDER_ID = "ashby"

/** Per-query ceiling across every watched company, applied after the local filter. */
export const ASHBY_RESULT_LIMIT = 25

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

export interface AshbyJob {
  id?: unknown
  title?: unknown
  location?: unknown
  jobUrl?: unknown
  publishedAt?: unknown
  descriptionPlain?: unknown
  workplaceType?: unknown
  isRemote?: unknown
  isListed?: unknown
  compensation?: unknown
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/**
 * `compensation.compensationTierSummary` ("$211.4K – $290.6K • Offers Equity"),
 * which is the only compensation field that is already a sentence. The numeric
 * components are deliberately ignored: normalization stores salary as the text
 * the company published.
 */
function asCompensationText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const compensation = value as {
    compensationTierSummary?: unknown
    scrapeableCompensationSalarySummary?: unknown
  }
  return (
    asString(compensation.compensationTierSummary) ??
    asString(compensation.scrapeableCompensationSalarySummary)
  )
}

/**
 * The board's own wording for where the job is done. `workplaceType` is the
 * stated answer; `isRemote === true` stands in when it is absent. A false
 * `isRemote` says nothing, so it is left unstated rather than called onsite.
 */
function asWorkTypeHint(job: AshbyJob): string | undefined {
  return asString(job.workplaceType) ?? (job.isRemote === true ? "remote" : undefined)
}

/**
 * Maps one entry of the `jobs` array. Returns null when the entry is missing an
 * id, title or URL — a posting without those cannot become a job, and a
 * provider shape change should thin the list rather than crash the run. The
 * slug is the company name: the payload never states one.
 */
export function mapAshbyJob(job: AshbyJob, slug: string): RawPosting | null {
  const externalId = asString(job.id)
  const title = asString(job.title)
  const url = asString(job.jobUrl)
  if (!externalId || !title || !url) return null

  return {
    provider: ASHBY_PROVIDER_ID,
    externalId,
    title,
    companyName: slug,
    url,
    location: asString(job.location),
    workTypeHint: asWorkTypeHint(job),
    salaryText: asCompensationText(job.compensation),
    description: asString(job.descriptionPlain),
    postedAt: asString(job.publishedAt),
    raw: job as Record<string, unknown>,
  }
}

/**
 * Pulls the matching entries out of one board's response, or null if the `jobs`
 * array is not there. `isListed === false` is the board saying a posting is not
 * public, so it is dropped before anything else looks at it.
 */
export function parseAshbyResponse(
  body: unknown,
  slug: string,
  query: DiscoveryQuery
): RawPosting[] | null {
  if (!body || typeof body !== "object") return null
  const jobs = (body as { jobs?: unknown }).jobs
  if (!Array.isArray(jobs)) return null

  const tokens = queryTokens(query)
  const postings: RawPosting[] = []
  for (const job of jobs) {
    if (!job || typeof job !== "object") continue
    const entry = job as AshbyJob
    if (entry.isListed === false) continue
    if (!matchesQuery(tokens, [asString(entry.title)])) continue
    const mapped = mapAshbyJob(entry, slug)
    if (mapped) postings.push(mapped)
  }
  return postings
}

/**
 * One posting out of a board response, by its Ashby id.
 *
 * Ashby publishes no single-posting endpoint, so add-by-URL reads the same board
 * payload the adapter does and picks the entry out. `isListed === false` is
 * still honoured: an unlisted posting is the board saying it is not public, and
 * that does not change because the user happens to hold its URL.
 */
export function findAshbyJobById(body: unknown, slug: string, id: string): RawPosting | null {
  if (!body || typeof body !== "object") return null
  const jobs = (body as { jobs?: unknown }).jobs
  if (!Array.isArray(jobs)) return null

  const wanted = id.toLowerCase()
  for (const job of jobs) {
    if (!job || typeof job !== "object") continue
    const entry = job as AshbyJob
    if (entry.isListed === false) continue
    if (asString(entry.id)?.toLowerCase() !== wanted) continue
    return mapAshbyJob(entry, slug)
  }
  return null
}

/** One company's board. Never rejects: a bad slug must not take the others down. */
async function searchBoard(
  slug: string,
  query: DiscoveryQuery,
  signal: AbortSignal
): Promise<RawPosting[]> {
  try {
    const boardUrl = `${ASHBY_ENDPOINT}/${encodeURIComponent(slug)}?includeCompensation=true`
    const response = await fetchMemoized(
      boardUrl,
      {
        signal,
        cache: "no-store",
        headers: { accept: "application/json", "user-agent": USER_AGENT },
      },
      boardUrl,
      ADAPTER_FETCH_BUDGET_MS
    )

    if (!response.ok) {
      log.warn("Ashby board returned a non-OK status", { status: response.status, slug })
      return []
    }

    const body: unknown = JSON.parse(response.text)
    const postings = parseAshbyResponse(body, slug, query)
    if (postings === null) {
      log.warn("Ashby response shape was not recognised", { slug })
      return []
    }

    return postings
  } catch (err) {
    // Includes the AbortError from the caller's timeout. A dead board costs the
    // user that company's openings, never an error screen.
    log.warn("Ashby board search failed", { err, slug })
    return []
  }
}

export const ashbyAdapter: SourceAdapter = {
  id: ASHBY_PROVIDER_ID,
  label: providerLabel(ASHBY_PROVIDER_ID),

  isConfigured: (context) => context.atsWatchlist.ashby.length > 0,

  async search(query, signal, context) {
    if (queryTokens(query).length === 0) return []

    const boards = await Promise.all(
      context.atsWatchlist.ashby.map((slug) => searchBoard(slug, query, signal))
    )

    return boards.flat().slice(0, ASHBY_RESULT_LIMIT)
  },
}
