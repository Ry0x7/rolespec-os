import { logger } from "@/shared/lib/logger"
import { ATS_SLUG_PATTERN, MAX_ATS_SLUG_LENGTH } from "@/features/settings/schemas/preferences.schema"

import {
  ASHBY_ENDPOINT,
  ASHBY_PROVIDER_ID,
  findAshbyJobById,
} from "./adapters/ashby.adapter"
import {
  GREENHOUSE_ENDPOINT,
  GREENHOUSE_PROVIDER_ID,
  mapGreenhouseJob,
  type GreenhouseJob,
} from "./adapters/greenhouse.adapter"
import { LEVER_ENDPOINT, LEVER_PROVIDER_ID, mapLeverPosting, type LeverPosting } from "./adapters/lever.adapter"
import {
  BAMBOOHR_PROVIDER_ID,
  BAMBOOHR_SAFE_SLUG,
  bamboohrPostingUrl,
  parseBambooHrPosting,
} from "./adapters/bamboohr.adapter"
import { FRESHTEAM_PROVIDER_ID } from "./adapters/freshteam.adapter"
import {
  WORKDAY_PROVIDER_ID,
  parseWorkdayPosting,
  workdayPostingUrl,
} from "./adapters/workday.adapter"
import {
  parseWorkdayBoardUrl,
  parseWorkdayExternalPath,
  type WorkdayBoard,
} from "../constants/workday-board"
import type { RawPosting } from "../types"

/**
 * Recognising a posting URL that belongs to an ATS RoleSpec already speaks to,
 * and reading that posting from the ATS's own public API instead of its page.
 *
 * The reason is empirical: Greenhouse and Ashby job pages are client-rendered,
 * so the HTML add-by-URL fetches carries a title and almost no body (13
 * characters for the GitLab posting recorded in the handoff), while the same
 * posting is fully published on a free, key-less endpoint. Using it also keeps
 * the provenance honest — the candidate is stored under the real provider id
 * with the ATS's own posting id, not as an anonymous "web" row.
 *
 * This path is an optimisation, never a requirement: every function here
 * returns null instead of throwing, and the caller falls back to the HTML
 * extraction it would have done anyway. It must never make add-by-URL worse
 * than it was.
 *
 * The hosts below are fixed constants, so the SSRF guard that add-by-URL runs
 * on user input has nothing to decide here; the user's URL is still validated
 * by `parsePostingUrl` before anything in this file is consulted.
 */

const log = logger("discovery")

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

/**
 * The ATS providers RoleSpec speaks to. Every one of them is a watchlist
 * section; not every one of them has a recognisable single-posting URL —
 * Freshteam is here because it is a source and a probe target, and its posting
 * pages are deliberately left to the HTML path (see {@link recognizeAtsPostingUrl}).
 */
export type AtsProviderId =
  | typeof GREENHOUSE_PROVIDER_ID
  | typeof LEVER_PROVIDER_ID
  | typeof ASHBY_PROVIDER_ID
  | typeof BAMBOOHR_PROVIDER_ID
  | typeof FRESHTEAM_PROVIDER_ID
  | typeof WORKDAY_PROVIDER_ID

/** Enough to ask an ATS for exactly one posting. */
export interface AtsPostingRef {
  provider: AtsProviderId
  /** The company's board id, lowercased. For Workday this is the tenant. */
  slug: string
  /**
   * The ATS's own posting id: numeric for Greenhouse and BambooHR, a uuid for
   * Lever and Ashby, the `externalPath` for Workday.
   */
  postingId: string
  /** Workday only: the three parts its API needs, which a slug cannot carry. */
  board?: WorkdayBoard
}

/**
 * Greenhouse's board hosts, including the EU-resident ones. EU tenant boards are
 * served by the same `boards-api.greenhouse.io` origin — verified live on
 * 2026-09-11 against the proton board, whose postings live on
 * `job-boards.eu.greenhouse.io`; there is no separate EU API origin.
 */
const GREENHOUSE_BOARD_HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "boards.eu.greenhouse.io",
  "job-boards.eu.greenhouse.io",
])

const LEVER_BOARD_HOST = "jobs.lever.co"
const ASHBY_BOARD_HOST = "jobs.ashbyhq.com"

