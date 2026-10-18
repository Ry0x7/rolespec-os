import { logger } from "@/shared/lib/logger"
import { providerLabel } from "../../constants/providers"
import { parseWorkdayBoardUrl, type WorkdayBoard } from "../../constants/workday-board"
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types"
import { humanizeBoardSlug } from "./company-name"
import { ADAPTER_FETCH_BUDGET_MS, fetchMemoized } from "./fetch-memo"
import { matchesQuery, queryTokens } from "./query-match"

/**
 * Workday source adapter.
 *
 * A Workday career site answers a free, key-less search at
 * `POST https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`
 * with `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}` and returns
 * `{ total, jobPostings: [{ title, externalPath, locationsText, postedOn,
 * bulletFields }] }`. Verified live on 2026-09-14 against the Globe site
 * (`globe` / `wd3` / `GLB_Careers`): 379 postings unfiltered, 19 for
 * `searchText: "developer"`.
 *
 * ## Three parts, so the watchlist stores a URL
 *
 * Every other ATS here is keyed on one slug. Workday needs the tenant, the
 * data-centre subdomain and the site id, and none is derivable from the others,
 * so a watched Workday board is the board URL the user copies out of their
 * address bar and `parseWorkdayBoardUrl` takes it apart. That is also why
 * Workday is absent from the company-board probe: there is no name to guess.
 *
 * ## searchText does the filtering, then the title filter still runs
 *
 * Unlike the slug-keyed boards, this endpoint can search, so the role is sent
 * as `searchText` and a 379-posting site is never pulled down whole. Workday
 * matches the whole posting, not just the title, so the same local
 * {@link matchesQuery} title filter the other adapters apply runs afterwards —
 * every adapter should mean the same thing by "matches the query". One page of
 * {@link WORKDAY_PAGE_LIMIT} postings, never walked, so a search that matches
 * more than that server-side is truncated before the title filter sees it.
 *
 * ## What is not mapped
 *
 * `postedOn` is relative prose ("Posted 10 Days Ago", "Posted 30+ Days Ago").
 * Only the exact forms become a date; "30+" is an open-ended floor that could
 * mean a year, and turning it into "30 days ago" would tell opportunity
 * confidence a posting is fresher than anything actually known. Those keep no
 * `postedAt` at all. The search payload has no description either — the detail
 * endpoint has one, and add-by-URL uses it for a single posting.
 *
 * Source etiquette: `robots.txt` on a Workday host allows the career site paths
 * and disallows only `/refreshFacet/`; `/wday/cxs/...` is not disallowed —
 * checked live on 2026-09-14. One request per watched board per query, and a
 * User-Agent that says who is calling. Everything it returns is untrusted input.
 */

const log = logger("discovery")

/** Stored on saved jobs as `sourceProvider`. */
export const WORKDAY_PROVIDER_ID = "workday"

/** Per-query ceiling across every watched board, applied after the local filter. */
export const WORKDAY_RESULT_LIMIT = 25

/**
 * One page per board per query.
 *
 * 20 is not a policy choice, it is the ceiling: the Globe site answered HTTP 400
 * (`errorCode: "HTTP_400"`) for `limit: 21` and `limit: 50` and 200 for
 * `limit: 20` when probed live on 2026-09-14. Raising this silently breaks every
 * Workday board.
 */
export const WORKDAY_PAGE_LIMIT = 20

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

/** The CXS search endpoint for one career site. */
export function workdaySearchUrl(board: WorkdayBoard): string {
  return `https://${board.tenant}.${board.wd}.myworkdayjobs.com/wday/cxs/${board.tenant}/${board.site}/jobs`
}

/** The CXS detail endpoint for one posting, which is the search URL with the posting path on it. */
export function workdayPostingUrl(board: WorkdayBoard, externalPath: string): string {
  return `https://${board.tenant}.${board.wd}.myworkdayjobs.com/wday/cxs/${board.tenant}/${board.site}${externalPath}`
}

/** The page a human opens, which is the locale path plus the posting's `externalPath`. */
export function workdayCanonicalPostingUrl(board: WorkdayBoard, externalPath: string): string {
  return `https://${board.tenant}.${board.wd}.myworkdayjobs.com/en-US/${board.site}${externalPath}`
}

export interface WorkdayJobPosting {
  title?: unknown
  externalPath?: unknown
  locationsText?: unknown
  postedOn?: unknown
  bulletFields?: unknown
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/** Matches "Posted 10 Days Ago" / "Posted Today" / "Posted Yesterday" only. */
const POSTED_DAYS = /^posted\s+(\d+)\s+day/i
const POSTED_TODAY = /^posted\s+today$/i
const POSTED_YESTERDAY = /^posted\s+yesterday$/i

/**
 * `postedOn` is prose, so this returns an *approximate* date: the ISO instant
 * exactly N days before `now`, which is the most the wording supports.
 *
 * "Posted 30+ Days Ago" and anything else unrecognised return undefined rather
 * than a floor date — see the module note. The caller passes `now` so the
 * conversion is testable.
 */
export function workdayPostedAt(value: unknown, now: Date = new Date()): string | undefined {
  const text = asString(value)
  if (!text) return undefined
  if (POSTED_TODAY.test(text)) return now.toISOString()
  if (POSTED_YESTERDAY.test(text)) return new Date(now.getTime() - 86_400_000).toISOString()

  const days = POSTED_DAYS.exec(text)?.[1]
  if (!days) return undefined
  // "30+ Days Ago" fails the anchored digit run because of the "+".
  if (/\d\+/.test(text)) return undefined
  const parsed = Number(days)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3650) return undefined
  return new Date(now.getTime() - parsed * 86_400_000).toISOString()
}

