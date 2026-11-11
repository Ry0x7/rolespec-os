import { lookup as dnsLookup } from "node:dns"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import type { LookupFunction } from "node:net"

import { normalizeUrl } from "@/shared/lib/url"

/**
 * Opt-in evidence from public web sources.
 *
 * Two rules shape this module:
 *
 * 1. Nothing here runs on its own. A scan happens only after the owner presses
 *    a button and confirms the profiles are theirs.
 * 2. Nothing here is AI-generated. Every fact is copied from a public GitHub
 *    API response or from the text of the owner's own portfolio page, and is
 *    written as a CANDIDATE. The user confirms each row before it becomes
 *    career truth.
 *
 * Portfolio fetching is the only place the app makes an outbound request to a
 * user-supplied address, so it is also the only place that needs SSRF defence:
 * http(s) only, standard ports only, every DNS answer checked against private,
 * loopback, link-local and reserved ranges, redirects revalidated hop by hop,
 * an 8s timeout and a hard response-size cap.
 */

const GITHUB_API = "https://api.github.com"
const USER_AGENT = "RoleSpec-OS/1.0 (+https://rolespec.ry0x7.dev)"
const FETCH_TIMEOUT_MS = 8_000
const MAX_BYTES = 1_048_576
const MAX_REDIRECTS = 3
const MAX_GITHUB_REPOS = 12
const MAX_PORTFOLIO_PROJECTS = 8
const MAX_CAPABILITIES = 16
const TITLE_MAX = 200
const DETAILS_MAX = 5_000

export type WebSourceKind = "github" | "portfolio"

export class WebSourceError extends Error {
  constructor(
    readonly code:
      | "INVALID_URL"
      | "BLOCKED_HOST"
      | "FETCH_FAILED"
      | "TIMEOUT"
      | "TOO_LARGE"
      | "UNSUPPORTED_CONTENT"
      | "HTTP_ERROR"
      | "NOT_FOUND"
      | "RATE_LIMITED"
      | "TOO_MANY_REDIRECTS",
    message: string
  ) {
    super(message)
    this.name = "WebSourceError"
  }
}

// ─── Address safety ─────────────────────────────────────────────────────────

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".")
  if (parts.length !== 4) return null
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN
    return Number(part)
  })
  return octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ? octets
    : null
}

function isPublicIpv4Octets(octets: readonly number[]): boolean {
  const [a, b, c] = octets
  if (a === undefined || b === undefined || c === undefined) return false
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT / Tailscale
  if (a === 169 && b === 254) return false // link local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false // private
  if (a === 192 && b === 168) return false // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false // IETF / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
  if (a === 198 && b === 51 && c === 100) return false // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false // TEST-NET-3
  if (a >= 224) return false // multicast + reserved + broadcast
  return true
}

/**
 * Expands an IPv6 literal to sixteen bytes. Handles `::` compression, a
 * trailing dotted-quad, and a zone suffix. Returns null for anything that is
 * not a valid literal, so the caller fails closed.
 */