/** `{slug}.bamboohr.com` — the slug is the subdomain, not a path segment. */
const BAMBOOHR_HOST = /^([a-z0-9][a-z0-9-]*)\.bamboohr\.com$/

const NUMERIC_ID = /^\d+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A path segment is only a board slug if it could also have been typed into the watchlist. */
function asSlug(segment: string | undefined): string | null {
  const slug = (segment ?? "").toLowerCase()
  if (!slug || slug.length > MAX_ATS_SLUG_LENGTH) return null
  return ATS_SLUG_PATTERN.test(slug) ? slug : null
}

/**
 * `{ provider, slug, postingId }` for a URL that is a known ATS posting page, or
 * null for everything else — including URLs on those hosts that do not name a
 * single posting (a board root, an unrecognised path shape).
 *
 * `gh_jid={id}` names a Greenhouse posting on a company's own careers domain
 * (`stripe.com/jobs/search?gh_jid=8172487` is what the Stripe board itself
 * publishes). The API is keyed on the board slug, which such a URL does not
 * carry, so a foreign host is not recognised at all and keeps the HTML path. On
 * a Greenhouse host the slug is in the path, so the param is usable there.
 */
export function recognizeAtsPostingUrl(url: URL): AtsPostingRef | null {
  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "")
  const segments = url.pathname.split("/").filter(Boolean)

  if (GREENHOUSE_BOARD_HOSTS.has(host)) {
    const slug = asSlug(segments[0])
    if (!slug) return null

    const pathId = segments[2]
    if (segments[1] === "jobs" && pathId && NUMERIC_ID.test(pathId)) {
      return { provider: GREENHOUSE_PROVIDER_ID, slug, postingId: pathId }
    }

    const queryId = url.searchParams.get("gh_jid")
    if (queryId && NUMERIC_ID.test(queryId)) {
      return { provider: GREENHOUSE_PROVIDER_ID, slug, postingId: queryId }
    }

    return null
  }

  if (host === LEVER_BOARD_HOST) {
    const slug = asSlug(segments[0])
    const postingId = segments[1]
    if (!slug || !postingId || !UUID.test(postingId)) return null
    return { provider: LEVER_PROVIDER_ID, slug, postingId: postingId.toLowerCase() }
  }

  if (host === ASHBY_BOARD_HOST) {
    const slug = asSlug(segments[0])
    const postingId = segments[1]
    if (!slug || !postingId || !UUID.test(postingId)) return null
    return { provider: ASHBY_PROVIDER_ID, slug, postingId: postingId.toLowerCase() }
  }

  // `{slug}.bamboohr.com/careers/{id}` — `/careers/{id}/detail` is the JSON form
  // of the same posting and is what `fetchAtsPosting` asks for.
  const bamboo = BAMBOOHR_HOST.exec(host)
  if (bamboo) {
    const slug = bamboo[1]
    if (!slug || !BAMBOOHR_SAFE_SLUG.test(slug) || slug.length > MAX_ATS_SLUG_LENGTH) return null
    const postingId = segments[1]
    if (segments[0] !== "careers" || !postingId || !NUMERIC_ID.test(postingId)) return null
    return { provider: BAMBOOHR_PROVIDER_ID, slug, postingId }
  }

  if (host.endsWith(".myworkdayjobs.com")) {
    const board = parseWorkdayBoardUrl(url.toString())
    const externalPath = parseWorkdayExternalPath(url)
    if (!board || !externalPath) return null
    return {
      provider: WORKDAY_PROVIDER_ID,
      slug: board.tenant,
      postingId: externalPath,
      board,
    }
  }

  // Freshteam is deliberately not recognised. Its rich single-posting JSON lives
  // under `/hire/widgets/`, which its own `robots.txt` disallows; the posting
  // page at `/jobs/{id}/{slug}` is allowed and is server-rendered with the whole
  // body, so the existing HTML extraction is both the compliant path and the
  // better one.
  return null
}

/**
 * Its own budget rather than the caller's whole one: if the ATS is slow, the
 * HTML fallback still has time to run inside add-by-URL's 10s ceiling.
 */
export const ATS_API_TIMEOUT_MS = 5_000

