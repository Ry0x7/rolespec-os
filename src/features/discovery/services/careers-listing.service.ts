import { parseJsonLdBlocks, typesOf } from "./fetch-posting.service"
import { canonicalizeUrl } from "./normalize.service"

/**
 * Careers *index* pages, told apart from single postings.
 *
 * A company careers page is the URL a user actually has to hand, and until now
 * pasting one produced exactly one bogus candidate: the meta fallback reads the
 * `<title>` ("Careers") and the host as the company, and reports success. This
 * module is the detector that stops that — it decides whether a fetched page is
 * one posting or an index of them, and if it is an index, which links on it are
 * individual postings worth fetching.
 *
 * Everything here is pure: HTML in, strings out. No fetching, no AI, nothing
 * persisted, and none of this text is ever read as evidence about the user.
 *
 * Parsing is regex-based, matching the rest of discovery — there is no HTML
 * parser in this repo and one careers index does not justify adding one. The
 * cost is that link extraction is a judgement, not a guarantee: it is tuned to
 * be quiet rather than complete, because a false positive spends a real network
 * request and puts a junk row in front of the user.
 */

/** Never fetch or return more links than this off one page. */
export const MAX_JOB_LINKS = 40

/** `<a …>` open tags with an href, in any of the three quoting styles. */
const ANCHOR_TAG = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>/gi

/** Schemes an anchor can carry that are never a posting page. */
const NON_FETCHABLE_HREF = /^(?:mailto|tel|javascript|data|sms|file|blob|about):/i

/**
 * Path segments that name a *group* of postings rather than one.
 *
 * These are the links that look most like a posting to the rule below and are
 * not one: a department index sits at `/careers/engineering`, which has the same
 * shape as a posting at `/careers/some-slug`.
 */
const CATEGORY_SEGMENTS = new Set([
  "department",
  "departments",
  "location",
  "locations",
  "team",
  "teams",
  "category",
  "categories",
  "function",
  "functions",
  "search",
  "all",
  "saved-jobs",
  "alerts",
  "apply",
  "login",
  "signup",
  "rss",
  "xml",
  "feed",
])

/** Query keys that mean "another page of the same index". */
const PAGINATION_PARAMS = ["page", "offset", "start", "from", "p"]

/** The nouns a careers site puts in front of an individual posting. */
const POSTING_SEGMENT = /^(?:jobs?|careers?|positions?|openings?|vacanc(?:y|ies)|opportunit(?:y|ies)|roles?)$/i

/**
 * Tokens that read as an identifier rather than a word.
 *
 * Three shapes, each one something no English word is:
 * - a run of three or more digits (`/careers/position/gh/7137777/`, Canva's
 *   `6000000001400037`);
 * - a mixed-case 6+ character handle (Freshteam's `hlJrAwsfhoF2`);
 * - an unbroken 8+ character mix of letters and digits (`a7f3c9e1b2`) — the
 *   hyphen/underscore exclusion is what keeps a real word-slug out.
 *
 * Deliberately NOT "any 6+ character slug": that would keep
 * `/en/jobs/saved-jobs/`, which is an index, not a posting.
 */
function isIdLike(segment: string): boolean {
  if (/\d{3,}/.test(segment)) return true
  if (segment.length >= 6 && /[a-z]/.test(segment) && /[A-Z]/.test(segment)) return true
  return (
    segment.length >= 8 &&
    !/[-_]/.test(segment) &&
    /[a-zA-Z]/.test(segment) &&
    /\d/.test(segment)
  )
}

/**
 * Hosts that only ever serve someone's job board, with the path shape their
 * individual postings take. A careers page that links out to its ATS is the
 * common case (Kumu → BambooHR, Globe → Workday), so those links are kept even
 * though the host is not the company's own.
 *
 * A short judgement list, not a registry — the same standing rule as
 * `ATS_HOSTS` elsewhere in discovery.
 */
const ATS_POSTING_PATTERNS: { host: RegExp; path: RegExp }[] = [
  { host: /^(?:job-boards|boards)\.greenhouse\.io$/i, path: /^\/[^/]+\/jobs\/\d+/i },
  { host: /^jobs\.lever\.co$/i, path: /^\/[^/]+\/[^/]+/i },
  { host: /^jobs\.ashbyhq\.com$/i, path: /^\/[^/]+\/[^/]+/i },
  { host: /(?:^|\.)bamboohr\.com$/i, path: /^\/careers\/\d+/i },
  { host: /(?:^|\.)freshteam\.com$/i, path: /^\/jobs\/[^/]+\/[^/]+/i },
  { host: /(?:^|\.)myworkdayjobs\.com$/i, path: /\/job\/[^/]+\/[^/]+/i },
  { host: /^apply\.workable\.com$/i, path: /^\/[^/]+\/j\/[^/]+/i },
  { host: /(?:^|\.)smartrecruiters\.com$/i, path: /^\/[^/]+\/\d+/i },
  { host: /(?:^|\.)recruitee\.com$/i, path: /^\/o\/[^/]+/i },
  { host: /(?:^|\.)teamtailor\.com$/i, path: /^\/jobs\/[^/]+/i },
]

function isAtsPostingUrl(url: URL): boolean {
  return ATS_POSTING_PATTERNS.some(
    (entry) => entry.host.test(url.hostname) && entry.path.test(url.pathname)
  )
}

