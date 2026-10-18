import { logger } from "@/shared/lib/logger"
import { providerLabel } from "../../constants/providers"
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types"
import { fetchMemoized } from "./fetch-memo"
import { matchesQuery, queryTokens } from "./query-match"

/**
 * Arbeitnow source adapter.
 *
 * Arbeitnow publishes a free, key-less job board feed
 * (`GET https://www.arbeitnow.com/api/job-board-api`) whose response is
 * `{ data: [...], links, meta }`. Each entry carries `slug` (string, the id),
 * `company_name`, `title`, `description` (HTML), `remote` (boolean), `url`,
 * `tags` (string[]), `job_types` (string[]), `location` and `created_at` (unix
 * seconds, a number). Verified live on 2026-09-04 against the real endpoint.
 *
 * The feed has no search parameter — it returns one global page — so the query
 * is applied locally against the title and tags, and the response is memoized
 * per URL so a multi-query run does not re-download the same page. Source
 * etiquette: one request per run, first page only, no pagination walk, and a
 * User-Agent that says who is calling. Everything it returns is untrusted input.
 */

const log = logger("discovery")

const ARBEITNOW_ENDPOINT = "https://www.arbeitnow.com/api/job-board-api"

/** Stored on saved jobs as `sourceProvider`. */
export const ARBEITNOW_PROVIDER_ID = "arbeitnow"

/** Per-query ceiling, applied after the local filter. */
export const ARBEITNOW_RESULT_LIMIT = 25

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

interface ArbeitnowJob {
  slug?: unknown
  url?: unknown
  title?: unknown
  company_name?: unknown
  location?: unknown
  remote?: unknown
  description?: unknown
  tags?: unknown
  created_at?: unknown
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/** The `tags` array as strings, ignoring whatever else the array may hold. */
function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((tag): tag is string => typeof tag === "string")
}

/** `created_at` is unix seconds; normalization wants something Date can parse. */
function asPostedAt(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString()
  }
  return asString(value)
}

/**
 * Maps one entry of the `data` array. Returns null when the entry is missing an
 * id, title, company or URL — a posting without those cannot become a job, and
 * a provider shape change should thin the list rather than crash the run.
 */
export function mapArbeitnowJob(job: ArbeitnowJob): RawPosting | null {
  const externalId = asString(job.slug)
  const title = asString(job.title)
  const companyName = asString(job.company_name)
  const url = asString(job.url)
  if (!externalId || !title || !companyName || !url) return null

  return {
    provider: ARBEITNOW_PROVIDER_ID,
    externalId,
    title,
    companyName,
    url,
    location: asString(job.location),
    // Only a true flag is trustworthy: postings with `remote: false` still turn
    // up with "oder remote" in their location text, so false means "unstated".
    workTypeHint: job.remote === true ? "remote" : undefined,
    description: asString(job.description),
    postedAt: asPostedAt(job.created_at),
    raw: job as Record<string, unknown>,
  }
}

/** Pulls the `data` array out of a response body, or null if it is not there. */
export function parseArbeitnowResponse(body: unknown, query: DiscoveryQuery): RawPosting[] | null {
  if (!body || typeof body !== "object") return null
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return null

  const tokens = queryTokens(query)
  const postings: RawPosting[] = []
  for (const job of data) {
    if (!job || typeof job !== "object") continue
    const entry = job as ArbeitnowJob
    if (!matchesQuery(tokens, [asString(entry.title), ...asTags(entry.tags)])) continue
    const mapped = mapArbeitnowJob(entry)
    if (mapped) postings.push(mapped)
  }
  return postings
}

export const arbeitnowAdapter: SourceAdapter = {
  id: ARBEITNOW_PROVIDER_ID,
  label: providerLabel(ARBEITNOW_PROVIDER_ID),

  async search(query, signal) {
    if (queryTokens(query).length === 0) return []

    try {
      const response = await fetchMemoized(ARBEITNOW_ENDPOINT, {
        signal,
        cache: "no-store",
        headers: { accept: "application/json", "user-agent": USER_AGENT },
      })

      if (!response.ok) {
        log.warn("Arbeitnow search returned a non-OK status", {
          status: response.status,
          role: query.role,
        })
        return []
      }

      const body: unknown = JSON.parse(response.text)
      const postings = parseArbeitnowResponse(body, query)
      if (postings === null) {
        log.warn("Arbeitnow response shape was not recognised", { role: query.role })
        return []
      }

      return postings.slice(0, ARBEITNOW_RESULT_LIMIT)
    } catch (err) {
      // Includes the AbortError from the caller's timeout. A dead source costs
      // the user an empty list, never an error screen.
      log.warn("Arbeitnow search failed", { err, role: query.role })
      return []
    }
  },
}
