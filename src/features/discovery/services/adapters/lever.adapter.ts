import { logger } from "@/shared/lib/logger"
import { providerLabel } from "../../constants/providers"
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types"
import { ADAPTER_FETCH_BUDGET_MS, fetchMemoized, isAbortError } from "./fetch-memo"
import { matchesQuery, queryTokens } from "./query-match"

/**
 * Lever source adapter.
 *
 * Lever hosts a company's own board behind a free, key-less endpoint
 * (`GET https://api.lever.co/v0/postings/{slug}?mode=json`) whose response is a
 * bare array. Each posting carries `id` (uuid string), `text` (the title),
 * `hostedUrl`, `categories: { commitment, department, location, team }`,
 * `createdAt` (unix milliseconds, a number), `descriptionPlain` and
 * `workplaceType` ("remote" | "hybrid" | "onsite"). There is no company name in
 * the payload, so the slug stands in. Verified live on 2026-09-04 against the
 * ro and spotify boards.
 *
 * There is no cross-company search, so the adapter fans out over the user's
 * watchlist and filters the query locally. A board response is several hundred KB and
 * every derived query asks for the same bytes, so it is memoized per URL. Source
 * etiquette: one request per watched company per run, no pagination walk, and a
 * User-Agent that says who is calling. Everything it returns is untrusted input.
 */

const log = logger("discovery")

/**
 * Exported so add-by-URL's ATS path and the company-board probe call the same
 * host this adapter does, rather than each writing the URL out again.
 */
export const LEVER_ENDPOINT = "https://api.lever.co/v0/postings"

/** Stored on saved jobs as `sourceProvider`. */
export const LEVER_PROVIDER_ID = "lever"

/** Per-query ceiling across every watched company, applied after the local filter. */
export const LEVER_RESULT_LIMIT = 25

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

export interface LeverPosting {
  id?: unknown
  text?: unknown
  hostedUrl?: unknown
  categories?: unknown
  createdAt?: unknown
  descriptionPlain?: unknown
  workplaceType?: unknown
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/** `categories.location`, which is where Lever keeps the place. */
function asCategoryLocation(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  return asString((value as { location?: unknown }).location)
}

/** `createdAt` is unix milliseconds; normalization wants something Date can parse. */
function asPostedAt(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  return asString(value)
}

/**
 * Maps one posting. Returns null when it is missing an id, title or URL — a
 * posting without those cannot become a job, and a provider shape change should
 * thin the list rather than crash the run.
 */
export function mapLeverPosting(posting: LeverPosting, slug: string): RawPosting | null {
  const externalId = asString(posting.id)
  const title = asString(posting.text)
  const url = asString(posting.hostedUrl)
  if (!externalId || !title || !url) return null

  return {
    provider: LEVER_PROVIDER_ID,
    externalId,
    title,
    companyName: slug,
    url,
    location: asCategoryLocation(posting.categories),
    workTypeHint: asString(posting.workplaceType),
    description: asString(posting.descriptionPlain),
    postedAt: asPostedAt(posting.createdAt),
    raw: posting as Record<string, unknown>,
  }
}

/**
 * Pulls the matching postings out of one board's response, or null if the body
 * is not the array Lever documents.
 */
export function parseLeverResponse(
  body: unknown,
  slug: string,
  query: DiscoveryQuery
): RawPosting[] | null {
  if (!Array.isArray(body)) return null

  const tokens = queryTokens(query)
  const postings: RawPosting[] = []
  for (const item of body) {
    if (!item || typeof item !== "object") continue
    const entry = item as LeverPosting
    if (!matchesQuery(tokens, [asString(entry.text)])) continue
    const mapped = mapLeverPosting(entry, slug)
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
  // The adapter reports one number for the whole fan-out, so a slow run only
  // says "Lever". This says which board. Debug level: one line per board per
  // query is noise in normal use and exactly what is wanted when hunting a
  // source that is spending the budget.
  const started = performance.now()
  const done = (status: string, count: number) =>
    log.debug("Lever board fetch", {
      slug,
      role: query.role,
      ms: Math.round(performance.now() - started),
      status,
      count,
    })

  try {
    const boardUrl = `${LEVER_ENDPOINT}/${encodeURIComponent(slug)}?mode=json`
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
      log.warn("Lever board returned a non-OK status", { status: response.status, slug })
      done(`http-${response.status}`, 0)
      return []
    }

    const body: unknown = JSON.parse(response.text)
    const postings = parseLeverResponse(body, slug, query)
    if (postings === null) {
      log.warn("Lever response shape was not recognised", { slug })
      done("unrecognised", 0)
      return []
    }

    done("ok", postings.length)
    return postings
  } catch (err) {
    // Includes the AbortError from the caller's timeout. A dead board costs the
    // user that company's openings, never an error screen.
    log.warn("Lever board search failed", { err, slug })
    done(signal.aborted || isAbortError(err) ? "aborted" : "error", 0)
    return []
  }
}

export const leverAdapter: SourceAdapter = {
  id: LEVER_PROVIDER_ID,
  label: providerLabel(LEVER_PROVIDER_ID),

  isConfigured: (context) => context.atsWatchlist.lever.length > 0,

  async search(query, signal, context) {
    if (queryTokens(query).length === 0) return []

    const boards = await Promise.all(
      context.atsWatchlist.lever.map((slug) => searchBoard(slug, query, signal))
    )

    return boards.flat().slice(0, LEVER_RESULT_LIMIT)
  },
}