function parseIpv6(host: string): number[] | null {
  let value = host.toLowerCase()
  const zone = value.indexOf("%")
  if (zone !== -1) value = value.slice(0, zone)
  if (!value.includes(":")) return null

  const halves = value.split("::")
  if (halves.length > 2) return null

  const toGroups = (part: string): string[] | null => {
    if (!part) return []
    const groups = part.split(":")
    const last = groups[groups.length - 1]
    if (last && last.includes(".")) {
      const v4 = parseIpv4(last)
      if (!v4) return null
      groups.splice(
        groups.length - 1,
        1,
        ((v4[0]! << 8) | v4[1]!).toString(16),
        ((v4[2]! << 8) | v4[3]!).toString(16)
      )
    }
    return groups
  }

  const head = toGroups(halves[0] ?? "")
  const tail = halves.length === 2 ? toGroups(halves[1] ?? "") : null
  if (!head || (halves.length === 2 && !tail)) return null
  if (head.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  if (tail?.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null

  const explicit = head.length + (tail?.length ?? 0)
  let groups: string[]
  if (halves.length === 2) {
    if (explicit > 7) return null
    groups = [...head, ...Array<string>(8 - explicit).fill("0"), ...(tail ?? [])]
  } else {
    if (explicit !== 8) return null
    groups = head
  }

  const bytes: number[] = []
  for (const group of groups) {
    const parsed = Number.parseInt(group, 16)
    bytes.push((parsed >> 8) & 0xff, parsed & 0xff)
  }
  return bytes
}

/**
 * False for every address that is not ordinary public unicast.
 *
 * IPv4-mapped (`::ffff:7f00:1`), IPv4-compatible, NAT64 and 6to4 forms are
 * unwrapped before the decision. Rejecting only the dotted form would let an
 * attacker encode 127.0.0.1 as `::ffff:7f00:1` and slip past the DNS guard.
 */
export function isPublicIpAddress(address: string): boolean {
  const ipv4 = parseIpv4(address)
  if (ipv4) return isPublicIpv4Octets(ipv4)

  const bytes = parseIpv6(address)
  if (!bytes) return false

  const zeroPrefix = (length: number): boolean =>
    bytes.slice(0, length).every((byte) => byte === 0)
  const embeddedV4 = (offset: number): number[] => bytes.slice(offset, offset + 4)

  // :: and ::1
  if (zeroPrefix(16)) return false
  if (zeroPrefix(15) && bytes[15] === 1) return false
  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96.
  if (zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPublicIpv4Octets(embeddedV4(12))
  }
  if (zeroPrefix(12)) return isPublicIpv4Octets(embeddedV4(12))
  // NAT64 64:ff9b::/96 embeds the destination IPv4 address.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  ) {
    return isPublicIpv4Octets(embeddedV4(12))
  }
  // 6to4 2002::/16 embeds the IPv4 address in bytes 2..5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isPublicIpv4Octets(bytes.slice(2, 6))
  }

  if ((bytes[0]! & 0xfe) === 0xfc) return false // unique local fc00::/7
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return false // link local fe80::/10
  if (bytes[0] === 0xff) return false // multicast
  // Documentation 2001:db8::/32 and Teredo 2001:0::/32.
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return false
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return false
  }
  // Only global unicast 2000::/3 is an ordinary public destination.
  return bytes[0] !== undefined && (bytes[0] & 0xe0) === 0x20
}

interface ParsedTarget {
  url: URL
  protocol: "http:" | "https:"
}

function parseTarget(raw: string): ParsedTarget {
  const trimmed = raw.trim()
  if (!trimmed) throw new WebSourceError("INVALID_URL", "Enter a URL first.")

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) {
    throw new WebSourceError("INVALID_URL", "Only http and https addresses can be scanned.")
  }

  let url: URL
  try {
    url = new URL(normalizeUrl(trimmed))
  } catch {
    throw new WebSourceError("INVALID_URL", "That does not look like a valid URL.")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebSourceError("INVALID_URL", "Only http and https addresses can be scanned.")
  }
  if (url.username || url.password) {
    throw new WebSourceError("INVALID_URL", "URLs with a username or password cannot be scanned.")
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  // IP literals never reach DNS, so the lookup guard alone would not see them.
  if (
    (parseIpv4(hostname) !== null || hostname.includes(":")) &&
    !isPublicIpAddress(hostname)
  ) {
    throw new WebSourceError("BLOCKED_HOST", "Private and local addresses cannot be scanned.")
  }
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new WebSourceError("BLOCKED_HOST", "Private and local addresses cannot be scanned.")
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new WebSourceError("INVALID_URL", "Only standard web ports (80 and 443) can be scanned.")
  }

  return { url, protocol: url.protocol }
}

/**
 * Node `lookup` hook used by the request. It resolves once, rejects if *any*
 * returned address is private, and connects to the validated literal — so the
 * address that was checked is the address actually dialled, which closes the
 * DNS-rebinding gap a separate pre-flight lookup would leave open.
 */
export function safeLookup(
  hostname: string,
  options: { all?: boolean } | number | undefined,
  callback: (...args: unknown[]) => void
): void {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error)
      return
    }
    if (!addresses.length || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
      callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }))
      return
    }
    // Node 20+ asks for the whole address list when `autoSelectFamily` is on.
    // Returning one address/family pair there breaks the connection with an
    // invalid-address error, which made every public fetch fail on Node 24.
    const wantsAll = typeof options === "object" && options !== null && options.all === true
    if (wantsAll) {
      callback(null, addresses)
      return
    }
    const chosen = addresses.find((entry) => entry.family === 4) ?? addresses[0]
    callback(null, chosen.address, chosen.family)
  })
}

export interface PublicFetchResult {
  status: number
  contentType: string
  body: string
  url: string
  location: string | null
}

