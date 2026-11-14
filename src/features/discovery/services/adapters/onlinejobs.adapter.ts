import { logger } from "@/shared/lib/logger"
import { providerLabel } from "../../constants/providers"
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types"

/**
 * OnlineJobs.ph source adapter — Filipino remote workers.
 *
 * The site has no public API, so this reads the server-rendered search page at
 * `GET https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=…` (the
 * parameter name is the one on the site's own search form). Each result sits in
 * a `<!-- Start -->…<!-- End -->` block carrying a `/jobseekers/job/{slug}-{id}`
 * link, an `<h4 class="fs-16 fw-700">` title, a `data-temp` timestamp, a salary
 * `<dd>` after the dollar icon, a `<div class="desc">` snippet and, on the
 * minority of listings that have a logo, the employer name in the image `alt`.
 * Verified live on 2026-09-13: 30 blocks on one page, 5 of them with an
 * employer name.
 *
 * Parsed with targeted regex over that repeated markup rather than a DOM
 * library. The extraction is a handful of anchored patterns against a stable
 * server-rendered template, which does not justify a new dependency; if the
 * template ever needs real tree traversal, that is the point to reconsider.
 *
 * Source etiquette: `robots.txt` allows this path (only `/min/` and
 * `/jobseekers_pictures/` are disallowed) and asks for `Crawl-delay: 5`.
 * `runDiscovery` fans out several derived queries per run, so this adapter runs
 * the first query of a run and declines the rest — see `claimRun` — and refuses
 * a second request inside the crawl-delay window. One page, never paginated.
 * Everything it returns is untrusted input.
 */

const log = logger("discovery")

const ONLINEJOBS_ENDPOINT = "https://www.onlinejobs.ph/jobseekers/jobsearch"
const ONLINEJOBS_ORIGIN = "https://www.onlinejobs.ph"

/** Stored on saved jobs as `sourceProvider`. */
export const ONLINEJOBS_PROVIDER_ID = "onlinejobsph"

/** Per-query ceiling. One page, never walked. */
export const ONLINEJOBS_RESULT_LIMIT = 25

/**
 * The site exists to place Filipino workers in remote roles, so both the work
 * type and the location are known up front — the same reasoning as Remotive's
 * fixed hint. Listings do not carry a location of their own.
 */
const ONLINEJOBS_WORK_TYPE_HINT = "remote"
const ONLINEJOBS_LOCATION = "Philippines (remote)"

/**
 * Most listings hide the employer behind the site's own contact flow. A posting
 * still needs a company for the normalizer to keep it, so this says plainly that
 * there was none rather than inventing one.
 */
export const UNDISCLOSED_EMPLOYER = "Undisclosed employer"

/** The crawl delay `robots.txt` asks for. */
export const ONLINEJOBS_CRAWL_DELAY_MS = 5_000

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

const BLOCK_PATTERN = /<!-- Start -->([\s\S]*?)<!-- End -->/g
const JOB_HREF_PATTERN = /href="(\/jobseekers\/job\/[^"]+)"/
const TITLE_PATTERN = /<h4 class="fs-16 fw-700">([\s\S]*?)<\/h4>/
/** The employment-type pill the site renders inside the title heading. */
const TITLE_BADGE_PATTERN = /<span class="badge[\s\S]*?<\/span>/gi
const EMPLOYER_PATTERN = /jobpost-cat-box-logo"\s+alt="([^"]*)"/
const SALARY_PATTERN = /icon-round-dollar[\s\S]*?<dd class="col">([\s\S]*?)<\/dd>/
const POSTED_AT_PATTERN = /data-temp="(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})"/
const SNIPPET_PATTERN = /<div class="desc[^"]*">([\s\S]*?)<\/div>/
/** The "See More" link the snippet ends with; not part of the description. */
const SEE_MORE_PATTERN = /<a\b[^>]*>[\s\S]*?<\/a>\s*$/
/** The trailing numeric id in `/jobseekers/job/some-title-1548321`. */
const SLUG_ID_PATTERN = /-(\d+)$/

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&#8230;": "…",
}

/**
 * Tags out, entities decoded, whitespace collapsed. The normalizer strips HTML
 * again downstream; this runs first so the extracted title and salary are
 * comparable strings rather than markup fragments.
 */
function text(value: string | undefined): string | undefined {
  if (!value) return undefined
  return (
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#8230);/gi, (match) => ENTITIES[match] ?? match)
      .replace(/\s+/g, " ")
      .trim() || undefined
  )
}

function firstMatch(pattern: RegExp, block: string): string | undefined {
  return pattern.exec(block)?.[1]
}

/**
 * `data-temp` is Manila wall-clock time with no zone ("2026-09-13 15:04:54"),
 * so an explicit +08:00 keeps the parsed date off the server's local zone. The
 * sibling `data-temp-2` attribute is the same instant in UTC, which is what
 * confirms the offset.
 */
export function onlinejobsPostedAt(value: string | undefined): string | undefined {
  if (!value) return undefined
  return `${value.replace(" ", "T")}+08:00`
}

