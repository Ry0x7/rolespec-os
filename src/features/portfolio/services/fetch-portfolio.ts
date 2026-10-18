import type { LookupOptions } from "node:dns"
import { promises as dns } from "node:dns"
import type { LookupFunction } from "node:net"

import { Agent, fetch as undiciFetch } from "undici"

import {
  PORTFOLIO_FETCH_MAX_BYTES,
  PORTFOLIO_FETCH_MAX_REDIRECTS,
  PORTFOLIO_FETCH_TIMEOUT_MS,
} from "../constants/portfolio"
import { logger } from "@/shared/lib/logger"

const log = logger("portfolio")

// ─── Result types ────────────────────────────────────────────────────────────

export type PortfolioFetchErrorCode =
  | "INVALID_URL"
  | "BLOCKED_URL"
  | "FETCH_FAILED"
  | "UNSUPPORTED_CONTENT"
  | "TOO_LARGE"
  | "TIMEOUT"

export type PortfolioFetchResult =
  | { ok: true; text: string; title?: string }
  | { ok: false; code: PortfolioFetchErrorCode }

export type UrlCheckResult =
  | { ok: true; url: URL }
  | { ok: false; code: "INVALID_URL" | "BLOCKED_URL" }

// ─── SSRF guard ──────────────────────────────────────────────────────────────

/** Hostnames that never resolve to something a user should be able to scan. */
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  // Covers metadata.google.internal, the GCP metadata endpoint.
  /\.internal$/i,
  // metadata.goog is the same endpoint without the .internal suffix.
  /^metadata\.goog$/i,
]

/** True for hostnames that are blocked purely on their literal name. */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.trim().replace(/\.$/, "")
  if (!h) return true
  return BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(h))
}

function parseIPv4(value: string): number[] | null {
  const parts = value.split(".")
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    octets.push(n)
  }
  return octets
}

/**
 * Expands an IPv6 literal into its eight 16-bit groups, resolving `::`
 * compression and any embedded IPv4 tail (`::ffff:127.0.0.1`). Returns null for
 * anything that is not a well-formed IPv6 literal.
 *
 * Needed because the WHATWG URL parser rewrites a dotted embedded address into
 * hex — `new URL("http://[::ffff:127.0.0.1]")` has hostname `[::ffff:7f00:1]` —
 * so matching mapped addresses textually cannot work.
 */
function parseIPv6(value: string): number[] | null {
  // Strip a zone id (fe80::1%eth0) before parsing.
  let raw = value.split("%")[0]
  if (!raw.includes(":")) return null

  // Fold a trailing dotted quad into the two groups it occupies.
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw)
  if (tail) {
    const v4 = parseIPv4(tail[1])
    if (!v4) return null
    const hi = ((v4[0] << 8) | v4[1]).toString(16)
    const lo = ((v4[2] << 8) | v4[3]).toString(16)
    raw = `${raw.slice(0, tail.index)}${hi}:${lo}`
  }

  const toGroups = (part: string): number[] | null => {
    if (!part) return []
    const out: number[] = []
    for (const chunk of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null
      out.push(Number.parseInt(chunk, 16))
    }
    return out
  }

  const halves = raw.split("::")
  if (halves.length > 2) return null

  if (halves.length === 2) {
    const head = toGroups(halves[0])
    const rest = toGroups(halves[1])
    if (!head || !rest) return null
    const missing = 8 - head.length - rest.length
    // `::` must stand for at least one group.
    if (missing < 1) return null
    return [...head, ...Array<number>(missing).fill(0), ...rest]
  }

  const groups = toGroups(raw)
  if (!groups || groups.length !== 8) return null
  return groups
}

/**
 * True for IPv4 space that must never be fetched: RFC 1918 private ranges,
 * loopback, link-local (which is where the cloud metadata endpoint
 * 169.254.169.254 lives), carrier-grade NAT, the IETF-reserved documentation and
 * benchmarking blocks, and everything from 224/4 up (multicast, reserved,
 * broadcast).
 */
function isPrivateIPv4(octets: number[]): boolean {
  const [a, b, c] = octets
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // protocol assignments, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true // 6to4 relay anycast
  if (a === 192 && b === 168) return true // RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast, reserved, broadcast
  return false
}

/** Reads the 32 bits held in two 16-bit groups as IPv4 octets. */
function groupsToIPv4(hi: number, lo: number): number[] {
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]
}

/**
 * True for IPv6 space that must never be fetched. Every form that can carry an
 * IPv4 address is unwrapped and re-checked as IPv4, so `::ffff:7f00:1`,
 * `64:ff9b::7f00:1` and `2002:7f00:1::` are all recognised as loopback.
 */