/** Fetch one already-validated target, with a hard body cap and timeout. */
function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error("The request was cancelled.")
  error.name = "AbortError"
  return error
}

function requestOnce(
  target: ParsedTarget,
  headers: Record<string, string>,
  signal?: AbortSignal
): Promise<PublicFetchResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const transport = target.protocol === "https:" ? httpsRequest : httpRequest
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const req = transport(
      target.url,
      {
        method: "GET",
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/json;q=0.9",
          ...headers,
        },
        lookup: safeLookup as unknown as LookupFunction,
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0
        const chunks: Buffer[] = []
        let total = 0

        res.on("data", (chunk: Buffer) => {
          total += chunk.length
          if (total > MAX_BYTES) {
            finish(() =>
              reject(new WebSourceError("TOO_LARGE", "That page is too large to scan."))
            )
            req.destroy()
            return
          }
          chunks.push(chunk)
        })

        res.on("end", () => {
          finish(() =>
            resolve({
              status,
              contentType: String(res.headers["content-type"] ?? "").toLowerCase(),
              body: Buffer.concat(chunks).toString("utf8"),
              url: target.url.toString(),
              location: typeof res.headers.location === "string" ? res.headers.location : null,
            })
          )
        })

        res.on("error", (error) => finish(() => reject(mapNetworkError(error))))
      }
    )

    const timer = setTimeout(() => {
      finish(() => reject(new WebSourceError("TIMEOUT", "That page took too long to respond.")))
      req.destroy()
    }, FETCH_TIMEOUT_MS)

    req.on("timeout", () => {
      finish(() => reject(new WebSourceError("TIMEOUT", "That page took too long to respond.")))
      req.destroy()
    })
    const onAbort = () => {
      const error = abortError(signal!)
      finish(() => reject(error))
      req.destroy(error)
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    req.on("error", (error) => {
      if (signal?.aborted) finish(() => reject(abortError(signal)))
      else finish(() => reject(mapNetworkError(error)))
    })
    req.end()
  })
}

function mapNetworkError(error: unknown): WebSourceError {
  if (error instanceof WebSourceError) return error
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === "EBLOCKED") {
    return new WebSourceError("BLOCKED_HOST", "Private and local addresses cannot be scanned.")
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new WebSourceError("FETCH_FAILED", "That address could not be resolved.")
  }
  return new WebSourceError("FETCH_FAILED", "That page could not be reached.")
}

/** Public-only GET with redirects revalidated at every hop. */
export async function fetchPublicUrl(
  rawUrl: string,
  options: {
    headers?: Record<string, string>
    accept?: (contentType: string) => boolean
    signal?: AbortSignal
  } = {},
  depth = 0
): Promise<PublicFetchResult> {
  if (options.signal?.aborted) throw abortError(options.signal)
  const target = parseTarget(rawUrl)
  const result = await requestOnce(target, options.headers ?? {}, options.signal)

  if ([301, 302, 303, 307, 308].includes(result.status)) {
    if (depth >= MAX_REDIRECTS) {
      throw new WebSourceError("TOO_MANY_REDIRECTS", "That address redirects too many times.")
    }
    if (!result.location) {
      throw new WebSourceError("HTTP_ERROR", "That address redirected without a destination.")
    }

    // Every hop goes back through `parseTarget` and its DNS check. The next
    // request therefore cannot be redirected into a private address.
    const next = new URL(result.location, target.url).toString()
    return fetchPublicUrl(next, options, depth + 1)
  }

  if (result.status === 404) throw new WebSourceError("NOT_FOUND", "That page was not found.")
  if (result.status === 403 || result.status === 429) {
    throw new WebSourceError("RATE_LIMITED", "That service is rate limiting requests. Try later.")
  }
  if (result.status < 200 || result.status >= 300) {
    throw new WebSourceError("HTTP_ERROR", `That page returned HTTP ${result.status}.`)
  }
  if (options.accept && !options.accept(result.contentType)) {
    throw new WebSourceError("UNSUPPORTED_CONTENT", "That address did not return a web page.")
  }

  return result
}

// ─── GitHub ─────────────────────────────────────────────────────────────────

export interface GitHubProfile {
  login: string
  name: string | null
  htmlUrl: string
  bio: string | null
  publicRepos: number
}

export interface GitHubRepository {
  name: string
  url: string
  description: string | null
  language: string | null
  topics: string[]
  stars: number
  pushedAt: string | null
  homepage: string | null
}

