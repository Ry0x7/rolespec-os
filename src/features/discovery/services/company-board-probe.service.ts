import { logger } from "@/shared/lib/logger"
import { ATS_SLUG_PATTERN, MAX_ATS_SLUG_LENGTH } from "@/features/settings/schemas/preferences.schema"

import { ASHBY_ENDPOINT, ASHBY_PROVIDER_ID } from "./adapters/ashby.adapter"
import {
  BAMBOOHR_PROVIDER_ID,
  BAMBOOHR_SAFE_SLUG,
  bamboohrBoardUrl,
} from "./adapters/bamboohr.adapter"
import { FRESHTEAM_PROVIDER_ID, freshteamBoardUrl } from "./adapters/freshteam.adapter"
import { GREENHOUSE_ENDPOINT, GREENHOUSE_PROVIDER_ID } from "./adapters/greenhouse.adapter"
import { LEVER_ENDPOINT, LEVER_PROVIDER_ID } from "./adapters/lever.adapter"
import type { AtsProviderId } from "./ats-posting.service"

/**
 * The providers a company *name* can be probed against. Workday is excluded at
 * the type level, not just by omission from {@link PROBES}: a hit is something
 * the dialog stages as a slug, and a Workday entry is never a slug.
 */
export type ProbedProviderId = Exclude<AtsProviderId, "workday">

/**
 * "Does this company have a public ATS board, and under what slug?"
 *
 * The watchlist is the only way a user reaches a company's own board, and until
 * now it took a slug they had to already know. Greenhouse, Lever, Ashby,
 * BambooHR and Freshteam all publish a key-less board endpoint (or, for
 * Freshteam, a server-rendered listing page) that answers 200 for a real slug
 * and 404 for anything else, which makes the question answerable directly
 * instead of by guessing in the address bar.
 *
 * Workday is deliberately absent: a Workday site is a tenant plus a data centre
 * plus a site id, none of which is derivable from a company name, so there is
 * nothing to guess. The watchlist dialog takes a Workday board URL instead.
 *
 * Guessing is still what this does — it derives a handful of slugs from the name
 * and asks. That is why the result reports the slug it actually hit and why the
 * empty state says the slug may simply differ rather than that no board exists.
 *
 * Cost is bounded on purpose: at most {@link MAX_BOARD_SLUG_CANDIDATES} slugs ×
 * five providers = twenty GETs per call, each with its own timeout and each
 * isolated so one dead provider cannot take the others down. They all run
 * concurrently, so the wall time is still one {@link BOARD_PROBE_TIMEOUT_MS}
 * and the caller's total budget is unchanged.
 */

const log = logger("discovery")

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

/** Keeps one click at or under twenty outbound requests, all issued concurrently. */
export const MAX_BOARD_SLUG_CANDIDATES = 4

/** Per-request budget. A board endpoint that is slow is treated as absent. */
export const BOARD_PROBE_TIMEOUT_MS = 5_000

/** An Ashby board inlines every description, so a probe can pull megabytes. */
const MAX_PROBE_RESPONSE_BYTES = 8 * 1024 * 1024

/**
 * Legal-form words that are part of a registered name and never part of a board
 * slug. Deliberately short: dropping a word that a company *did* put in its slug
 * costs nothing (the un-stripped candidate is probed too), but the list is only
 * worth what it removes.
 */
const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "plc",
  "ag",
  "bv",
  "nv",
  "sa",
  "srl",
  "pty",
])

/**
 * Candidate board slugs for a company name, in the order they are probed.
 *
 * Deterministic and documented, because a user who sees "no board found" needs
 * to know what was actually tried. The name is lowercased, stripped of accents,
 * `&` is spelled out, and every other non-alphanumeric run becomes a word break.
 * From those words, four forms in this order:
 *
 * 1. every word joined ("acme corp" → `acmecorp`)
 * 2. every word hyphenated → `acme-corp`
 * 3. joined without a trailing legal suffix → `acme`
 * 4. hyphenated without a trailing legal suffix → `acme`
 *
 * Duplicates collapse (a one-word name yields exactly one candidate), and
 * anything a watchlist slug could not be is dropped.
 */
export function deriveBoardSlugs(name: string): string[] {
  const cleaned = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    // Combining marks left behind by the decomposition ("é" → "e" + U+0301).
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  if (!cleaned) return []

  const words = cleaned.split(" ")
  const last = words[words.length - 1]
  const withoutSuffix =
    words.length > 1 && last && LEGAL_SUFFIXES.has(last) ? words.slice(0, -1) : words

  const candidates = [
    words.join(""),
    words.join("-"),
    withoutSuffix.join(""),
    withoutSuffix.join("-"),
  ]

  const slugs: string[] = []
  for (const candidate of candidates) {
    if (!candidate || slugs.includes(candidate)) continue
    if (candidate.length > MAX_ATS_SLUG_LENGTH) continue
    if (!ATS_SLUG_PATTERN.test(candidate)) continue
    slugs.push(candidate)
  }

  return slugs.slice(0, MAX_BOARD_SLUG_CANDIDATES)
}

/** One company board that exists, and how many roles it is currently publishing. */
export interface BoardProbeHit {
  provider: ProbedProviderId
  slug: string
  postingCount: number
}

/** Counts a board's published postings, or null when the shape is not the one documented. */
function countGreenhouse(body: unknown): number | null {
  if (!body || typeof body !== "object") return null
  const jobs = (body as { jobs?: unknown }).jobs
  return Array.isArray(jobs) ? jobs.length : null
}

function countLever(body: unknown): number | null {
  return Array.isArray(body) ? body.length : null
}

