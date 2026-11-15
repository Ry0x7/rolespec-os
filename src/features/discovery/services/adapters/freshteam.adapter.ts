import { logger } from "@/shared/lib/logger"
import { providerLabel } from "../../constants/providers"
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types"
import { decodeHtmlEntities } from "../normalize.service"
import { ADAPTER_FETCH_BUDGET_MS, fetchMemoized } from "./fetch-memo"
import { matchesQuery, queryTokens } from "./query-match"

/**
 * Freshteam source adapter.
 *
 * Freshteam hosts a company's own board at `https://{slug}.freshteam.com/jobs`,
 * server-rendered, with every open role on one page. Each role sits in a
 * `<li class="heading">` block carrying a `/jobs/{uniqueId}/{titleSlug}` link, a
 * `<span class="job-title">`, a one-line `<span class="job-desc text">` teaser
 * and a `<span class="location-info">` holding the place and the employment type
 * separated by a `<br />`. The company's real name is the page `<title>`.
 * Verified live on 2026-09-14 against the thinkingmachines board (5 postings,
 * Taguig).
 *
 * ## Why the HTML page and not the widget JSON
 *
 * Freshteam does publish `GET /hire/widgets/jobs.json`, which is richer — full
 * HTML descriptions, `created_at`, a `remote` boolean and the canonical `url`.
 * It is **not** usable: `https://{slug}.freshteam.com/robots.txt` reads
 * `User-agent: * / Allow: /jobs / Allow: /.well-known/assetlinks.json /
 * Disallow: /`, so every path outside `/jobs` is disallowed for us, the widget
 * endpoint included. Checked live on 2026-09-14. `/jobs` is explicitly allowed,
 * so that is what this reads — the same ruling that kept RoleSpec off
 * JobStreet's `/api/jobsearch/`.
 *
 * The consequence is stated rather than worked around: a Freshteam posting
 * found by search carries no description and no posting date, because the
 * listing page has neither. The `job-desc` teaser is a one-line marketing
 * summary, not the posting body, so it is deliberately not passed off as one.
 * Add-by-URL on a single `/jobs/{id}/{slug}` posting page is allowed and keeps
 * the existing HTML extraction, which does get the real body.
 *
 * Parsed with targeted regex over that repeated markup rather than a DOM
 * library, the same call the OnlineJobs.ph adapter makes for the same reason.
 *
 * There is no cross-company search, so the adapter fans out over the user's
 * watchlist and filters the query locally. One request per watched company per
 * run (the page is memoized per URL), no pagination walk, and a User-Agent that
 * says who is calling. Everything it returns is untrusted input.
 */

const log = logger("discovery")

/** Exported so the company-board probe reads the same page this adapter does. */
export function freshteamBoardUrl(slug: string): string {
  return `https://${slug}.freshteam.com/jobs`
}

/** Stored on saved jobs as `sourceProvider`. */
export const FRESHTEAM_PROVIDER_ID = "freshteam"

/** Per-query ceiling across every watched company, applied after the local filter. */
export const FRESHTEAM_RESULT_LIMIT = 25

/**
 * A slug becomes a subdomain, so it cannot be escaped the way a path segment
 * can. Anything that is not the shape the watchlist already enforces is refused
 * rather than concatenated into a host.
 */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

/** One posting's `<li class="heading">` block, split off before any field is read. */
const JOB_BLOCK = /<li class="heading">([\s\S]*?)<\/li>/g

const JOB_HREF = /href="(\/jobs\/[^"?#]+)"/
const JOB_TITLE = /<span class="job-title">([\s\S]*?)<\/span>/
const LOCATION_INFO = /<span class="location-info">([\s\S]*?)<\/span>/
const PAGE_TITLE = /<title>([\s\S]*?)<\/title>/i

/** Tags out, entities decoded, whitespace collapsed. Returns undefined for an empty result. */
function text(html: string | undefined): string | undefined {
  if (!html) return undefined
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() || undefined
}

function firstMatch(pattern: RegExp, block: string): string | undefined {
  return pattern.exec(block)?.[1]
}

/**
 * The company's own name, off the page `<title>` ("Thinking Machines Data
 * Science"). Falls back to the slug, which is what the other slug-keyed ATS
 * adapters use, when the page does not have one.
 */
export function freshteamCompanyName(html: string, slug: string): string {
  return text(firstMatch(PAGE_TITLE, html)) ?? slug
}