export interface GitHubScan {
  profile: GitHubProfile
  repositories: GitHubRepository[]
}

/** `github.com/user`, `www.github.com/user/`, or just a username. */
export function parseGitHubUsername(raw: string): string | null {
  const trimmed = raw.trim().replace(/^@/, "")
  if (!trimmed) return null
  // URL normalisation would collapse `../..` into a valid-looking single
  // segment; a profile address can never legitimately need one.
  if (trimmed.includes("..") || /%2e/i.test(trimmed)) return null

  if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(trimmed) && !trimmed.includes(".")) {
    return trimmed
  }

  let url: URL
  try {
    url = new URL(normalizeUrl(trimmed))
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  const host = url.hostname.toLowerCase().replace(/^www\./, "")
  if (host !== "github.com") return null

  const segments = url.pathname.split("/").filter(Boolean)
  if (segments.length !== 1) return null
  const username = segments[0]
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(username) ? username : null
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetchPublicUrl(url, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
    accept: (contentType) => contentType.includes("application/json"),
  })

  try {
    return JSON.parse(response.body) as T
  } catch {
    throw new WebSourceError("UNSUPPORTED_CONTENT", "GitHub returned an unexpected response.")
  }
}

interface RawGitHubUser {
  login?: unknown
  name?: unknown
  html_url?: unknown
  bio?: unknown
  public_repos?: unknown
}

interface RawGitHubRepo {
  name?: unknown
  html_url?: unknown
  description?: unknown
  fork?: unknown
  archived?: unknown
  language?: unknown
  topics?: unknown
  stargazers_count?: unknown
  pushed_at?: unknown
  homepage?: unknown
}

/** Reads the public GitHub API for one account. No token, no private repos. */
export async function scanGitHub(raw: string): Promise<GitHubScan> {
  const username = parseGitHubUsername(raw)
  if (!username) {
    throw new WebSourceError(
      "INVALID_URL",
      "Enter a GitHub profile address such as https://github.com/your-handle."
    )
  }

  const user = await getJson<RawGitHubUser>(`${GITHUB_API}/users/${encodeURIComponent(username)}`)
  const login = typeof user.login === "string" ? user.login : username
  const repos = await getJson<RawGitHubRepo[]>(
    `${GITHUB_API}/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed&type=owner`
  )

  const repositories: GitHubRepository[] = []
  for (const repo of Array.isArray(repos) ? repos : []) {
    if (repo.fork === true || repo.archived === true) continue
    const name = typeof repo.name === "string" ? repo.name.trim() : ""
    const url = typeof repo.html_url === "string" ? repo.html_url.trim() : ""
    if (!name || !url.startsWith("https://github.com/")) continue

    repositories.push({
      name: name.slice(0, TITLE_MAX),
      url,
      description: typeof repo.description === "string" ? repo.description.trim() : null,
      language: typeof repo.language === "string" ? repo.language.trim() : null,
      topics: Array.isArray(repo.topics)
        ? repo.topics.filter((topic): topic is string => typeof topic === "string").slice(0, 10)
        : [],
      stars:
        typeof repo.stargazers_count === "number" && repo.stargazers_count > 0
          ? Math.floor(repo.stargazers_count)
          : 0,
      pushedAt: typeof repo.pushed_at === "string" ? repo.pushed_at : null,
      homepage: typeof repo.homepage === "string" ? repo.homepage.trim() : null,
    })
  }

  repositories.sort((a, b) => {
    const pushed = (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "")
    return pushed !== 0 ? pushed : b.stars - a.stars
  })

  return {
    profile: {
      login,
      name: typeof user.name === "string" ? user.name.trim() : null,
      htmlUrl:
        typeof user.html_url === "string" ? user.html_url : `https://github.com/${login}`,
      bio: typeof user.bio === "string" ? user.bio.trim() : null,
      publicRepos:
        typeof user.public_repos === "number" ? Math.max(0, Math.floor(user.public_repos)) : 0,
    },
    repositories: repositories.slice(0, MAX_GITHUB_REPOS),
  }
}

// ─── Portfolio HTML ─────────────────────────────────────────────────────────

