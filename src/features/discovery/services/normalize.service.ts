import { WorkType } from "@/generated/prisma/enums"
import { normalizeUrl } from "@/shared/lib/url"
import type { NormalizedPosting, RawPosting } from "../types"

/**
 * Deterministic cleanup between a source adapter and the candidate list. No AI,
 * no network, no database — every function here is pure so the pipeline's
 * behaviour is testable without a provider.
 */

/** Matches the extension's `jobDescription` cap so both paths store the same size. */
export const MAX_DESCRIPTION_LENGTH = 20000
/** Matches `createJobApplicationSchema`'s caps for the short fields. */
export const MAX_SHORT_FIELD_LENGTH = 200

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
}

/**
 * The handful of entities a job board actually emits. Exported because one
 * provider (Greenhouse's single-posting endpoint) ships its body double-encoded
 * — entity-escaped HTML — which has to be decoded *before* `stripHtml`, not
 * after it as the pipeline below does.
 */
export function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi,
    (match) => ENTITIES[match.toLowerCase()] ?? match
  )
}

/**
 * Turns a provider's HTML description into plain text. A regex strip rather
 * than a parser: the output is stored and displayed as text, never re-rendered
 * as markup, so the only requirement is that no tag survives into the field.
 */
export function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Ad-network and analytics click ids: never part of any posting's identity, on
 * any host, so they are the only thing stripped without knowing the board.
 *
 * Everything board-shaped (`ref`, `origin`, `src`, `type`, …) is deliberately
 * absent: on a host we have no rule for, those may well select the posting, and
 * merging two real jobs is worse than keeping two keys for one.
 */
const TRACKING_PARAM_PREFIXES = ["utm_"]
const TRACKING_PARAMS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "_ga",
  "trk",
  "trkid",
  "trackingid",
  "tracking_id",
])

/**
 * What we know about a specific board's URLs.
 *
 * `dropAllQuery` is for boards whose path already carries the posting id, so
 * every param is decoration — including ones like `type` that we must not touch
 * generically. `keepOnly` is for boards that identify the posting *with* a
 * param: everything except the named ids goes.
 */
type HostRule = { dropAllQuery: true } | { keepOnly: readonly string[] }

const DROP_ALL_QUERY: HostRule = { dropAllQuery: true }

/**
 * Exact hosts, after lowercasing and `www.` stripping. Greenhouse, Lever and
 * Ashby are here rather than under `keepOnly` because the adapters' own URLs
 * put the id in the path (`job-boards.greenhouse.io/{slug}/jobs/{id}`); the
 * `gh_jid` param only appears on companies' *embedded* career pages, which live
 * on arbitrary hosts and are covered by the generic list keeping it.
 */
const HOST_RULES: Record<string, HostRule> = {
  "bossjob.ph": DROP_ALL_QUERY,
  "kalibrr.com": DROP_ALL_QUERY,
  "jobs.lever.co": DROP_ALL_QUERY,
  "jobs.ashbyhq.com": DROP_ALL_QUERY,
  "job-boards.greenhouse.io": DROP_ALL_QUERY,
  "boards.greenhouse.io": DROP_ALL_QUERY,
  "remotive.com": DROP_ALL_QUERY,
  "arbeitnow.com": DROP_ALL_QUERY,
  "onlinejobs.ph": DROP_ALL_QUERY,
  "indeed.com": { keepOnly: ["jk"] },
}

/** The rule for a host, or null when we know nothing about it. */
function hostRule(hostname: string, pathname: string): HostRule | null {
  // Every country front-end of these two is the same board.
  if (hostname === "jobstreet.com" || hostname.endsWith(".jobstreet.com")) {
    return DROP_ALL_QUERY
  }
  // Three ATSs that give every company its own subdomain. All of them key a
  // posting entirely on the path (`/careers/336`, `/jobs/{id}/{slug}`,
  // `/{site}/job/{location}/{title}_{req}`), so a query string on one of these
  // is never part of the posting's identity.
  if (hostname.endsWith(".bamboohr.com")) return DROP_ALL_QUERY
  if (hostname.endsWith(".freshteam.com")) return DROP_ALL_QUERY
  if (hostname.endsWith(".myworkdayjobs.com")) return DROP_ALL_QUERY
  if (hostname === "indeed.com" || hostname.endsWith(".indeed.com")) {
    return { keepOnly: ["jk"] }
  }
  if (hostname === "linkedin.com") {
    // The permalink carries the id in the path; the search page carries it in
    // `currentJobId`, and dropping that would collapse every search URL onto one.
    // A search URL naming a numeric id is rewritten onto the permalink first
    // (see `linkedinPermalinkPath`), so this branch only ever sees the ones
    // that could not be folded.
    if (pathname.startsWith("/jobs/view/")) return DROP_ALL_QUERY
    if (pathname.startsWith("/jobs/search")) return { keepOnly: ["currentJobId"] }
    return null
  }
  return HOST_RULES[hostname] ?? null
}

/** LinkedIn job ids are digits only; anything else is not an id we can trust. */
const LINKEDIN_JOB_ID = /^\d+$/