function countAshby(body: unknown): number | null {
  if (!body || typeof body !== "object") return null
  const jobs = (body as { jobs?: unknown }).jobs
  if (!Array.isArray(jobs)) return null
  // The same `isListed === false` the adapter drops: an unlisted posting is not
  // something the user would find on the board.
  return jobs.filter(
    (job) => !job || typeof job !== "object" || (job as { isListed?: unknown }).isListed !== false
  ).length
}

/**
 * How many `<li class="heading">` posting blocks a Freshteam board page has.
 *
 * Freshteam answers *every* subdomain with HTTP 200, so a status code proves
 * nothing: an unclaimed one serves an 889-byte "We couldn't find …" page that
 * still mentions Freshteam. Verified live on 2026-09-14 with
 * `kumu.freshteam.com/jobs`, which is not a board. A hit therefore needs a
 * positive marker of the careers portal itself — its search form or its job
 * list — and not merely the word "freshteam". A real board with no open roles
 * still renders the search form, so it is still reported, as it is for the
 * other providers.
 */
function countFreshteam(html: string): number | null {
  if (!/class="job-search-form"|class="job-list"/.test(html)) return null
  const blocks = html.match(/<li class="heading">/g)
  return blocks ? blocks.length : 0
}

function countBambooHr(body: unknown): number | null {
  if (!body || typeof body !== "object") return null
  const result = (body as { result?: unknown }).result
  return Array.isArray(result) ? result.length : null
}

/**
 * The five list endpoints, which are the same ones the source adapters call.
 * Ashby is asked without `includeCompensation` — a probe only needs the count.
 * Freshteam alone answers HTML, so it declares `html: true` and is counted from
 * the markup rather than from JSON.
 */
const PROBES: Array<{
  provider: ProbedProviderId
  url: (slug: string) => string
  count: (body: unknown) => number | null
  /** The response is a page, so `count` is handed the raw text instead of parsed JSON. */
  html?: boolean
}> = [
  {
    provider: GREENHOUSE_PROVIDER_ID,
    url: (slug) => `${GREENHOUSE_ENDPOINT}/${encodeURIComponent(slug)}/jobs`,
    count: countGreenhouse,
  },
  {
    provider: LEVER_PROVIDER_ID,
    url: (slug) => `${LEVER_ENDPOINT}/${encodeURIComponent(slug)}?mode=json`,
    count: countLever,
  },
  {
    provider: ASHBY_PROVIDER_ID,
    url: (slug) => `${ASHBY_ENDPOINT}/${encodeURIComponent(slug)}`,
    count: countAshby,
  },
  {
    provider: BAMBOOHR_PROVIDER_ID,
    url: bamboohrBoardUrl,
    count: countBambooHr,
  },
  {
    provider: FRESHTEAM_PROVIDER_ID,
    url: freshteamBoardUrl,
    count: (body) => countFreshteam(typeof body === "string" ? body : ""),
    html: true,
  },
]

/** One provider × one slug. Never rejects: a dead endpoint is simply not a hit. */
async function probeOne(
  probe: (typeof PROBES)[number],
  slug: string,
  signal: AbortSignal
): Promise<BoardProbeHit | null> {
  // Two of the five put the slug in a subdomain, where a path escape would not
  // save a malformed slug. `deriveBoardSlugs` already only emits safe ones; this
  // is the guard that says so at the point the host is built.
  if (!BAMBOOHR_SAFE_SLUG.test(slug)) return null

  try {
    const response = await fetch(probe.url(slug), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(BOARD_PROBE_TIMEOUT_MS)]),
      cache: "no-store",
      headers: {
        accept: probe.html ? "text/html" : "application/json",
        "user-agent": USER_AGENT,
      },
    })

    // 404 is the expected answer for a slug that is not a board, so it is not
    // logged as a problem — it is most of what this function returns.
    if (!response.ok) return null

    const declared = Number(response.headers.get("content-length") ?? "")
    if (Number.isFinite(declared) && declared > MAX_PROBE_RESPONSE_BYTES) return null

    const text = await response.text()
    if (text.length > MAX_PROBE_RESPONSE_BYTES) return null

    const postingCount = probe.count(probe.html ? text : (JSON.parse(text) as unknown))
    if (postingCount === null) return null

    return { provider: probe.provider, slug, postingCount }
  } catch (err) {
    log.warn("Board probe failed", { err, provider: probe.provider, slug })
    return null
  }
}

/** Provider order for equally-sized hits, so the list is stable between calls. */
const PROVIDER_ORDER: ProbedProviderId[] = [
  GREENHOUSE_PROVIDER_ID,
  LEVER_PROVIDER_ID,
  ASHBY_PROVIDER_ID,
  BAMBOOHR_PROVIDER_ID,
  FRESHTEAM_PROVIDER_ID,
]

/**
 * Probes every candidate slug against all five providers and returns the boards
 * that answered. A board with zero open roles is still a hit: the endpoint
 * answering means the slug is real, which is the thing the user is looking for.
 */
export async function probeBoards(slugs: string[], signal: AbortSignal): Promise<BoardProbeHit[]> {
  if (slugs.length === 0) return []

  const settled = await Promise.allSettled(
    slugs.flatMap((slug) => PROBES.map((probe) => probeOne(probe, slug, signal)))
  )

  const hits: BoardProbeHit[] = []
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) hits.push(result.value)
    else if (result.status === "rejected") log.warn("A board probe rejected", { err: result.reason })
  }

  hits.sort(
    (a, b) =>
      b.postingCount - a.postingCount ||
      PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider) ||
      a.slug.localeCompare(b.slug)
  )

  return hits
}
