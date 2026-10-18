import { logger } from "@/shared/lib/logger"
import { providerLabel } from "../../constants/providers"
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types"
import { decodeHtmlEntities } from "../normalize.service"
import { ADAPTER_FETCH_BUDGET_MS, fetchMemoized } from "./fetch-memo"
import { matchesQuery, queryTokens } from "./query-match"

/**
 * Greenhouse source adapter.
 *
 * Greenhouse hosts a company's own board behind a free, key-less endpoint
 * (`GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs`) whose response
 * is `{ jobs: [...], meta: { total } }`. Each job carries `id` (number),
 * `absolute_url`, `title`, `company_name`, `location: { name }`, `updated_at`
 * and `first_published` (both ISO with offset). Verified live on 2026-09-04
 * against the gitlab and stripe boards.
 *
 * `?content=true` is deliberately not sent: it inlines every description and
 * turns a 160KB response into a multi-megabyte one. `description` is therefore
 * absent on these postings, which is allowed — normalization treats it as
 * optional and the user still gets a URL to open.
 *
 * There is no cross-company search, so the adapter fans out over the user's
 * watchlist and filters the query locally. Every derived query asks each board
 * for the same bytes, so the response is memoized per URL. Source etiquette: one request
 * per watched company per run, no pagination walk, and a User-Agent that says
 * who is calling. Everything it returns is untrusted input.
 */

const log = logger("discovery")

/**
 * Exported so add-by-URL's ATS path and the company-board probe call the same
 * host this adapter does, rather than each writing the URL out again.
 */
export const GREENHOUSE_ENDPOINT = "https://boards-api.greenhouse.io/v1/boards"

/** Stored on saved jobs as `sourceProvider`. */
export const GREENHOUSE_PROVIDER_ID = "greenhouse"

/** Per-query ceiling across every watched company, applied after the local filter. */
export const GREENHOUSE_RESULT_LIMIT = 25

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

export interface GreenhouseJob {
  id?: unknown
  absolute_url?: unknown
  title?: unknown
  company_name?: unknown
  location?: unknown
  updated_at?: unknown
  /** Only present on the single-posting endpoint; see {@link greenhouseContentToHtml}. */
  content?: unknown
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/** `location` is `{ name }`, not a string. */
function asLocationName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  return asString((value as { name?: unknown }).name)
}

/**
 * `content` on `GET /boards/{slug}/jobs/{id}` is the posting body as HTML with
 * every angle bracket entity-escaped ("&lt;p&gt;Ship&lt;/p&gt;") — verified live
 * on 2026-09-09 against the gitlab and stripe boards. `stripHtml` decodes
 * entities *after* it removes tags, so an escaped body would survive as literal
 * "<p>" text in the description; one decode first hands it the HTML it expects.
 *
 * The decode only runs when the value looks escaped and carries no real tag, so
 * a board that ever serves plain HTML is passed through untouched.
 *
 * The list endpoint has no `content` at all, which is why this returns undefined
 * for it and the adapter's own postings are unchanged.
 */
export function greenhouseContentToHtml(value: unknown): string | undefined {
  const content = asString(value)
  if (!content) return undefined
  if (/&lt;\/?[a-z]/i.test(content) && !/<[a-z/]/i.test(content)) return decodeHtmlEntities(content)
  return content
}

/**
 * Maps one entry of the `jobs` array. Returns null when the entry is missing an
 * id, title or URL — a posting without those cannot become a job, and a
 * provider shape change should thin the list rather than crash the run. The
 * slug is the company-name fallback for a board that does not name itself.
 */
export function mapGreenhouseJob(job: GreenhouseJob, slug: string): RawPosting | null {
  const externalId = asString(job.id)
  const title = asString(job.title)
  const url = asString(job.absolute_url)
  if (!externalId || !title || !url) return null

  return {
    provider: GREENHOUSE_PROVIDER_ID,
    externalId,
    title,
    companyName: asString(job.company_name) ?? slug,
    url,
    location: asLocationName(job.location),
    // Still HTML — `normalizePosting` strips and caps it.
    description: greenhouseContentToHtml(job.content),
    postedAt: asString(job.updated_at),
    raw: job as Record<string, unknown>,
  }
}

/**
 * Pulls the matching entries out of one board's response, or null if the
 * `jobs` array is not there.
 */
export function parseGreenhouseResponse(
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
    const entry = job as GreenhouseJob
    if (!matchesQuery(tokens, [asString(entry.title)])) continue
    const mapped = mapGreenhouseJob(entry, slug)
    if (mapped) postings.push(mapped)
  }
  return postings
}

/** One company's board. Never rejects: a bad slug must not take the others down. */
async function searchBoard(
  slug: string,
  query: DiscoveryQuery,
  signal: AbortSignal
): Promise<RawPosting[]> {
  try {
    const boardUrl = `${GREENHOUSE_ENDPOINT}/${encodeURIComponent(slug)}/jobs`
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
      log.warn("Greenhouse board returned a non-OK status", { status: response.status, slug })
      return []
    }

    const body: unknown = JSON.parse(response.text)
    const postings = parseGreenhouseResponse(body, slug, query)
    if (postings === null) {
      log.warn("Greenhouse response shape was not recognised", { slug })
      return []
    }

    return postings
  } catch (err) {
    // Includes the AbortError from the caller's timeout. A dead board costs the
    // user that company's openings, never an error screen.
    log.warn("Greenhouse board search failed", { err, slug })
    return []
  }
}

export const greenhouseAdapter: SourceAdapter = {
  id: GREENHOUSE_PROVIDER_ID,
  label: providerLabel(GREENHOUSE_PROVIDER_ID),

  isConfigured: (context) => context.atsWatchlist.greenhouse.length > 0,

  async search(query, signal, context) {
    if (queryTokens(query).length === 0) return []

    const boards = await Promise.all(
      context.atsWatchlist.greenhouse.map((slug) => searchBoard(slug, query, signal))
    )

    return boards.flat().slice(0, GREENHOUSE_RESULT_LIMIT)
  },
}