export interface PortfolioScan {
  url: string
  host: string
  title: string | null
  description: string | null
  headings: string[]
  text: string
  projects: { title: string; url: string | null; description: string | null }[]
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x"
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

function textOf(fragment: string): string {
  return decodeHtmlEntities(
    fragment
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
  ).trim()
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`,
        "i"
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`,
        "i"
      ),
    ]
    for (const pattern of patterns) {
      const match = pattern.exec(html)
      if (match?.[1]) return decodeHtmlEntities(match[1]).trim() || null
    }
  }
  return null
}

function resolveSameHost(link: string, base: URL): string | null {
  try {
    const resolved = new URL(link, base)
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null
    return resolved.toString()
  } catch {
    return null
  }
}

const PROJECT_SECTION =
  /^(?:projects?|selected (?:work|projects)|work|portfolio|case studies|things i(?:'|’)?ve built|what i(?:'|’)?ve built)$/i

const GENERIC_HEADINGS =
  /^(?:about|contact|home|blog|resume|experience|skills|writing|newsletter|footer|menu|navigation)$/i

/** Reads the parts of a portfolio page that can support a career fact. */
export function extractPortfolioPage(html: string, rawUrl: string): PortfolioScan {
  const base = new URL(rawUrl)
  const cleaned = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleaned)
  const title =
    metaContent(cleaned, ["og:title", "twitter:title"]) ??
    (titleTag ? textOf(titleTag[1]) : null)

  const description = metaContent(cleaned, [
    "og:description",
    "twitter:description",
    "description",
  ])

  const headings: string[] = []
  for (const match of cleaned.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = textOf(match[2])
    if (text && text.length <= 160 && !headings.includes(text)) headings.push(text)
    if (headings.length >= 40) break
  }

  const text = textOf(
    cleaned
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
  ).slice(0, 20_000)

  const projects = new Map<
    string,
    { title: string; url: string | null; description: string | null }
  >()

  // 1. Explicit project sections: level-3 headings following a level-2 heading
  //    named Projects / Work / Portfolio. This is the most reliable signal.
  const headingMatches = [...cleaned.matchAll(/<h([123])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
  headingMatches.forEach((match, index) => {
    const headingText = textOf(match[2])
    if (!PROJECT_SECTION.test(headingText)) return

    for (let cursor = index + 1; cursor < headingMatches.length && projects.size < MAX_PORTFOLIO_PROJECTS; cursor++) {
      const candidate = headingMatches[cursor]
      const level = Number(candidate[1])
      if (level <= 2) break
      const projectTitle = textOf(candidate[2])
      if (
        projectTitle.length < 3 ||
        projectTitle.length > 120 ||
        GENERIC_HEADINGS.test(projectTitle)
      ) {
        continue
      }
      projects.set(projectTitle.toLowerCase(), {
        title: projectTitle,
        url: null,
        description: null,
      })
    }
  })

  // 2. `<article>` cards, which many portfolios use for one project each.
  for (const match of cleaned.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    if (projects.size >= MAX_PORTFOLIO_PROJECTS) break
    const block = match[1]
    const heading = /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(block)
    const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(block)
    const projectTitle = heading ? textOf(heading[2]) : anchor ? textOf(anchor[2]) : ""
    if (
      projectTitle.length < 3 ||
      projectTitle.length > 120 ||
      GENERIC_HEADINGS.test(projectTitle)
    ) {
      continue
    }
    const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block)
    const href = anchor ? resolveSameHost(anchor[1], base) : null
    const key = projectTitle.toLowerCase()
    if (!projects.has(key)) {
      projects.set(key, {
        title: projectTitle,
        url: href,
        description: paragraph ? textOf(paragraph[1]).slice(0, 800) || null : null,
      })
    }
  }

  return {
    url: base.toString(),
    host: base.hostname.replace(/^www\./, ""),
    title: title?.slice(0, TITLE_MAX) ?? null,
    description: description?.slice(0, 1_000) ?? null,
    headings,
    text,
    projects: [...projects.values()].slice(0, MAX_PORTFOLIO_PROJECTS),
  }
}

/** Fetches and extracts a portfolio page. Only HTML is accepted. */
export async function scanPortfolio(rawUrl: string): Promise<PortfolioScan> {
  const target = parseTarget(rawUrl)
  const result = await fetchPublicUrl(target.url.toString(), {
    headers: { accept: "text/html,application/xhtml+xml" },
    accept: (contentType) =>
      contentType.includes("text/html") || contentType.includes("application/xhtml+xml"),
  })
  return extractPortfolioPage(result.body, result.url)
}

// ─── Deterministic mapping ──────────────────────────────────────────────────

