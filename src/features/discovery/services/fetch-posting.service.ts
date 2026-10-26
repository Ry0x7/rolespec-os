import { logger } from "@/shared/lib/logger"
import { normalizeUrl } from "@/shared/lib/url"

import { fetchAtsPosting, recognizeAtsPostingUrl } from "./ats-posting.service"
import { canonicalizeUrl, normalizePosting, stripHtml } from "./normalize.service"
import type { NormalizedPosting, RawPosting } from "../types"

/**
 * "Add by URL": one public posting page → the same `RawPosting → normalize`
 * pipeline every source adapter feeds.
 *
 * This is the only place in discovery that fetches an arbitrary user-supplied
 * URL, so it carries the guards an adapter does not need: a scheme/host
 * allowlist (SSRF), a response-size cap, and a hard stop on anything that is
 * not an HTML success. There are no retries — a 403, a 429 or a challenge page
 * is a stop, not something to push against.
 *
 * No AI runs here and nothing is persisted. The page's text becomes posting
 * text only; it is never read as evidence of the user's qualifications.
 */

const log = logger("discovery")

/** Stored on saved jobs as `sourceProvider`. */
export const WEB_PROVIDER_ID = "web"

/** Same ceiling one adapter run gets. */
export const POSTING_FETCH_TIMEOUT_MS = 10_000

/** A job page is tens of KB; past this it is not a posting we should be reading. */
export const MAX_POSTING_BYTES = 2 * 1024 * 1024

/** Matches the caps `saveDiscoveredJobSchema` will enforce on the way back in. */
const MAX_EXTERNAL_ID_LENGTH = 200
const MAX_URL_LENGTH = 2000

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

/**
 * Which extractor produced the fields, so the UI can be honest about it.
 * `ats-api` means the posting came from the ATS's own public API rather than
 * from the page, which is the only method that does not depend on what a
 * client-rendered page happened to ship in its HTML.
 */
export type ExtractionMethod = "ats-api" | "json-ld" | "title-pattern" | "meta-fallback"

/** Why a fetch produced nothing. One code per thing the user can act on. */
export type PostingFetchFailureReason =
  | "invalid-url"
  | "blocked-host"
  | "blocked"
  | "not-found"
  | "unavailable"
  | "not-html"
  | "too-large"
  | "timeout"
  | "network"
  | "no-posting"

export interface PostingFetchSuccess {
  ok: true
  posting: NormalizedPosting
  extractionMethod: ExtractionMethod
}

export interface PostingFetchFailure {
  ok: false
  reason: PostingFetchFailureReason
  /** Copy safe to show the user; never contains the upstream response body. */
  message: string
}

export type PostingFetchResult = PostingFetchSuccess | PostingFetchFailure

const FAILURE_MESSAGES: Record<PostingFetchFailureReason, string> = {
  "invalid-url": "That is not a valid http(s) posting URL.",
  "blocked-host": "That host is not reachable from RoleSpec.",
  blocked: "The page refused automated access.",
  "not-found": "That page no longer exists.",
  unavailable: "The page could not be loaded right now.",
  "not-html": "That link is not an HTML page.",
  "too-large": "That page is too large to read.",
  timeout: "The page took too long to respond.",
  network: "The page could not be reached.",
  "no-posting": "No job posting could be read from that page.",
}

function fail(reason: PostingFetchFailureReason): PostingFetchFailure {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason] }
}

/**
 * Hostnames RoleSpec must never fetch on a user's behalf.
 *
 * Every IP literal is refused rather than only the private ranges: a public
 * posting is served from a name, so nothing legitimate is lost, and it removes
 * the need to enumerate every reserved block correctly.
 *
 * Residual risk, accepted deliberately: this checks the hostname, not the
 * address the resolver later returns. A name that resolves to a private
 * address (DNS rebinding, or an internal split-horizon record) still gets
 * fetched. Closing that needs a resolve-then-pin fetch, which needs a
 * dependency or a custom agent; it is out of scope here.
 */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  if (!host) return true

  // Bracketed IPv6, e.g. "[::1]" — `URL.hostname` keeps the brackets.
  if (host.startsWith("[")) return true
  // Bare IPv6 or IPv4 literal.
  if (host.includes(":")) return true
  if (/^\d+(\.\d+)*$/.test(host)) return true
  // Decimal/hex/octal one-word forms of an IPv4 address ("2130706433", "0x7f.1").
  if (/^(0x)?[0-9a-f]+$/.test(host) && !/[a-z]/.test(host.replace(/^0x/, ""))) return true

  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (host === "localhost.localdomain") return true
  // Names that only resolve inside a network: mDNS, and hostnames with no dot.
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
    return true
  }
  if (!host.includes(".")) return true

  return false
}

