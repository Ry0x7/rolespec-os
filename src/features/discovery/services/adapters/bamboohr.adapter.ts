import { logger } from "@/shared/lib/logger"
import { providerLabel } from "../../constants/providers"
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types"
import { humanizeBoardSlug } from "./company-name"
import { ADAPTER_FETCH_BUDGET_MS, fetchMemoized } from "./fetch-memo"
import { matchesQuery, queryTokens } from "./query-match"

/**
 * BambooHR source adapter.
 *
 * BambooHR hosts a company's own board behind a free, key-less endpoint
 * (`GET https://{slug}.bamboohr.com/careers/list`) whose response is
 * `{ meta: { totalCount }, result: [...] }`. Each entry carries `id` (a numeric
 * string), `jobOpeningName`, `departmentLabel`, `employmentStatusLabel`,
 * `location: { city, state }`, `atsLocation: { country, state, province, city }`,
 * `isRemote` and `locationType`. Verified live on 2026-09-14 against the kumu
 * board (7 postings, Makati).
 *
 * The list carries no description and no posting date. `GET /careers/{id}/detail`
 * does carry both (`result.jobOpening.description` as HTML and
 * `datePosted` as `YYYY-MM-DD`) — verified live the same day — but that is one
 * request per posting, so it is used only by add-by-URL's single-posting path.
 * In list mode `description` and `postedAt` are simply absent, which is allowed:
 * normalization treats both as optional. Note the consequence — a BambooHR
 * posting found by search has no real posting date, so opportunity confidence
 * falls back to when it was seen.
 *
 * The payload never names the company, so the slug stands in — humanized for
 * display ("kumu" → "Kumu") while the raw slug still builds the URL.
 *
 * Source etiquette: `robots.txt` on a board host disallows only
 * `/jobs/embed.php` and `/jobs/embed2.php`, so `/careers/list` and
 * `/careers/{id}/detail` are both allowed — confirmed live on 2026-09-14. One
 * request per watched company per run, no pagination walk, and a User-Agent
 * that says who is calling. Everything it returns is untrusted input.
 */

const log = logger("discovery")

/**
 * A slug becomes a subdomain, so it cannot be escaped the way a path segment
 * can. Anything that is not the shape the watchlist already enforces is refused
 * rather than concatenated into a host.
 */
export const BAMBOOHR_SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/

/** Exported so add-by-URL and the company-board probe call the same host this adapter does. */
export function bamboohrBoardUrl(slug: string): string {
  return `https://${slug}.bamboohr.com/careers/list`
}

/** The single-posting detail endpoint, which is the only place a description lives. */
export function bamboohrPostingUrl(slug: string, id: string): string {
  return `https://${slug}.bamboohr.com/careers/${encodeURIComponent(id)}/detail`
}

/** Stored on saved jobs as `sourceProvider`. */
export const BAMBOOHR_PROVIDER_ID = "bamboohr"

/** Per-query ceiling across every watched company, applied after the local filter. */
export const BAMBOOHR_RESULT_LIMIT = 25

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