/**
 * Maps one result block. Returns null without a job link or a title — those are
 * the two things the block cannot be a posting without, and a template change
 * should thin the list rather than crash the run.
 */
export function mapOnlinejobsBlock(block: string): RawPosting | null {
  const path = firstMatch(JOB_HREF_PATTERN, block)
  const title = text(firstMatch(TITLE_PATTERN, block)?.replace(TITLE_BADGE_PATTERN, " "))
  if (!path || !title) return null

  // The numeric suffix is the posting id; the whole path is the fallback so two
  // postings never collapse onto one key if the slug format changes.
  const externalId = SLUG_ID_PATTERN.exec(path)?.[1] ?? path

  return {
    provider: ONLINEJOBS_PROVIDER_ID,
    externalId,
    title,
    companyName: text(firstMatch(EMPLOYER_PATTERN, block)) ?? UNDISCLOSED_EMPLOYER,
    url: `${ONLINEJOBS_ORIGIN}${path}`,
    location: ONLINEJOBS_LOCATION,
    workTypeHint: ONLINEJOBS_WORK_TYPE_HINT,
    salaryText: text(firstMatch(SALARY_PATTERN, block)),
    description: text(firstMatch(SNIPPET_PATTERN, block)?.replace(SEE_MORE_PATTERN, " ")),
    postedAt: onlinejobsPostedAt(firstMatch(POSTED_AT_PATTERN, block)),
    raw: { path },
  }
}

/**
 * Pulls every result block out of a search page. Returns null when the page
 * yields no blocks at all, which the caller reads as "the template moved"
 * rather than "no results" — the two are indistinguishable here, so both are
 * reported as an empty list.
 */
export function parseOnlinejobsPage(html: string): RawPosting[] | null {
  const postings: RawPosting[] = []
  // A global regex carries lastIndex between calls, so it is reset per page.
  BLOCK_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = BLOCK_PATTERN.exec(html)) !== null) {
    const mapped = mapOnlinejobsBlock(match[1] ?? "")
    if (mapped) postings.push(mapped)
  }
  return postings.length > 0 ? postings : null
}

/**
 * One request per discovery run, for the run's first query only.
 *
 * `runDiscovery` calls `search` once per derived query, and every call in a run
 * shares the one `AbortSignal` it created for the run's timeout — that identity
 * is the only per-run handle the adapter interface gives us. The calls are
 * issued synchronously in query order, so claiming the signal before the first
 * `await` means the run's highest-priority query wins and the rest decline.
 *
 * The timestamp gate is the backstop: if a caller ever hands out a fresh signal
 * per query, or two runs land back to back, the source is still never hit more
 * often than the crawl delay allows.
 */
let claimedRuns = new WeakSet<AbortSignal>()
let lastRequestAt = 0

/** Test seam — both are module state and would otherwise leak between cases. */
export function clearOnlinejobsRunClaims(): void {
  claimedRuns = new WeakSet<AbortSignal>()
  lastRequestAt = 0
}

function claimRun(signal: AbortSignal): boolean {
  if (claimedRuns.has(signal)) return false
  const now = Date.now()
  if (now - lastRequestAt < ONLINEJOBS_CRAWL_DELAY_MS) return false
  claimedRuns.add(signal)
  lastRequestAt = now
  return true
}

/**
 * The role only — `keywords` are deliberately dropped.
 *
 * `jobkeyword` behaves as an AND across the words it is given: probed live on
 * 2026-09-13, "Backend Developer" returned 30 blocks and "Backend Developer
 * React TypeScript Node.js" returned zero. The profile's confirmed capabilities
 * are appended to every derived query, so folding them in here would silently
 * empty this source on a real run. Kalibrr's `text` is loose and keeps them.
 */
function buildKeyword(query: DiscoveryQuery): string {
  return query.role.trim()
}

export const onlinejobsAdapter: SourceAdapter = {
  id: ONLINEJOBS_PROVIDER_ID,
  label: providerLabel(ONLINEJOBS_PROVIDER_ID),

  async search(query, signal) {
    const keyword = buildKeyword(query)
    if (!keyword) return []
    // Synchronous, before any await, so the first query of the run claims it.
    if (!claimRun(signal)) return []

    const url = new URL(ONLINEJOBS_ENDPOINT)
    url.searchParams.set("jobkeyword", keyword)

    try {
      const response = await fetch(url, {
        signal,
        cache: "no-store",
        headers: { accept: "text/html", "user-agent": USER_AGENT },
      })

      if (!response.ok) {
        log.warn("OnlineJobs.ph search returned a non-OK status", {
          status: response.status,
          keyword,
        })
        return []
      }

      const postings = parseOnlinejobsPage(await response.text())
      if (postings === null) {
        // Either the search genuinely matched nothing or the markup moved; the
        // two are indistinguishable from here.
        log.warn("OnlineJobs.ph page yielded no result blocks", { keyword })
        return []
      }

      return postings.slice(0, ONLINEJOBS_RESULT_LIMIT)
    } catch (err) {
      // Includes the AbortError from the caller's timeout. A dead source costs
      // the user an empty list, never an error screen.
      log.warn("OnlineJobs.ph search failed", { err, keyword })
      return []
    }
  },
}