/** Any `scheme://` that is not http(s). */
const OTHER_SCHEME_WITH_AUTHORITY = /^(?!https?:)[a-z][a-z0-9+.-]*:\/\//i
/** Schemes that carry no authority at all, so the `//` test cannot catch them. */
const OPAQUE_SCHEME = /^(javascript|data|mailto|file|blob|vbscript|about|view-source):/i

/**
 * Validates the user's URL and returns the fetchable form, or a typed failure.
 * Exported for the action, which wants to refuse before spending a request.
 */
export function parsePostingUrl(raw: string): { url: URL } | PostingFetchFailure {
  const trimmed = (raw ?? "").trim()
  // `normalizeUrl` prefixes anything without an http(s) scheme, which would
  // turn "ftp://host/x" into a URL whose host is "ftp". Refuse a stated
  // non-http(s) scheme before that happens.
  if (OTHER_SCHEME_WITH_AUTHORITY.test(trimmed) || OPAQUE_SCHEME.test(trimmed)) {
    return fail("invalid-url")
  }

  const withProtocol = normalizeUrl(trimmed)
  if (!withProtocol || withProtocol.length > MAX_URL_LENGTH) return fail("invalid-url")

  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    return fail("invalid-url")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return fail("invalid-url")
  if (url.username || url.password) return fail("invalid-url")
  if (isBlockedHost(url.hostname)) return fail("blocked-host")

  return { url }
}

/** Maps a non-OK status onto something the user can act on. */
function reasonForStatus(status: number): PostingFetchFailureReason {
  if (status === 401 || status === 403 || status === 429 || status === 451) return "blocked"
  if (status === 404 || status === 410) return "not-found"
  return "unavailable"
}

/**
 * Reads the body up to `MAX_POSTING_BYTES` and cancels past it. Streams when
 * the runtime gives a body; falls back to `text()` (still capped) so a
 * response without one is not a special case.
 */
export async function readCapped(response: Response): Promise<string | PostingFetchFailure> {
  const declared = Number(response.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > MAX_POSTING_BYTES) return fail("too-large")

  const body = response.body
  if (!body || typeof body.getReader !== "function") {
    const text = await response.text()
    // A char is at least one byte, so this cannot under-count the payload.
    if (text.length > MAX_POSTING_BYTES) return fail("too-large")
    return text
  }

  const reader = body.getReader()
  const decoder = new TextDecoder("utf-8")
  let size = 0
  let text = ""

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > MAX_POSTING_BYTES) {
        await reader.cancel().catch(() => {})
        return fail("too-large")
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock?.()
  }

  return text + decoder.decode()
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const cleaned = stripHtml(value).replace(/\s+/g, " ").trim()
    return cleaned || undefined
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/**
 * Whitespace-collapsed, case-insensitive equality. Used only to reject a
 * company that is the job title said twice — a page title split or an
 * `og:site_name` can hand back the same phrase for both fields, and saving it
 * names the employer after the role forever. Strict equality: a company that
 * merely shares words with the title is still a real employer name.
 */
function sameText(a: string | undefined, b: string | undefined): boolean {
  const left = asText(a)?.toLowerCase()
  const right = asText(b)?.toLowerCase()
  return Boolean(left && right && left === right)
}