/**
 * Maps one entry of `jobPostings`. Returns null when it is missing a title or an
 * `externalPath` — the path is both the posting's URL and its id, so a posting
 * without one cannot become a job.
 *
 * The tenant stands in for the company name — humanized for display
 * ("globe" → "Globe") — because the payload never states one. The raw tenant
 * still builds every URL.
 */
export function mapWorkdayPosting(
  posting: WorkdayJobPosting,
  board: WorkdayBoard,
  now?: Date
): RawPosting | null {
  const title = asString(posting.title)
  const externalPath = asString(posting.externalPath)
  if (!title || !externalPath || !externalPath.startsWith("/job/")) return null

  return {
    provider: WORKDAY_PROVIDER_ID,
    externalId: externalPath,
    title,
    companyName: humanizeBoardSlug(board.tenant),
    url: workdayCanonicalPostingUrl(board, externalPath),
    location: asString(posting.locationsText),
    postedAt: workdayPostedAt(posting.postedOn, now),
    raw: posting as Record<string, unknown>,
  }
}

/**
 * Pulls the matching entries out of one search response, or null if the
 * `jobPostings` array is not there.
 */
export function parseWorkdayResponse(
  body: unknown,
  board: WorkdayBoard,
  query: DiscoveryQuery,
  now?: Date
): RawPosting[] | null {
  if (!body || typeof body !== "object") return null
  const jobPostings = (body as { jobPostings?: unknown }).jobPostings
  if (!Array.isArray(jobPostings)) return null

  const tokens = queryTokens(query)
  const postings: RawPosting[] = []
  for (const item of jobPostings) {
    if (!item || typeof item !== "object") continue
    const entry = item as WorkdayJobPosting
    if (!matchesQuery(tokens, [asString(entry.title)])) continue
    const mapped = mapWorkdayPosting(entry, board, now)
    if (mapped) postings.push(mapped)
  }
  return postings
}

/**
 * One posting out of a CXS detail response. The description is HTML and
 * `normalizePosting` strips and caps it. The URL and id come from the caller's
 * `externalPath` rather than the payload, which does not repeat them.
 */
export function parseWorkdayPosting(
  body: unknown,
  board: WorkdayBoard,
  externalPath: string
): RawPosting | null {
  if (!body || typeof body !== "object") return null
  const info = (body as { jobPostingInfo?: unknown }).jobPostingInfo
  if (!info || typeof info !== "object") return null
  const posting = info as {
    title?: unknown
    jobDescription?: unknown
    location?: unknown
    locationsText?: unknown
    startDate?: unknown
    postedOn?: unknown
    remoteType?: unknown
  }

  const title = asString(posting.title)
  if (!title) return null

  return {
    provider: WORKDAY_PROVIDER_ID,
    externalId: externalPath,
    title,
    companyName: humanizeBoardSlug(board.tenant),
    url: workdayCanonicalPostingUrl(board, externalPath),
    location: asString(posting.locationsText) ?? asString(posting.location),
    workTypeHint: asString(posting.remoteType),
    description: asString(posting.jobDescription),
    // `startDate` is a real `YYYY-MM-DD` when the site publishes one; `postedOn`
    // is the same relative prose the search returns.
    postedAt: asString(posting.startDate) ?? workdayPostedAt(posting.postedOn),
    raw: posting as Record<string, unknown>,
  }
}

/** One career site. Never rejects: a bad board must not take the others down. */
async function searchBoard(
  boardUrl: string,
  query: DiscoveryQuery,
  signal: AbortSignal
): Promise<RawPosting[]> {
  const board = parseWorkdayBoardUrl(boardUrl)
  if (!board) {
    log.warn("Watched Workday board URL was not recognised", { boardUrl })
    return []
  }

  // Workday searches the whole posting, so the role alone is the widest useful
  // term; extra keywords would narrow it further than the local filter does.
  const searchText = query.role.trim()
  const url = workdaySearchUrl(board)
  const body = JSON.stringify({ appliedFacets: {}, limit: WORKDAY_PAGE_LIMIT, offset: 0, searchText })

  try {
    const response = await fetchMemoized(
      url,
      {
        method: "POST",
        signal,
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": USER_AGENT,
        },
        body,
      },
      // The body is part of the request here, so it is part of the memo key.
      `${url}|${searchText}`,
      ADAPTER_FETCH_BUDGET_MS
    )

    if (!response.ok) {
      log.warn("Workday board returned a non-OK status", {
        status: response.status,
        board: board.boardUrl,
      })
      return []
    }

    const parsed: unknown = JSON.parse(response.text)
    const postings = parseWorkdayResponse(parsed, board, query)
    if (postings === null) {
      log.warn("Workday response shape was not recognised", { board: board.boardUrl })
      return []
    }

    return postings
  } catch (err) {
    // Includes the AbortError from the caller's timeout. A dead board costs the
    // user that company's openings, never an error screen.
    log.warn("Workday board search failed", { err, board: board.boardUrl })
    return []
  }
}

export const workdayAdapter: SourceAdapter = {
  id: WORKDAY_PROVIDER_ID,
  label: providerLabel(WORKDAY_PROVIDER_ID),

  isConfigured: (context) => context.atsWatchlist.workday.length > 0,

  async search(query, signal, context) {
    if (queryTokens(query).length === 0) return []

    const boards = await Promise.all(
      context.atsWatchlist.workday.map((boardUrl) => searchBoard(boardUrl, query, signal))
    )

    return boards.flat().slice(0, WORKDAY_RESULT_LIMIT)
  },
}
