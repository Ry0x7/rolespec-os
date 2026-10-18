import { logger } from "@/shared/lib/logger"
import { providerLabel } from "../../constants/providers"
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types"

/**
 * Remotive source adapter.
 *
 * Remotive publishes a free, key-less JSON endpoint
 * (`GET https://remotive.com/api/remote-jobs?search=…&limit=…`) whose response
 * is `{ "0-legal-notice", "job-count", "total-job-count", jobs: [...] }`. Each
 * job carries `id` (number), `url`, `title`, `company_name`, `category`,
 * `tags`, `job_type` ("full_time"), `publication_date`
 * ("2026-08-27T14:36:09", no zone), `candidate_required_location`, `salary`
 * (free text, often empty) and `description` (HTML). Verified live on
 * 2026-09-01 against the real endpoint.
 *
 * Source etiquette: exactly one request per query, a server-side capped
 * `limit`, no pagination walk, no HTML page scraping, and a User-Agent that
 * says who is calling. Everything it returns is untrusted input.
 */

const log = logger("discovery")

const REMOTIVE_ENDPOINT = "https://remotive.com/api/remote-jobs"

/** Stored on saved jobs as `sourceProvider`. */
export const REMOTIVE_PROVIDER_ID = "remotive"

/** Per-query ceiling. One page, never walked. */
export const REMOTIVE_RESULT_LIMIT = 25

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; job discovery for one user)"

/** Remotive lists remote roles only, so the work type is known up front. */
const REMOTIVE_WORK_TYPE_HINT = "remote"

interface RemotiveJob {
  id?: unknown
  url?: unknown
  title?: unknown
  company_name?: unknown
  candidate_required_location?: unknown
  salary?: unknown
  description?: unknown
  publication_date?: unknown
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/**
 * Maps one entry of the `jobs` array. Returns null when the entry is missing an
 * id, title, company or URL — a posting without those cannot become a job, and
 * a provider shape change should thin the list rather than crash the run.
 */
export function mapRemotiveJob(job: RemotiveJob): RawPosting | null {
  const externalId = asString(job.id)
  const title = asString(job.title)
  const companyName = asString(job.company_name)
  const url = asString(job.url)
  if (!externalId || !title || !companyName || !url) return null

  return {
    provider: REMOTIVE_PROVIDER_ID,
    externalId,
    title,
    companyName,
    url,
    location: asString(job.candidate_required_location),
    workTypeHint: REMOTIVE_WORK_TYPE_HINT,
    salaryText: asString(job.salary),
    description: asString(job.description),
    postedAt: asString(job.publication_date),
    raw: job as Record<string, unknown>,
  }
}

/** Pulls the `jobs` array out of a response body, or null if it is not there. */
export function parseRemotiveResponse(body: unknown): RawPosting[] | null {
  if (!body || typeof body !== "object") return null
  const jobs = (body as { jobs?: unknown }).jobs
  if (!Array.isArray(jobs)) return null

  const postings: RawPosting[] = []
  for (const job of jobs) {
    if (!job || typeof job !== "object") continue
    const mapped = mapRemotiveJob(job as RemotiveJob)
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

export const remotiveAdapter: SourceAdapter = {
  id: REMOTIVE_PROVIDER_ID,
  label: providerLabel(REMOTIVE_PROVIDER_ID),

  async search(query, signal) {
    const search = buildSearchTerm(query)
    if (!search) return []

    const url = new URL(REMOTIVE_ENDPOINT)
    url.searchParams.set("search", search)
    url.searchParams.set("limit", String(REMOTIVE_RESULT_LIMIT))

    try {
      const response = await fetch(url, {
        signal,
        cache: "no-store",
        headers: { accept: "application/json", "user-agent": USER_AGENT },
      })

      if (!response.ok) {
        log.warn("Remotive search returned a non-OK status", {
          status: response.status,
          search,
        })
        return []
      }

      const body: unknown = await response.json()
      const postings = parseRemotiveResponse(body)
      if (postings === null) {
        log.warn("Remotive response shape was not recognised", { search })
        return []
      }

      return postings.slice(0, REMOTIVE_RESULT_LIMIT)
    } catch (err) {
      // Includes the AbortError from the caller's timeout. A dead source costs
      // the user an empty list, never an error screen.
      log.warn("Remotive search failed", { err, search })
      return []
    }
  },
}