function firstOf(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

export function typesOf(node: Record<string, unknown>): string[] {
  const type = node["@type"]
  if (typeof type === "string") return [type]
  if (Array.isArray(type)) return type.filter((entry): entry is string => typeof entry === "string")
  return []
}

/**
 * Walks one parsed JSON-LD block for a `JobPosting`, following arrays and
 * `@graph` (both of which real boards use) one level at a time.
 */
function findJobPosting(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5 || !value) return null

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findJobPosting(entry, depth + 1)
      if (found) return found
    }
    return null
  }

  if (typeof value !== "object") return null
  const node = value as Record<string, unknown>
  if (typesOf(node).includes("JobPosting")) return node

  return findJobPosting(node["@graph"], depth + 1)
}

/** `jobLocation` is a Place (or a list of them) with a postal address inside. */
function jobLocationText(value: unknown): string | undefined {
  const place = firstOf(value)
  if (!place) return undefined
  if (typeof place === "string") return asText(place)
  if (typeof place !== "object") return undefined

  const node = place as Record<string, unknown>
  const address = firstOf(node.address)
  if (typeof address === "string") return asText(address)
  if (!address || typeof address !== "object") return asText(node.name)

  const parts = address as Record<string, unknown>
  const text = [parts.addressLocality, parts.addressRegion, parts.addressCountry]
    .map((part) => asText(part))
    .filter(Boolean)
    .join(", ")
  return text || asText(parts.streetAddress) || asText(node.name)
}

/** `baseSalary` is a MonetaryAmount; kept as free text, never parsed to a number. */
function baseSalaryText(value: unknown): string | undefined {
  const node = firstOf(value)
  if (!node) return undefined
  if (typeof node === "string" || typeof node === "number") return asText(node)
  if (typeof node !== "object") return undefined

  const salary = node as Record<string, unknown>
  const currency = asText(salary.currency) ?? ""
  const amount = firstOf(salary.value)
  if (typeof amount === "string" || typeof amount === "number") {
    return [asText(amount), currency].filter(Boolean).join(" ") || undefined
  }
  if (!amount || typeof amount !== "object") return undefined

  const spec = amount as Record<string, unknown>
  const min = asText(spec.minValue)
  const max = asText(spec.maxValue)
  const single = asText(spec.value)
  const range = min && max ? `${min} - ${max}` : (min ?? max ?? single)
  if (!range) return undefined

  const unit = asText(spec.unitText)
  return [range, currency, unit ? `per ${unit.toLowerCase()}` : ""].filter(Boolean).join(" ")
}

/**
 * A remote posting is marked with `jobLocationType: "TELECOMMUTE"`;
 * `employmentType` ("FULL_TIME") never means remote, so it is only appended as
 * a hint `parseWorkType` is free to ignore.
 */
function workTypeHint(node: Record<string, unknown>): string | undefined {
  const locationType = asText(firstOf(node.jobLocationType))
  if (locationType && locationType.toUpperCase().includes("TELECOMMUTE")) return "remote"
  return asText(firstOf(node.employmentType))
}

const LD_JSON_BLOCK = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi

/** Every parseable JSON-LD block on the page, in document order. */
export function parseJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = []
  for (const match of html.matchAll(LD_JSON_BLOCK)) {
    const body = (match[1] ?? "")
      .replace(/^\s*<!\[CDATA\[/, "")
      .replace(/\]\]>\s*$/, "")
      .trim()
    if (!body) continue
    try {
      blocks.push(JSON.parse(body))
    } catch {
      // A board with one malformed block may still have a good one after it.
      continue
    }
  }
  return blocks
}

const META_TAG = /<meta\b[^>]*>/gi
const ATTR = (name: string) => new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i")

function attrValue(tag: string, name: string): string | undefined {
  const match = tag.match(ATTR(name))
  if (!match) return undefined
  return match[2] ?? match[3] ?? match[4]
}

/** First `<meta>` whose name/property matches one of `keys`, in page order. */
function metaContent(html: string, keys: string[]): string | undefined {
  const wanted = keys.map((key) => key.toLowerCase())
  for (const match of html.matchAll(META_TAG)) {
    const tag = match[0]
    const key = (attrValue(tag, "property") ?? attrValue(tag, "name") ?? "").toLowerCase()
    if (!key || !wanted.includes(key)) continue
    const content = asText(attrValue(tag, "content"))
    if (content) return content
  }
  return undefined
}