export interface WebEvidenceCandidate {
  kind: "PROJECT"
  title: string
  organization: string | null
  details: string | null
  startDate: Date | null
  endDate: Date | null
  metadata: Record<string, unknown>
  /** Canonical capability names this specific fact demonstrates. */
  capabilityNames: string[]
}

export interface WebCapabilityCandidate {
  name: string
  category: string | null
}

export interface WebScanFacts {
  source: WebSourceKind
  evidence: WebEvidenceCandidate[]
  capabilities: WebCapabilityCandidate[]
}

interface TechnologyEntry {
  name: string
  category: string
  aliases?: string[]
}

/**
 * A closed vocabulary, deliberately not a general NER pass. A word only becomes
 * a capability when it is on this list *and* appears in fetched text, so a page
 * that never mentions React cannot produce a React row.
 */
export const TECHNOLOGY_VOCABULARY: TechnologyEntry[] = [
  { name: "TypeScript", category: "Language", aliases: ["TS"] },
  { name: "JavaScript", category: "Language", aliases: ["JS"] },
  { name: "Python", category: "Language" },
  { name: "Java", category: "Language" },
  { name: "Kotlin", category: "Language" },
  { name: "Swift", category: "Language" },
  { name: "Go", category: "Language", aliases: ["Golang"] },
  { name: "Rust", category: "Language" },
  { name: "Ruby", category: "Language" },
  { name: "PHP", category: "Language" },
  { name: "C#", category: "Language", aliases: ["CSharp"] },
  { name: "C++", category: "Language", aliases: ["CPP"] },
  { name: "SQL", category: "Language" },
  { name: "HTML", category: "Language" },
  { name: "CSS", category: "Language" },
  { name: "React", category: "Framework", aliases: ["React.js", "ReactJS"] },
  { name: "Next.js", category: "Framework", aliases: ["NextJS", "Next.js"] },
  { name: "Vue", category: "Framework", aliases: ["Vue.js", "VueJS"] },
  { name: "Nuxt", category: "Framework", aliases: ["Nuxt.js"] },
  { name: "Angular", category: "Framework" },
  { name: "Svelte", category: "Framework", aliases: ["SvelteKit"] },
  { name: "Node.js", category: "Runtime", aliases: ["NodeJS", "Node"] },
  { name: "Express", category: "Framework", aliases: ["Express.js"] },
  { name: "Django", category: "Framework" },
  { name: "Flask", category: "Framework" },
  { name: "Laravel", category: "Framework" },
  { name: "Rails", category: "Framework", aliases: ["Ruby on Rails"] },
  { name: "Spring Boot", category: "Framework", aliases: ["Spring"] },
  { name: "Tailwind CSS", category: "Framework", aliases: ["Tailwind"] },
  { name: "GraphQL", category: "API" },
  { name: "REST", category: "API", aliases: ["REST API", "RESTful"] },
  { name: "PostgreSQL", category: "Database", aliases: ["Postgres"] },
  { name: "MySQL", category: "Database" },
  { name: "MongoDB", category: "Database", aliases: ["Mongo"] },
  { name: "Redis", category: "Database" },
  { name: "Prisma", category: "Database" },
  { name: "Supabase", category: "Database" },
  { name: "Firebase", category: "Database" },
  { name: "Docker", category: "Tool" },
  { name: "Kubernetes", category: "Tool", aliases: ["K8s"] },
  { name: "Terraform", category: "Tool" },
  { name: "GitHub Actions", category: "Tool", aliases: ["GH Actions"] },
  { name: "Playwright", category: "Tool" },
  { name: "Jest", category: "Tool" },
  { name: "Vitest", category: "Tool" },
  { name: "Figma", category: "Design" },
  { name: "AWS", category: "Cloud", aliases: ["Amazon Web Services"] },
  { name: "Azure", category: "Cloud" },
  { name: "GCP", category: "Cloud", aliases: ["Google Cloud"] },
  { name: "Vercel", category: "Cloud" },
  { name: ".NET", category: "Framework", aliases: ["dotnet"] },
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Whole-token match, including terms such as C++, C# and .NET. */
export function containsTechnology(text: string, term: string): boolean {
  if (!term) return false
  const left = /^[A-Za-z0-9]/.test(term) ? "(?<![A-Za-z0-9])" : ""
  const right = /[A-Za-z0-9]$/.test(term) ? "(?![A-Za-z0-9])" : ""
  return new RegExp(`${left}${escapeRegExp(term)}${right}`, "i").test(text)
}

function technologiesIn(text: string): TechnologyEntry[] {
  const found: TechnologyEntry[] = []
  for (const entry of TECHNOLOGY_VOCABULARY) {
    const terms = [entry.name, ...(entry.aliases ?? [])]
    if (terms.some((term) => containsTechnology(text, term))) found.push(entry)
  }
  return found
}

function capabilityKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.\-_\s]+/g, "")
}