function isPrivateIPv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups

  // ::/128, ::1/128, IPv4-compatible ::a.b.c.d and IPv4-mapped ::ffff:a.b.c.d.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) {
    if (g5 === 0 && g6 === 0 && g7 <= 1) return true
    return isPrivateIPv4(groupsToIPv4(g6, g7))
  }

  // NAT64 well-known prefix 64:ff9b::/96 — the low 32 bits are the IPv4 target.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIPv4(groupsToIPv4(g6, g7))
  }

  // 6to4 2002::/16 embeds the IPv4 address in the next 32 bits.
  if (g0 === 0x2002) return isPrivateIPv4(groupsToIPv4(g1, g2))

  if ((g0 & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true // fec0::/10 deprecated site-local
  if ((g0 & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

/**
 * True when an IP literal falls inside a private, loopback, link-local or
 * otherwise reserved range — see {@link isPrivateIPv4} and
 * {@link isPrivateIPv6} for the exact blocks.
 *
 * Fails CLOSED: anything that is not a well-formed IPv4 or IPv6 literal returns
 * true. Callers only ever pass literals (a URL hostname already known to be one,
 * or an address out of `dns.lookup`), so an unparseable value means something
 * unexpected and is refused rather than waved through.
 *
 * This classifies an address, so on its own it cannot stop DNS rebinding (a
 * hostname that answers publicly during {@link checkUrlSafety} and privately
 * when the socket is opened). {@link safeLookup} closes that by re-running this
 * check inside the connector's own resolution — see there.
 */
export function isPrivateAddress(address: string): boolean {
  const raw = address.trim().replace(/^\[|\]$/g, "").toLowerCase()
  if (!raw) return true

  const v4 = parseIPv4(raw)
  if (v4) return isPrivateIPv4(v4)

  const v6 = parseIPv6(raw)
  if (v6) return isPrivateIPv6(v6)

  return true
}

/** The error a blocked connect-time resolution fails with. */
function blockedAddressError(hostname: string, address?: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(
    address
      ? `Refusing to connect to ${hostname}: resolved to blocked address ${address}`
      : `Refusing to connect to ${hostname}: no usable address`
  )
  err.code = "EBLOCKEDADDRESS"
  return err
}

/**
 * DNS resolution used by the outbound connector itself, so the address the
 * socket is opened to is the one this guard approved.
 *
 * {@link checkUrlSafety} resolves the hostname before the request, but the HTTP
 * client resolves it again when it connects; a rebinding attacker can answer the
 * first lookup publicly and the second one with 127.0.0.1. Validating here — the
 * lookup the connection actually uses — means a private answer fails the connect
 * instead of reaching an internal service.
 *
 * Every returned address must pass {@link isPrivateAddress}, not just the one
 * that ends up being used: Node may try several (happy eyeballs).
 */
export function safeLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address?: string | Array<{ address: string; family: number }>,
    family?: number
  ) => void
): void {
  dns.lookup(hostname, { ...options, all: true }).then(
    (entries) => {
      if (entries.length === 0) {
        callback(blockedAddressError(hostname))
        return
      }
      const blocked = entries.find((entry) => isPrivateAddress(entry.address))
      if (blocked) {
        callback(blockedAddressError(hostname, blocked.address))
        return
      }
      // Answer in the shape the caller asked for: `all` decides between a list
      // and a single address + family pair.
      if (options.all) callback(null, entries)
      else callback(null, entries[0].address, entries[0].family)
    },
    (err: NodeJS.ErrnoException) => callback(err)
  )
}

/**
 * The dispatcher every portfolio fetch runs through. Its connector resolves
 * hostnames with {@link safeLookup}, which is what pins the connection to a
 * validated address.
 */
const portfolioAgent = new Agent({
  connect: { lookup: safeLookup as unknown as LookupFunction },
})

/**
 * Validates a URL for outbound fetching: http/https only, no blocked hostname,
 * no IP literal in a reserved range, and no DNS resolution into one either.
 *
 * Exported separately from {@link fetchPortfolioText} so it can be unit-tested
 * (and re-run for every redirect hop) without performing a request.
 */
export async function checkUrlSafety(raw: string): Promise<UrlCheckResult> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, code: "INVALID_URL" }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "INVALID_URL" }
  }

  // Credentials in the URL are never needed here and are a classic way to make
  // a target look like a different host.
  if (url.username || url.password) return { ok: false, code: "INVALID_URL" }

  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  if (!hostname) return { ok: false, code: "INVALID_URL" }

  if (isBlockedHostname(hostname)) {
    return { ok: false, code: "BLOCKED_URL" }
  }

  // IP literal — no DNS round trip needed.
  const isIpLiteral = parseIPv4(hostname) !== null || hostname.includes(":")
  if (isIpLiteral) {
    return isPrivateAddress(hostname)
      ? { ok: false, code: "BLOCKED_URL" }
      : { ok: true, url }
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await dns.lookup(hostname, { all: true })
  } catch {
    return { ok: false, code: "BLOCKED_URL" }
  }

  if (addresses.length === 0) return { ok: false, code: "BLOCKED_URL" }
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    return { ok: false, code: "BLOCKED_URL" }
  }

  return { ok: true, url }
}