function documentTitle(html: string): string | undefined {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  return asText(match?.[1])
}

/**
 * The two page-title shapes that state the company unambiguously.
 *
 * Greenhouse's job pages carry no JSON-LD and no `og:site_name`, so the generic
 * fallback names the company after the host ("job-boards.greenhouse.io"). Their
 * `<title>` is exactly "Job Application for {title} at {company}", which is a
 * contract rather than a guess. Both patterns split on the *last* " at ", so a
 * job title containing "at" stays intact.
 *
 * Nothing fuzzier belongs here: a title that does not match one of these two
 * shapes falls through to the honest, hostname-named fallback.
 */
const TITLE_PATTERNS = [
  /^job application for\s+(.+)\s+at\s+(.+)$/i,
  // Only a single " at ", so "Staff Engineer at Acme" matches while
  // "Engineer at Acme at Berlin" does not.
  /^(?!.*\s+at\s+.*\s+at\s+)(.+)\s+at\s+(.+)$/i,
]

interface TitlePatternParts {
  title: string
  companyName: string
}

/** `{title}` and `{company}` off a page title, or null when it does not match. */
export function parseTitlePattern(pageTitle: string | undefined): TitlePatternParts | null {
  const value = pageTitle?.replace(/\s+/g, " ").trim()
  if (!value) return null

  for (const pattern of TITLE_PATTERNS) {
    const match = value.match(pattern)
    if (!match) continue

    const title = match[1]?.trim()
    // Boards append a site suffix ("… at GitLab - Careers"); the company is
    // what precedes it. Only a spaced hyphen counts, so "Foo-Bar" survives.
    const companyName = match[2]?.replace(/\s+-\s+.*$/, "").trim()
    if (!title || !companyName || title.length < 2 || companyName.length < 2) continue

    return { title, companyName }
  }

  return null
}

/**
 * Everything below JSON-LD, in order: the two title patterns above, then the
 * deliberately dumb path — title, the URL's host as the company, and whatever
 * the description meta says. The dumb path is honest about being a guess rather
 * than trying to reverse-engineer a layout, and the method it reports says
 * which of the two produced the fields.
 */
function extractFallback(
  html: string,
  url: URL
): { raw: RawPosting; method: ExtractionMethod } | null {
  const ogTitle = metaContent(html, ["og:title", "twitter:title"])
  const pageTitle = documentTitle(html)

  const description = metaContent(html, ["description", "og:description"])
  const base = {
    provider: WEB_PROVIDER_ID,
    externalId: externalIdFor(url.toString()),
    url: url.toString(),
    description,
  }

  // A pattern match that named the company after the role has not stated an
  // employer at all; dropping it lets the next candidate, then the meta
  // fallback below, answer instead.
  const stated = (parts: TitlePatternParts | null): TitlePatternParts | null =>
    parts && sameText(parts.title, parts.companyName) ? null : parts

  // The document title states the company more often than `og:title` does.
  const parsed = stated(parseTitlePattern(pageTitle)) ?? stated(parseTitlePattern(ogTitle))
  if (parsed) {
    return {
      raw: { ...base, ...parsed, raw: { extractionMethod: "title-pattern", pageTitle, ogTitle } },
      method: "title-pattern",
    }
  }

  const title = ogTitle ?? pageTitle
  if (!title) return null

  const siteName = metaContent(html, ["og:site_name", "application-name", "author"])
  const hostName = url.hostname.replace(/^www\./, "")
  const cleanTitle = cleanMetaTitle(title, siteName, url)
  // Final guard: the employer is never the role's own name. A self-naming
  // `og:site_name` is discarded for the host, and a host that says the same is
  // left blank — `normalizePosting` then declines the posting rather than
  // filing the title as the company.
  let companyName = siteName ?? hostName
  if (sameText(companyName, cleanTitle)) {
    companyName = sameText(hostName, cleanTitle) ? "" : hostName
  }

  return {
    raw: {
      ...base,
      title: cleanTitle,
      companyName,
      raw: { extractionMethod: "meta-fallback" },
    },
    method: "meta-fallback",
  }
}