/**
 * Same site, without a public-suffix list.
 *
 * Equal after dropping `www.`, or one is a subdomain of the other, so
 * `example.com` keeps `careers.example.com`. It is deliberately looser than a
 * registrable-domain comparison in one direction only (a shared parent domain),
 * and the posting-path rule below still has to pass.
 */
function isSameSite(a: string, b: string): boolean {
  const left = a.toLowerCase().replace(/^www\./, "")
  const right = b.toLowerCase().replace(/^www\./, "")
  if (!left || !right) return false
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean)
}

/**
 * True when the path reads as one posting: a posting noun, then either a
 * further segment (`/careers/position/gh/7137777`) or an id-like token
 * (`/jobs/hlJrAwsfhoF2/...`, `/careers/1234`).
 */
function looksLikePostingPath(pathname: string): boolean {
  const segments = pathSegments(pathname)
  for (let index = 0; index < segments.length; index += 1) {
    if (!POSTING_SEGMENT.test(segments[index] as string)) continue
    const rest = segments.slice(index + 1)
    if (rest.length === 0) continue
    if (rest.length >= 2) return true
    if (isIdLike(rest[0] as string)) return true
  }
  return false
}

/** A group of postings, another page of them, or a utility link. */
function isCategoryOrPagination(url: URL): boolean {
  if (pathSegments(url.pathname).some((segment) => CATEGORY_SEGMENTS.has(segment.toLowerCase()))) {
    return true
  }
  return PAGINATION_PARAMS.some((key) => url.searchParams.has(key))
}

/**
 * Every anchor on `html` that reads as an individual job posting.
 *
 * Kept in document order — a careers page lists its roles in the order it wants
 * them read, and the fetch budget spends itself top-down. Canonicalised and
 * deduped so the caller's already-saved check and the posting fetch agree on
 * what one posting is.
 */
export function extractJobLinks(html: string, baseUrl: string): string[] {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }

  const basePath = base.pathname.replace(/\/$/, "")
  const seen = new Set<string>()
  const links: string[] = []

  for (const match of html.matchAll(ANCHOR_TAG)) {
    if (links.length >= MAX_JOB_LINKS) break

    const href = (match[2] ?? match[3] ?? match[4] ?? "").trim()
    if (!href || href.startsWith("#")) continue
    if (NON_FETCHABLE_HREF.test(href)) continue

    let url: URL
    try {
      url = new URL(href, base)
    } catch {
      continue
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue

    // A fragment points inside a page, never at a different posting.
    url.hash = ""
    // The page linking to itself is not one of its own postings.
    if (url.hostname === base.hostname && url.pathname.replace(/\/$/, "") === basePath) continue
    if (isCategoryOrPagination(url)) continue

    const keep = isAtsPostingUrl(url)
      ? true
      : isSameSite(url.hostname, base.hostname) && looksLikePostingPath(url.pathname)
    if (!keep) continue

    const canonical = canonicalizeUrl(url.toString()) || url.toString()
    if (seen.has(canonical)) continue
    seen.add(canonical)
    links.push(canonical)
  }

  return links
}

/**
 * Every `JobPosting` node in the page's JSON-LD, in document order.
 *
 * The single-posting extractor stops at the first one, which is right for a
 * detail page and wrong for an index that ships all of its roles at once.
 * Follows arrays and `@graph` the same way, to the same depth.
 */
export function extractAllJobPostings(html: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  for (const block of parseJsonLdBlocks(html)) {
    collectJobPostings(block, 0, found)
  }
  return found
}

function collectJobPostings(value: unknown, depth: number, out: Record<string, unknown>[]): void {
  if (depth > 5 || !value) return

  if (Array.isArray(value)) {
    for (const entry of value) collectJobPostings(entry, depth + 1, out)
    return
  }

  if (typeof value !== "object") return
  const node = value as Record<string, unknown>
  if (typesOf(node).includes("JobPosting")) {
    // A posting does not contain another posting; stop rather than walk its body.
    out.push(node)
    return
  }

  collectJobPostings(node["@graph"], depth + 1, out)
}

/** How many job links a page needs before it is an index rather than a posting. */
const MIN_LISTING_LINKS = 3

export type ListingDetection =
  | { kind: "single" }
  | { kind: "listing"; links: string[]; jsonLdPostings: number }

/**
 * Is this page one posting, or an index of them?
 *
 * Two ways in, and the asymmetry is deliberate. Two or more `JobPosting` nodes
 * is an index by definition — nothing else publishes several. Exactly zero
 * plus three or more posting links is the careers page every company actually
 * has: no structured data at all, just a list of anchors.
 *
 * Exactly one `JobPosting` is always a single posting, however many links the
 * page carries, because that is the detail-page pattern (a posting page linking
 * to related roles must not turn into an index).
 */
export function detectListing({ html, url }: { html: string; url: string }): ListingDetection {
  const jsonLdPostings = extractAllJobPostings(html)
  if (jsonLdPostings.length === 1) return { kind: "single" }

  const links = extractJobLinks(html, url)
  if (jsonLdPostings.length >= 2) return { kind: "listing", links, jsonLdPostings: jsonLdPostings.length }
  if (links.length >= MIN_LISTING_LINKS) return { kind: "listing", links, jsonLdPostings: 0 }

  return { kind: "single" }
}