// ─── HTML → readable text ────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi,
    (match) => ENTITIES[match.toLowerCase()] ?? match
  )
}

/** Pulls the `<title>` out of a raw HTML document, if present. */
export function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!match) return undefined
  const title = decodeEntities(match[1].replace(/\s+/g, " ")).trim()
  return title || undefined
}

/** Pulls the meta description (name or property) out of raw HTML, if present. */
export function extractMetaDescription(html: string): string | undefined {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of metaTags) {
    if (!/(?:name|property)\s*=\s*["']?(?:og:)?description["']?/i.test(tag)) continue
    const content = /content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    if (!content) continue
    const value = decodeEntities(
      (content[1] ?? content[2] ?? content[3] ?? "").replace(/\s+/g, " ")
    ).trim()
    if (value) return value
  }
  return undefined
}

/**
 * Strips a raw HTML document down to readable text without pulling in a parser
 * dependency. Title and meta description are prepended so the model still sees
 * the page's positioning even when the body is mostly markup.
 */
export function extractReadableText(html: string): { text: string; title?: string } {
  const title = extractTitle(html)
  const description = extractMetaDescription(html)

  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")

  const cleaned = decodeEntities(body)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  const parts = [
    title && `Page title: ${title}`,
    description && `Meta description: ${description}`,
    cleaned,
  ].filter(Boolean) as string[]

  return { text: parts.join("\n\n"), title }
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

const ALLOWED_CONTENT_TYPES = ["text/html", "text/plain"]

type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>

async function readCapped(response: FetchResponse): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > PORTFOLIO_FETCH_MAX_BYTES) {
    return null
  }

  const body = response.body
  if (!body) return await response.text()

  const reader = body.getReader()
  const decoder = new TextDecoder("utf-8")
  let received = 0
  let text = ""

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > PORTFOLIO_FETCH_MAX_BYTES) {
      await reader.cancel()
      return null
    }
    text += decoder.decode(value, { stream: true })
  }

  text += decoder.decode()
  return text
}

/**
 * Fetches a portfolio page and returns its readable text. Redirects are followed
 * manually so every hop passes back through the SSRF guard, and the request runs
 * on {@link portfolioAgent} so the connection itself can only be opened to an
 * address {@link safeLookup} approved.
 */
export async function fetchPortfolioText(rawUrl: string): Promise<PortfolioFetchResult> {
  let target = rawUrl
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PORTFOLIO_FETCH_TIMEOUT_MS)

  try {
    for (let hop = 0; hop <= PORTFOLIO_FETCH_MAX_REDIRECTS; hop++) {
      const check = await checkUrlSafety(target)
      if (!check.ok) return { ok: false, code: check.code }

      let response: FetchResponse
      try {
        response = await undiciFetch(check.url, {
          dispatcher: portfolioAgent,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
            "user-agent": "RoleSpecBot/1.0 (+profile-rating)",
          },
        })
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return { ok: false, code: "TIMEOUT" }
        }
        log.error("portfolio fetch failed", { err })
        return { ok: false, code: "FETCH_FAILED" }
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")
        if (!location) return { ok: false, code: "FETCH_FAILED" }
        target = new URL(location, check.url).toString()
        continue
      }

      if (!response.ok) return { ok: false, code: "FETCH_FAILED" }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase()
      if (!ALLOWED_CONTENT_TYPES.some((type) => contentType.includes(type))) {
        return { ok: false, code: "UNSUPPORTED_CONTENT" }
      }

      let raw: string | null
      try {
        raw = await readCapped(response)
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return { ok: false, code: "TIMEOUT" }
        }
        log.error("portfolio body read failed", { err })
        return { ok: false, code: "FETCH_FAILED" }
      }

      if (raw === null) return { ok: false, code: "TOO_LARGE" }

      const { text, title } = extractReadableText(raw)
      if (!text) return { ok: false, code: "UNSUPPORTED_CONTENT" }

      return { ok: true, text, title }
    }

    // Ran out of redirect budget.
    return { ok: false, code: "FETCH_FAILED" }
  } finally {
    clearTimeout(timer)
  }
}