/** The separators a site chrome-decorated page title is assembled from. */
const TITLE_SEPARATOR = /\s+[—–|·]\s+|\s+-\s+/

/** Segments that are the page's furniture rather than the role's name. */
const CHROME_SEGMENT = /^(?:careers?|jobs?|open positions?|job openings?|we're hiring|hiring)$/i

/**
 * Strips site chrome off a `<title>` on the meta-fallback path only.
 *
 * The fallback exists because the page said nothing structured, so its title is
 * all there is — and on a real board that title is the role wrapped in the
 * company's furniture ("Mozilla Careers — Staff Data Scientist, Ads — Open
 * Positions"). Splitting on the separators and dropping the segments that name
 * the site or say "Careers" leaves the role.
 *
 * Deliberately conservative: if every segment looks like chrome, the original
 * title is kept. A wrong-but-complete title is better than an empty one, and
 * this never runs on the JSON-LD or title-pattern paths, which already know the
 * title exactly.
 */
function cleanMetaTitle(title: string, siteName: string | undefined, url: URL): string {
  const segments = title
    .split(TITLE_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (segments.length < 2) return title

  // "www.mozilla.org" → "mozilla": every label but the TLD is a brand token.
  const brandTokens = url.hostname.toLowerCase().replace(/^www\./, "").split(".").slice(0, -1)
  const dropped = new Set([siteName?.toLowerCase(), ...brandTokens].filter(Boolean))

  const kept = segments.filter(
    (segment) => !dropped.has(segment.toLowerCase()) && !CHROME_SEGMENT.test(segment)
  )
  if (kept.length === 0) return title

  // The role is the longest thing left — chrome is short, job titles are not.
  return kept.reduce((longest, segment) => (segment.length > longest.length ? segment : longest))
}

/**
 * One `JobPosting` JSON-LD node → the `RawPosting` shape every adapter feeds.
 *
 * `url` is passed in rather than read off the node so the caller decides which
 * URL this posting is filed under: the single-posting path files it under the
 * page it fetched, a listing page files each node under its own `url`.
 * Returns null when the node lacks the two fields a posting cannot exist
 * without, which is the signal to keep looking at the next node.
 */
export function jobPostingToRaw(node: Record<string, unknown>, url: URL): RawPosting | null {
  const title = asText(node.title) ?? asText(node.name)
  const organization = firstOf(node.hiringOrganization)
  const companyName =
    typeof organization === "string"
      ? asText(organization)
      : organization && typeof organization === "object"
        ? asText((organization as Record<string, unknown>).name)
        : undefined
  if (!title || !companyName) return null

  return {
    provider: WEB_PROVIDER_ID,
    externalId: externalIdFor(url.toString()),
    title,
    companyName,
    url: url.toString(),
    location: jobLocationText(node.jobLocation),
    workTypeHint: workTypeHint(node),
    salaryText: baseSalaryText(node.baseSalary),
    // Still HTML — `normalizePosting` strips and caps it.
    description: typeof node.description === "string" ? node.description : undefined,
    postedAt: asText(node.datePosted),
    raw: node,
  }
}

function extractJsonLd(html: string, url: URL): RawPosting | null {
  for (const block of parseJsonLdBlocks(html)) {
    const node = findJobPosting(block)
    if (!node) continue

    const raw = jobPostingToRaw(node, url)
    if (raw) return raw
  }
  return null
}

/** The canonical URL is this provider's posting id; capped to the save schema. */
function externalIdFor(url: string): string {
  return (canonicalizeUrl(url) || url).slice(0, MAX_EXTERNAL_ID_LENGTH)
}

const HTML_CONTENT_TYPES = ["text/html", "application/xhtml+xml"]

/**
 * Firecrawl fallback for add-by-URL: when the direct fetch is blocked or the
 * page is client-rendered with no readable posting, try the Firecrawl scrape
 * API (markdown first). Null when unconfigured or when the scrape produced
 * nothing mappable — the caller then returns the original failure. No AI.
 */
async function tryFirecrawlFallback(
  rawUrl: string,
  signal: AbortSignal
): Promise<PostingFetchResult | null> {
  try {
    const { firecrawlScrape } = await import("./firecrawl.client");
    const text = await firecrawlScrape(rawUrl, signal);
    if (!text) return null;
    const parsed = parsePostingUrl(rawUrl);
    if ("ok" in parsed) return null;
    const result = extractPostingFromHtml(text, parsed.url);
    if (!result.ok) return null;
    log.info("Add by URL: Firecrawl fallback produced a posting", {
      extractionMethod: result.extractionMethod,
    });
    return result;
  } catch {
    return null;
  }
}

/**
 * Fetches one public posting and runs it through `normalizePosting`.
 *
 * A URL that is recognisably a Greenhouse, Lever or Ashby posting is read from
 * that ATS's public API first: those pages are client-rendered, so their HTML
 * carries a title and almost no body. Anything short of a usable posting there
 * — an unknown id, a shape change, a slow or dead endpoint — falls through
 * silently to the page fetch below, which is exactly what used to happen.
 *
 * Otherwise: one plain GET, no retry and no second request. If the response is
 * not an HTML success, the caller gets a typed failure and the user gets told to
 * use the extension instead.
 */
export async function fetchPostingFromUrl(
  rawUrl: string,
  signal: AbortSignal
): Promise<PostingFetchResult> {
  // One debug line per invocation. The remote hops dominate this function, and
  // without per-hop numbers a slow posting host reads as a slow product.
  const startedAt = Date.now()
  const marks: Record<string, number> = {}
  let lastMark = startedAt
  const mark = (name: string) => {
    const now = Date.now()
    marks[name] = now - lastMark
    lastMark = now
  }

  const page = await fetchPostingPage(rawUrl, signal, mark)
  if (!page.ok) {
    const fallback = await tryFirecrawlFallback(rawUrl, signal)
    if (fallback) return fallback
    return page
  }

  if (page.kind === "ats-api") {
    log.debug("fetchPostingFromUrl timing", {
      ...marks,
      totalMs: Date.now() - startedAt,
      extractionMethod: "ats-api",
    })
    return { ok: true, posting: page.posting, extractionMethod: "ats-api" }
  }

  const result = extractPostingFromHtml(page.html, page.finalUrl)
  if (!result.ok) {
    const fallback = await tryFirecrawlFallback(rawUrl, signal)
    if (fallback) return fallback
    return result
  }
  mark("extractionMs")
  log.debug("fetchPostingFromUrl timing", {
    ...marks,
    totalMs: Date.now() - startedAt,
    extractionMethod: result.extractionMethod,
    htmlBytes: page.html.length,
  })

  return result
}

/**
 * What one add-by-URL request got hold of, before anything is read out of it.
 *
 * Split out of `fetchPostingFromUrl` so a caller that needs the page itself —
 * the careers-listing path, which has to decide whether this is one posting or
 * an index of them — can look at the HTML without fetching it a second time.
 */
export type PostingPageResult =
  | { ok: true; kind: "ats-api"; posting: NormalizedPosting }
  | { ok: true; kind: "html"; html: string; finalUrl: URL }
  | PostingFetchFailure

/**
 * The fetch half of "Add by URL": guards, the ATS API shortcut, then the page.
 *
 * A URL that is recognisably a Greenhouse, Lever or Ashby posting is read from
 * that ATS's public API first: those pages are client-rendered, so their HTML
 * carries a title and almost no body. Anything short of a usable posting there
 * — an unknown id, a shape change, a slow or dead endpoint — falls through
 * silently to the page fetch, which is exactly what used to happen.
 */
export async function fetchPostingPage(
  rawUrl: string,
  signal: AbortSignal,
  mark: (name: string) => void = () => {}
): Promise<PostingPageResult> {
  const parsed = parsePostingUrl(rawUrl)
  if ("ok" in parsed) return parsed
  const { url } = parsed

  const atsRef = recognizeAtsPostingUrl(url)
  if (atsRef) {
    const atsRaw = await fetchAtsPosting(atsRef, signal)
    const atsPosting = atsRaw ? normalizePosting(atsRaw) : null
    mark("atsAttemptMs")
    if (atsPosting) return { ok: true, kind: "ats-api", posting: atsPosting }
    log.info("ATS API produced no posting; falling back to the page", {
      provider: atsRef.provider,
      slug: atsRef.slug,
    })
  }

  const fetched = await fetchGuardedHtml(url, signal, mark)
  if ("ok" in fetched) return fetched
  return { ok: true, kind: "html", html: fetched.html, finalUrl: fetched.finalUrl }
}

/**
 * One guarded GET that yields HTML, or a typed failure.
 *
 * Composes the SSRF-guarded redirect walk with the content-type check and the
 * size-capped body read, so every caller that fetches an arbitrary user-supplied
 * page gets the same guards without reimplementing them.
 */
export async function fetchGuardedHtml(
  url: URL,
  signal: AbortSignal,
  mark: (name: string) => void = () => {}
): Promise<{ html: string; finalUrl: URL } | PostingFetchFailure> {
  const fetched = await fetchFollowingGuardedRedirects(url, signal, mark)
  if ("ok" in fetched) return fetched
  const { response, finalUrl } = fetched

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase()
  // An empty content-type is allowed through; anything that names a non-HTML
  // type (a PDF, JSON, an image) is refused before the body is read.
  if (contentType && !HTML_CONTENT_TYPES.some((type) => contentType.includes(type))) {
    return fail("not-html")
  }

  let html: string
  try {
    const body = await readCapped(response)
    mark("bodyReadMs")
    if (typeof body !== "string") return body
    html = body
  } catch (err) {
    log.warn("Add by URL: reading the body failed", { err, host: url.hostname })
    return fail(signal.aborted ? "timeout" : "network")
  }

  if (!/<[a-z!/]/i.test(html)) return fail("not-html")

  return { html, finalUrl }
}

/**
 * The extraction half: JSON-LD, then the two title patterns, then the honest
 * hostname-named fallback. Pure — it never fetches.
 */
export function extractPostingFromHtml(html: string, finalUrl: URL): PostingFetchResult {
  let extractionMethod: ExtractionMethod = "json-ld"
  let raw = extractJsonLd(html, finalUrl)
  if (!raw) {
    const fallback = extractFallback(html, finalUrl)
    if (!fallback) return fail("no-posting")
    raw = fallback.raw
    extractionMethod = fallback.method
  }

  const posting = normalizePosting(raw)
  if (!posting) return fail("no-posting")

  return { ok: true, posting, extractionMethod }
}

/** How many hops a posting URL may take before it stops looking like one. */
const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Follows redirects by hand so every hop goes through `parsePostingUrl`.
 *
 * `redirect: "follow"` would let a public hostname bounce the request to
 * `http://127.0.0.1/...` after the guard had already passed, which is the whole
 * shape of an SSRF. Each `Location` is validated before it is requested.
 */
export async function fetchFollowingGuardedRedirects(
  start: URL,
  signal: AbortSignal,
  /** Records one duration per hop, for the caller's debug timing line. */
  mark: (name: string) => void = () => {}
): Promise<{ response: Response; finalUrl: URL } | PostingFetchFailure> {
  let current = start

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response
    try {
      response = await fetch(current, {
        signal,
        cache: "no-store",
        redirect: "manual",
        headers: { accept: "text/html", "user-agent": USER_AGENT },
      })
      mark(`hop${hop}Ms`)
    } catch (err) {
      log.warn("Add by URL: the request failed", { err, host: current.hostname })
      return fail(signal.aborted ? "timeout" : "network")
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location")
      // Nothing in a redirect body is wanted; release it before the next hop.
      await response.body?.cancel().catch(() => {})
      if (!location) return fail("unavailable")

      let next: string
      try {
        next = new URL(location, current).toString()
      } catch {
        return fail("invalid-url")
      }

      const parsed = parsePostingUrl(next)
      if ("ok" in parsed) return parsed
      current = parsed.url
      continue
    }

    if (!response.ok) {
      log.warn("Add by URL: non-OK response", {
        status: response.status,
        host: current.hostname,
      })
      return fail(reasonForStatus(response.status))
    }

    return { response, finalUrl: current }
  }

  return fail("unavailable")
}