/**
 * `/jobs/search/?currentJobId={id}` and `/jobs/view/{id}` are the same posting
 * seen from the search page and from its own permalink, so saving one after
 * the other used to produce two tracker rows. The search form is folded onto
 * the permalink, which is the form the rest of the app already stores.
 *
 * Returns null — leaving the search URL to the `keepOnly: ["currentJobId"]`
 * rule — when there is no `currentJobId` or it is not digits only. Inventing a
 * permalink out of an id we do not recognise would merge unrelated postings,
 * which is worse than keeping the two keys.
 */
function linkedinPermalinkPath(hostname: string, url: URL): string | null {
  if (hostname !== "linkedin.com") return null
  if (!url.pathname.startsWith("/jobs/search")) return null
  const id = url.searchParams.get("currentJobId")
  if (!id || !LINKEDIN_JOB_ID.test(id)) return null
  return `/jobs/view/${id}`
}

/**
 * Comparison key for a posting URL.
 *
 * `normalizeUrl` from `@/shared/lib/url` only adds a missing protocol, so the
 * rest is done here: lowercase scheme and host, drop `www.`, drop the fragment,
 * drop tracking params (or the whole query, on a host that keys postings by
 * path), drop a trailing slash, and sort what remains so two orderings of the
 * same query compare equal. Returns "" for anything that is
 * not a parseable http(s) URL, which makes the caller fall back to
 * `provider:externalId`.
 */
export function canonicalizeUrl(raw: string | null | undefined): string {
  const withProtocol = normalizeUrl(raw ?? "")
  if (!withProtocol) return ""

  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    return ""
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return ""

  url.hash = ""
  url.username = ""
  url.password = ""
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "")

  const permalink = linkedinPermalinkPath(url.hostname, url)
  if (permalink) {
    url.pathname = permalink
    url.search = ""
  }

  const rule = hostRule(url.hostname, url.pathname)
  const kept =
    rule && "dropAllQuery" in rule
      ? []
      : [...url.searchParams.entries()].filter(([key]) => {
          const name = key.toLowerCase()
          if (rule) return rule.keepOnly.some((id) => id.toLowerCase() === name)
          return (
            !TRACKING_PARAMS.has(name) &&
            !TRACKING_PARAM_PREFIXES.some((prefix) => name.startsWith(prefix))
          )
        })
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  url.search = ""
  for (const [key, value] of kept) url.searchParams.append(key, value)

  const path = url.pathname.replace(/\/+$/, "")
  return `${url.protocol}//${url.host}${path}${url.search}`
}

/** Trims, collapses whitespace and caps. Returns undefined for empty input. */
function cleanShort(value: string | undefined, max = MAX_SHORT_FIELD_LENGTH): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

/**
 * Maps a provider's own remote/hybrid/onsite wording onto `WorkType`. Anything
 * unrecognised stays undefined rather than being guessed — a wrong badge is
 * worse than a missing one.
 */
export function parseWorkType(hint: string | undefined): WorkType | undefined {
  const value = hint?.toLowerCase() ?? ""
  if (!value) return undefined
  if (value.includes("hybrid")) return WorkType.HYBRID
  if (value.includes("remote")) return WorkType.REMOTE
  if (value.includes("on-site") || value.includes("onsite") || value.includes("in office")) {
    return WorkType.ONSITE
  }
  return undefined
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  // Remotive publishes naive timestamps ("2026-08-27T14:36:09"); JS would read
  // those as local time, so an explicit Z keeps every provider on UTC.
  const withZone = /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(value) ? `${value}Z` : value
  const date = new Date(withZone)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * `RawPosting` → `NormalizedPosting`. Returns null when the posting is missing
 * something a saved job cannot do without (title, company or URL).
 */
export function normalizePosting(posting: RawPosting): NormalizedPosting | null {
  const title = cleanShort(posting.title)
  const companyName = cleanShort(posting.companyName)
  const url = normalizeUrl(posting.url ?? "")
  if (!title || !companyName || !url) return null

  const description = posting.description
    ? stripHtml(posting.description).slice(0, MAX_DESCRIPTION_LENGTH)
    : undefined

  return {
    provider: posting.provider,
    externalId: posting.externalId,
    title,
    companyName,
    url,
    canonicalUrl: canonicalizeUrl(url),
    location: cleanShort(posting.location),
    workType: parseWorkType(posting.workTypeHint),
    salaryText: cleanShort(posting.salaryText),
    description: description || undefined,
    postedAt: parseDate(posting.postedAt),
  }
}

/** The key two postings are considered the same by. */
export function dedupeKey(posting: NormalizedPosting): string {
  return posting.canonicalUrl || `${posting.provider}:${posting.externalId}`
}

/**
 * Drops repeats inside one result set, keeping the first occurrence. Queries
 * overlap heavily (a "Frontend Engineer" run and a "React Engineer" run return
 * many of the same postings), so this runs before anything expensive.
 */
export function dedupePostings(postings: NormalizedPosting[]): NormalizedPosting[] {
  const seen = new Set<string>()
  const out: NormalizedPosting[] = []
  for (const posting of postings) {
    const key = dedupeKey(posting)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(posting)
  }
  return out
}

/** Normalizes a batch and dedupes it, dropping postings that cannot be mapped. */
export function normalizeAndDedupe(raw: RawPosting[]): NormalizedPosting[] {
  const normalized: NormalizedPosting[] = []
  for (const posting of raw) {
    const mapped = normalizePosting(posting)
    if (mapped) normalized.push(mapped)
  }
  return dedupePostings(normalized)
}