/**
 * `location-info` holds the place and the employment type separated by a
 * `<br />`. Only the first line is a location; "Full Time" is not one.
 */
export function freshteamLocation(block: string): string | undefined {
  const raw = firstMatch(LOCATION_INFO, block)
  if (!raw) return undefined
  return text(raw.split(/<br\s*\/?>/i)[0])
}

/**
 * The board's own wording, only when it actually says remote. Freshteam has no
 * work-type field on the listing page, so a location that does not mention
 * remote is left unstated rather than called onsite.
 */
function workTypeHint(location: string | undefined): string | undefined {
  return location && /remote/i.test(location) ? "remote" : undefined
}

/**
 * Maps one `<li class="heading">` block. Returns null when the block has no
 * link or no title — a posting without those cannot become a job, and a
 * template change should thin the list rather than crash the run.
 *
 * The `{uniqueId}` out of `/jobs/{uniqueId}/{titleSlug}` is the external id:
 * it is Freshteam's own stable handle for the posting and the part of the URL
 * that does not move when a title is edited.
 */
export function mapFreshteamBlock(
  block: string,
  slug: string,
  companyName: string
): RawPosting | null {
  const href = firstMatch(JOB_HREF, block)
  const title = text(firstMatch(JOB_TITLE, block))
  if (!href || !title) return null

  const externalId = href.split("/").filter(Boolean)[1]
  if (!externalId) return null

  const location = freshteamLocation(block)

  return {
    provider: FRESHTEAM_PROVIDER_ID,
    externalId,
    title,
    companyName,
    url: `https://${slug}.freshteam.com${href}`,
    location,
    workTypeHint: workTypeHint(location),
    // The listing page carries neither a body nor a date; see the module note.
    raw: { href, title, location },
  }
}

/**
 * Pulls the matching postings out of one board page, or null when the page has
 * no posting blocks at all — that is a template change or a board that is not
 * there, and both should be logged rather than reported as "no openings".
 */
export function parseFreshteamPage(
  html: string,
  slug: string,
  query: DiscoveryQuery
): RawPosting[] | null {
  const companyName = freshteamCompanyName(html, slug)
  const tokens = queryTokens(query)

  // A global regex carries lastIndex between calls, so it is reset per page.
  JOB_BLOCK.lastIndex = 0
  const postings: RawPosting[] = []
  let blocks = 0
  let match: RegExpExecArray | null
  while ((match = JOB_BLOCK.exec(html)) !== null) {
    const block = match[1]
    if (!block) continue
    blocks += 1
    const mapped = mapFreshteamBlock(block, slug, companyName)
    if (!mapped) continue
    if (!matchesQuery(tokens, [mapped.title])) continue
    postings.push(mapped)
  }

  return blocks === 0 ? null : postings
}

/** One company's board. Never rejects: a bad slug must not take the others down. */
async function searchBoard(
  slug: string,
  query: DiscoveryQuery,
  signal: AbortSignal
): Promise<RawPosting[]> {
  if (!SAFE_SLUG.test(slug)) return []

  try {
    const boardUrl = freshteamBoardUrl(slug)
    const response = await fetchMemoized(
      boardUrl,
      {
        signal,
        cache: "no-store",
        headers: { accept: "text/html", "user-agent": USER_AGENT },
      },
      boardUrl,
      ADAPTER_FETCH_BUDGET_MS
    )

    if (!response.ok) {
      log.warn("Freshteam board returned a non-OK status", { status: response.status, slug })
      return []
    }

    const postings = parseFreshteamPage(response.text, slug, query)
    if (postings === null) {
      log.warn("Freshteam board page had no posting blocks", { slug })
      return []
    }

    return postings
  } catch (err) {
    // Includes the AbortError from the caller's timeout. A dead board costs the
    // user that company's openings, never an error screen.
    log.warn("Freshteam board search failed", { err, slug })
    return []
  }
}

export const freshteamAdapter: SourceAdapter = {
  id: FRESHTEAM_PROVIDER_ID,
  label: providerLabel(FRESHTEAM_PROVIDER_ID),

  isConfigured: (context) => context.atsWatchlist.freshteam.length > 0,

  async search(query, signal, context) {
    if (queryTokens(query).length === 0) return []

    const boards = await Promise.all(
      context.atsWatchlist.freshteam.map((slug) => searchBoard(slug, query, signal))
    )

    return boards.flat().slice(0, FRESHTEAM_RESULT_LIMIT)
  },
}
