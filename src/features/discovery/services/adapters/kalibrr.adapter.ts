import { logger } from "@/shared/lib/logger"
import { providerLabel } from "../../constants/providers"
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types"

/**
 * Kalibrr source adapter — Philippine job board.
 *
 * Kalibrr's own job board UI is backed by a key-less JSON endpoint
 * (`GET https://www.kalibrr.com/kjs/job_board/search?limit=…&offset=0&text=…`)
 * whose response is `{ count, jobs: [...] }`. Each job carries `id` (number),
 * `name` (the title), `slug`, `company` (`{ code, name, … }`), `company_name`,
 * `activation_date` (ISO with zone), `description` (HTML), `google_location`
 * (`{ address_components: { city, region, country } }`), the
 * `is_work_from_home` / `is_hybrid` flags and the `base_salary` /
 * `maximum_salary` / `salary_currency` / `salary_interval` / `salary_shown`
 * group. Verified live on 2026-09-13 against the real endpoint.
 *
 * The `text` parameter is a real server-side search — a "Web Developer" probe
 * returned 25 titles that all carried one of the query's words — so unlike
 * Arbeitnow there is no local `matchesQuery` pass; re-filtering would only
 * discard results the source already judged relevant.
 *
 * Source etiquette: exactly one request per query, a capped `limit`, no
 * pagination walk, no HTML page scraping, and a User-Agent that says who is
 * calling. `robots.txt` disallows only `/root` and `/candidate/profile`.
 * Everything it returns is untrusted input.
 */

const log = logger("discovery")

const KALIBRR_ENDPOINT = "https://www.kalibrr.com/kjs/job_board/search"

/** Stored on saved jobs as `sourceProvider`. */
export const KALIBRR_PROVIDER_ID = "kalibrr"

/** Per-query ceiling. One page, never walked. */
export const KALIBRR_RESULT_LIMIT = 25

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

interface KalibrrJob {
  id?: unknown
  name?: unknown
  slug?: unknown
  company?: unknown
  company_name?: unknown
  activation_date?: unknown
  description?: unknown
  google_location?: unknown
  is_work_from_home?: unknown
  is_hybrid?: unknown
  base_salary?: unknown
  maximum_salary?: unknown
  salary_currency?: unknown
  salary_interval?: unknown
  salary_shown?: unknown
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/** `google_location` is `{ address_components: { city, region, country } }`. */
export function kalibrrLocation(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const components = (value as { address_components?: unknown }).address_components
  if (!components || typeof components !== "object") return undefined
  const { city, region, country } = components as Record<string, unknown>
  const parts = [asString(city), asString(region), asString(country)].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : undefined
}

/**
 * The salary group as one free-text line, but only when `salary_shown` is true:
 * live postings carry a `maximum_salary` alongside `salary_shown: false`, which
 * is the employer asking for the figure not to be published.
 */
export function kalibrrSalaryText(job: KalibrrJob): string | undefined {
  if (job.salary_shown !== true) return undefined
  const min = asString(job.base_salary)
  const max = asString(job.maximum_salary)
  if (!min && !max) return undefined

  const range = min && max ? (min === max ? min : `${min} - ${max}`) : (min ?? max)
  const currency = asString(job.salary_currency)
  const interval = asString(job.salary_interval)
  return [currency, range, interval && `/ ${interval}`].filter(Boolean).join(" ")
}

/**
 * Kalibrr states the arrangement as two booleans rather than a word. Both false
 * is a real answer on this board — the posting carries a street address — so it
 * maps to onsite rather than being left unstated.
 */
export function kalibrrWorkTypeHint(job: KalibrrJob): string {
  if (job.is_hybrid === true) return "hybrid"
  if (job.is_work_from_home === true) return "remote"
  return "onsite"
}

/**
 * The public posting URL. Verified live on 2026-09-13: two constructed URLs
 * returned 200 with no redirect and the expected job title.
 */
export function kalibrrJobUrl(companyCode: string, id: string, slug: string): string {
  return `https://www.kalibrr.com/c/${companyCode}/jobs/${id}/${slug}`
}

/**
 * Maps one entry of the `jobs` array. Returns null when the entry is missing an
 * id, title, company or the parts the posting URL is built from — a posting
 * without those cannot become a job, and a provider shape change should thin
 * the list rather than crash the run.
 */
export function mapKalibrrJob(job: KalibrrJob): RawPosting | null {
  const externalId = asString(job.id)
  const title = asString(job.name)
  const slug = asString(job.slug)
  const company = (job.company ?? {}) as { code?: unknown; name?: unknown }
  const companyCode = asString(company.code)
  const companyName = asString(company.name) ?? asString(job.company_name)
  if (!externalId || !title || !slug || !companyCode || !companyName) return null

  return {
    provider: KALIBRR_PROVIDER_ID,
    externalId,
    title,
    companyName,
    url: kalibrrJobUrl(companyCode, externalId, slug),
    location: kalibrrLocation(job.google_location),
    workTypeHint: kalibrrWorkTypeHint(job),
    salaryText: kalibrrSalaryText(job),
    // Still HTML — `normalizePosting` strips and caps it.
    description: asString(job.description),
    postedAt: asString(job.activation_date),
    raw: job as Record<string, unknown>,
  }
}

/** Pulls the `jobs` array out of a response body, or null if it is not there. */
export function parseKalibrrResponse(body: unknown): RawPosting[] | null {
  if (!body || typeof body !== "object") return null
  const jobs = (body as { jobs?: unknown }).jobs
  if (!Array.isArray(jobs)) return null

  const postings: RawPosting[] = []
  for (const job of jobs) {
    if (!job || typeof job !== "object") continue
    const mapped = mapKalibrrJob(job as KalibrrJob)
    if (mapped) postings.push(mapped)
  }
  return postings
}

function buildSearchTerm(query: DiscoveryQuery): string {
  return [query.role, ...(query.keywords ?? [])]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
}

export const kalibrrAdapter: SourceAdapter = {
  id: KALIBRR_PROVIDER_ID,
  label: providerLabel(KALIBRR_PROVIDER_ID),

  async search(query, signal) {
    const text = buildSearchTerm(query)
    if (!text) return []

    const url = new URL(KALIBRR_ENDPOINT)
    url.searchParams.set("limit", String(KALIBRR_RESULT_LIMIT))
    url.searchParams.set("offset", "0")
    url.searchParams.set("text", text)

    try {
      const response = await fetch(url, {
        signal,
        cache: "no-store",
        headers: { accept: "application/json", "user-agent": USER_AGENT },
      })

      if (!response.ok) {
        log.warn("Kalibrr search returned a non-OK status", { status: response.status, text })
        return []
      }

      const body: unknown = await response.json()
      const postings = parseKalibrrResponse(body)
      if (postings === null) {
        log.warn("Kalibrr response shape was not recognised", { text })
        return []
      }

      return postings.slice(0, KALIBRR_RESULT_LIMIT)
    } catch (err) {
      // Includes the AbortError from the caller's timeout. A dead source costs
      // the user an empty list, never an error screen.
      log.warn("Kalibrr search failed", { err, text })
      return []
    }
  },
}