function dedupeCapabilities(entries: WebCapabilityCandidate[]): WebCapabilityCandidate[] {
  const seen = new Set<string>()
  const result: WebCapabilityCandidate[] = []
  for (const entry of entries) {
    const key = capabilityKey(entry.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(entry)
    if (result.length >= MAX_CAPABILITIES) break
  }
  return result
}

/** Pure GitHub → candidate facts. */
export function mapGitHubToCareerFacts(scan: GitHubScan, now = new Date()): WebScanFacts {
  const evidence: WebEvidenceCandidate[] = []
  const capabilities: WebCapabilityCandidate[] = []

  for (const repo of scan.repositories) {
    const haystack = `${repo.name} ${repo.description ?? ""} ${repo.topics.join(" ")}`
    const detected = technologiesIn(haystack)

    // The reported primary language is direct evidence even when it is not in
    // the closed vocabulary (GitHub supports hundreds of languages).
    const names = new Set<string>()
    if (repo.language) {
      names.add(repo.language)
      capabilities.push({ name: repo.language, category: "Language" })
    }
    for (const entry of detected) {
      names.add(entry.name)
      capabilities.push({ name: entry.name, category: entry.category })
    }

    evidence.push({
      kind: "PROJECT",
      title: repo.name.slice(0, TITLE_MAX),
      organization: "GitHub",
      details: repo.description?.slice(0, DETAILS_MAX) ?? null,
      startDate: null,
      endDate: null,
      metadata: {
        source: "github",
        sourceUrl: repo.url,
        repository: `${scan.profile.login}/${repo.name}`,
        username: scan.profile.login,
        stars: repo.stars,
        language: repo.language,
        topics: repo.topics,
        homepage: repo.homepage,
        pushedAt: repo.pushedAt,
        fetchedAt: now.toISOString(),
      },
      capabilityNames: [...names],
    })
  }

  return {
    source: "github",
    evidence,
    capabilities: dedupeCapabilities(capabilities),
  }
}

/** Pure portfolio → candidate facts. */
export function mapPortfolioToCareerFacts(scan: PortfolioScan, now = new Date()): WebScanFacts {
  const capabilities = dedupeCapabilities(
    technologiesIn(
      [scan.title ?? "", scan.description ?? "", scan.headings.join(" "), scan.text].join(" ")
    ).map((entry) => ({ name: entry.name, category: entry.category }))
  )

  const baseMetadata = {
    source: "portfolio",
    sourceUrl: scan.url,
    siteHost: scan.host,
    fetchedAt: now.toISOString(),
  }

  const evidence: WebEvidenceCandidate[] = []
  const siteTitle = scan.title ? `Portfolio — ${scan.title}` : `Portfolio — ${scan.host}`
  evidence.push({
    kind: "PROJECT",
    title: siteTitle.slice(0, TITLE_MAX),
    organization: null,
    details: scan.description?.slice(0, DETAILS_MAX) ?? null,
    startDate: null,
    endDate: null,
    metadata: {
      ...baseMetadata,
      pageTitle: scan.title,
      detectedTechnologies: capabilities.map((entry) => entry.name),
    },
    capabilityNames: capabilities.map((entry) => entry.name),
  })

  for (const project of scan.projects) {
    evidence.push({
      kind: "PROJECT",
      title: project.title.slice(0, TITLE_MAX),
      organization: null,
      details: project.description?.slice(0, DETAILS_MAX) ?? null,
      startDate: null,
      endDate: null,
      metadata: {
        ...baseMetadata,
        sourceUrl: project.url ?? scan.url,
        section: "projects",
      },
      capabilityNames: technologiesIn(
        `${project.title} ${project.description ?? ""}`
      ).map((entry) => entry.name),
    })
  }

  return {
    source: "portfolio",
    evidence: evidence.slice(0, MAX_PORTFOLIO_PROJECTS + 1),
    capabilities,
  }
}

export { capabilityKey as webCapabilityKey }