export interface BambooHrJob {
  id?: unknown
  jobOpeningName?: unknown
  departmentLabel?: unknown
  location?: unknown
  atsLocation?: unknown
  isRemote?: unknown
  locationType?: unknown
  /** Only on the detail endpoint. */
  description?: unknown
  /** Only on the detail endpoint; `YYYY-MM-DD`. */
  datePosted?: unknown
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/**
 * Where the job is, as the board states it.
 *
 * BambooHR fills exactly one of two objects per posting: `location`
 * (`{ city, state }`) on some, `atsLocation` (`{ city, province, state, country }`)
 * on others — both shapes appear on the same board. The detail endpoint spells
 * the country `addressCountry` inside `location`, so that key is read too. The
 * parts that are present are joined in the order a reader would write them;
 * nothing is inferred, and a part that appears in both objects is written once.
 */
export function bamboohrLocation(job: BambooHrJob): string | undefined {
  const parts: string[] = []
  const seen = new Set<string>()
  for (const source of [job.location, job.atsLocation]) {
    if (!source || typeof source !== "object") continue
    const place = source as Record<string, unknown>
    for (const key of ["city", "province", "state", "country", "addressCountry"]) {
      const part = asString(place[key])
      if (!part) continue
      const dedupeKey = part.toLowerCase()
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      parts.push(part)
    }
  }
  return parts.length > 0 ? parts.join(", ") : undefined
}

/**
 * `isRemote` is the board's own answer when it has one. A false or null
 * `isRemote` says nothing, so it is left unstated rather than called onsite —
 * `locationType` is an unlabelled numeric code and is deliberately not guessed
 * at.
 */
function asWorkTypeHint(job: BambooHrJob): string | undefined {
  return job.isRemote === true ? "remote" : undefined
}

/**
 * Maps one entry of the `result` array. Returns null when the entry is missing
 * an id or a title — a posting without those cannot become a job, and a
 * provider shape change should thin the list rather than crash the run. The URL
 * is derived from the raw slug: BambooHR publishes postings at `/careers/{id}`
 * and the payload carries no link of its own.
 */
export function mapBambooHrJob(job: BambooHrJob, slug: string): RawPosting | null {
  const externalId = asString(job.id)
  const title = asString(job.jobOpeningName)
  if (!externalId || !title) return null

  return {
    provider: BAMBOOHR_PROVIDER_ID,
    externalId,
    title,
    companyName: humanizeBoardSlug(slug),
    url: `https://${slug}.bamboohr.com/careers/${externalId}`,
    location: bamboohrLocation(job),
    workTypeHint: asWorkTypeHint(job),
    // Still HTML on the detail endpoint; `normalizePosting` strips and caps it.
    description: asString(job.description),
    postedAt: asString(job.datePosted),
    raw: job as Record<string, unknown>,
  }
}

/**
 * Pulls the matching entries out of one board's response, or null if the
 * `result` array is not there.
 */
export function parseBambooHrResponse(
  body: unknown,
  slug: string,
  query: DiscoveryQuery
): RawPosting[] | null {
  if (!body || typeof body !== "object") return null
  const result = (body as { result?: unknown }).result
  if (!Array.isArray(result)) return null

  const tokens = queryTokens(query)
  const postings: RawPosting[] = []
  for (const job of result) {
    if (!job || typeof job !== "object") continue
    const entry = job as BambooHrJob
    if (!matchesQuery(tokens, [asString(entry.jobOpeningName)])) continue
    const mapped = mapBambooHrJob(entry, slug)
    if (mapped) postings.push(mapped)
  }
  return postings
}

/**
 * One posting out of a `/careers/{id}/detail` response, which nests the job
 * under `result.jobOpening` rather than returning it bare.
 */
export function parseBambooHrPosting(body: unknown, slug: string, id: string): RawPosting | null {
  if (!body || typeof body !== "object") return null
  const result = (body as { result?: unknown }).result
  if (!result || typeof result !== "object") return null
  const jobOpening = (result as { jobOpening?: unknown }).jobOpening
  if (!jobOpening || typeof jobOpening !== "object") return null

  // The detail payload has no `id` of its own, so the one from the URL is used.
  return mapBambooHrJob({ ...(jobOpening as BambooHrJob), id }, slug)
}

/** One company's board. Never rejects: a bad slug must not take the others down. */
async function searchBoard(
  slug: string,
  query: DiscoveryQuery,
  signal: AbortSignal
): Promise<RawPosting[]> {
  if (!BAMBOOHR_SAFE_SLUG.test(slug)) return []

  try {
    const boardUrl = bamboohrBoardUrl(slug)
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
      log.warn("BambooHR board returned a non-OK status", { status: response.status, slug })
      return []
    }

    const body: unknown = JSON.parse(response.text)
    const postings = parseBambooHrResponse(body, slug, query)
    if (postings === null) {
      log.warn("BambooHR response shape was not recognised", { slug })
      return []
    }

    return postings
  } catch (err) {
    // Includes the AbortError from the caller's timeout. A dead board costs the
    // user that company's openings, never an error screen.
    log.warn("BambooHR board search failed", { err, slug })
    return []
  }
}

export const bamboohrAdapter: SourceAdapter = {
  id: BAMBOOHR_PROVIDER_ID,
  label: providerLabel(BAMBOOHR_PROVIDER_ID),

  isConfigured: (context) => context.atsWatchlist.bamboohr.length > 0,

  async search(query, signal, context) {
    if (queryTokens(query).length === 0) return []

    const boards = await Promise.all(
      context.atsWatchlist.bamboohr.map((slug) => searchBoard(slug, query, signal))
    )

    return boards.flat().slice(0, BAMBOOHR_RESULT_LIMIT)
  },
}