/**
 * Ashby has no single-posting endpoint, so the whole board comes back — a few
 * hundred KB for a small company and megabytes for a large one. This is the
 * point past which reading it costs more than the HTML page would.
 */
export const MAX_ATS_RESPONSE_BYTES = 8 * 1024 * 1024

/**
 * One JSON GET against a fixed ATS host. Returns null for anything that is not
 * a parsed, in-budget success — the caller treats every null the same way.
 */
async function getAtsJson(url: string, signal: AbortSignal): Promise<unknown | null> {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(ATS_API_TIMEOUT_MS)]),
    cache: "no-store",
    headers: { accept: "application/json", "user-agent": USER_AGENT },
  })

  if (!response.ok) {
    log.warn("ATS posting API returned a non-OK status", { status: response.status, url })
    return null
  }

  const declared = Number(response.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > MAX_ATS_RESPONSE_BYTES) return null

  const text = await response.text()
  // A char is at least one byte, so this cannot under-count the payload.
  if (text.length > MAX_ATS_RESPONSE_BYTES) return null

  return JSON.parse(text) as unknown
}

/**
 * Reads one posting from its ATS's public API, or returns null so the caller
 * falls back to fetching the page.
 *
 * Endpoint forms, each verified live on 2026-09-09:
 * - `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{id}` — one job
 *   object with `content` (entity-escaped HTML), 404 for an unknown id.
 * - `GET https://api.lever.co/v0/postings/{slug}/{id}` — one posting object
 *   with `descriptionPlain`, 404 for an unknown id.
 * - `GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`
 *   — the whole board; the posting is found by id.
 *
 * Added on 2026-09-14, each verified live the same day:
 * - `GET https://{slug}.bamboohr.com/careers/{id}/detail` — `result.jobOpening`
 *   with `description` (HTML) and `datePosted`, neither of which the board list
 *   carries.
 * - `GET https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{externalPath}`
 *   — `jobPostingInfo` with `jobDescription` (HTML).
 *
 * Everything the ATS returns is untrusted input and goes through the same
 * mappers the source adapters use, so a shape change thins the result rather
 * than crashing the add.
 */
export async function fetchAtsPosting(
  ref: AtsPostingRef,
  signal: AbortSignal
): Promise<RawPosting | null> {
  const slug = encodeURIComponent(ref.slug)
  const postingId = encodeURIComponent(ref.postingId)

  try {
    if (ref.provider === GREENHOUSE_PROVIDER_ID) {
      const body = await getAtsJson(`${GREENHOUSE_ENDPOINT}/${slug}/jobs/${postingId}`, signal)
      if (!body || typeof body !== "object") return null
      return mapGreenhouseJob(body as GreenhouseJob, ref.slug)
    }

    if (ref.provider === LEVER_PROVIDER_ID) {
      const body = await getAtsJson(`${LEVER_ENDPOINT}/${slug}/${postingId}`, signal)
      if (!body || typeof body !== "object" || Array.isArray(body)) return null
      return mapLeverPosting(body as LeverPosting, ref.slug)
    }

    if (ref.provider === BAMBOOHR_PROVIDER_ID) {
      const body = await getAtsJson(bamboohrPostingUrl(ref.slug, ref.postingId), signal)
      return parseBambooHrPosting(body, ref.slug, ref.postingId)
    }

    if (ref.provider === WORKDAY_PROVIDER_ID) {
      if (!ref.board) return null
      const body = await getAtsJson(workdayPostingUrl(ref.board, ref.postingId), signal)
      return parseWorkdayPosting(body, ref.board, ref.postingId)
    }

    // Freshteam never produces a ref, so the remaining provider is Ashby.
    if (ref.provider !== ASHBY_PROVIDER_ID) return null

    const body = await getAtsJson(`${ASHBY_ENDPOINT}/${slug}?includeCompensation=true`, signal)
    return findAshbyJobById(body, ref.slug, ref.postingId)
  } catch (err) {
    // Includes the abort from either budget and a body that is not JSON. A dead
    // ATS costs the user the richer description, never the add itself.
    log.warn("ATS posting lookup failed", { err, provider: ref.provider, slug: ref.slug })
    return null
  }
}
