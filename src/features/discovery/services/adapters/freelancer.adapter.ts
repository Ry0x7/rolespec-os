import { logger } from "@/shared/lib/logger"
import { providerLabel } from "../../constants/providers"
import type { DiscoveryQuery, RawPosting, SourceAdapter } from "../../types"

/**
 * Freelancer.com source adapter — client projects, not employer job ads.
 *
 * Freelancer publishes a key-less, read-only search over open projects:
 * `GET https://www.freelancer.com/api/projects/0.1/projects/active/?query=…`
 * which answers `{ status: "success", result: { projects: [...], total_count } }`.
 * Each project carries `id` (number), `title`, `seo_url`
 * ("zapier/Integrasi-Gmail-WhatsApp-Instagram"), `description` (plain text with
 * `full_description=true`), `type` ("fixed" | "hourly"), `budget`
 * ({ minimum, maximum }), `currency` ({ code, sign }), `time_submitted` (Unix
 * seconds), `local` (boolean; an on-site job), `location` ({ country: { name },
 * city }) and, with `job_details=true`, `jobs` (skill tags, `{ id, name }`).
 * The public page for a project is `https://www.freelancer.com/projects/{seo_url}`.
 * Verified live on 2026-11-27: the endpoint answered without a key, three
 * projects came back for "n8n automation", and the project page returned 200.
 *
 * Projects never name the client (`owner_id` is null on the public read), so a
 * lead says plainly that the client is a Freelancer.com buyer rather than
 * inventing a company. The search is loose — a "n8n automation" query also
 * returned an embedded-hardware project — which is why the client finder
 * scores every lead against the service before it is shown.
 *
 * Source etiquette: `robots.txt` does not disallow `/api/`. One request per
 * query, a capped `limit`, no pagination walk and a User-Agent that says who is
 * calling. Everything it returns is untrusted input.
 */

const log = logger("discovery")

const FREELANCER_ENDPOINT = "https://www.freelancer.com/api/projects/0.1/projects/active/"
const FREELANCER_PROJECT_ORIGIN = "https://www.freelancer.com/projects/"

/** Stored on saved jobs as `sourceProvider`. */
export const FREELANCER_PROVIDER_ID = "freelancer"

/** Per-query ceiling. One page, never walked. */
export const FREELANCER_RESULT_LIMIT = 25

/** The public read hides the buyer, so a lead names the marketplace instead. */
export const FREELANCER_CLIENT_NAME = "Freelancer.com client"

const USER_AGENT = "RoleSpec-Discovery/1.0 (+https://rolespec.app; client discovery for one user)"

interface FreelancerProject {
  id?: unknown
  title?: unknown
  seo_url?: unknown
  description?: unknown
  preview_description?: unknown
  type?: unknown
  budget?: { minimum?: unknown; maximum?: unknown } | null
  currency?: { code?: unknown; sign?: unknown } | null
  time_submitted?: unknown
  local?: unknown
  location?: { country?: { name?: unknown } | null; city?: unknown } | null
  jobs?: unknown
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

function asAmount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/**
 * "$15–25 USD per hour" / "$250–750 USD fixed price". Built only from the
 * project's own budget fields, so the salary parser downstream reads the
 * buyer's numbers and nothing else. No budget → no salary text.
 */
export function freelancerBudgetText(project: FreelancerProject): string | undefined {
  const min = asAmount(project.budget?.minimum)
  const max = asAmount(project.budget?.maximum)
  if (min === undefined && max === undefined) return undefined
  const sign = asString(project.currency?.sign) ?? ""
  const code = asString(project.currency?.code)
  const range =
    min !== undefined && max !== undefined && max !== min
      ? `${sign}${formatAmount(min)}–${formatAmount(max)}`
      : `${min === undefined ? "up to " : max === undefined ? "from " : ""}${sign}${formatAmount((min ?? max)!)}`
  const unit = project.type === "hourly" ? "per hour" : "fixed price"
  return [range, code, unit].filter(Boolean).join(" ")
}

function skillNames(jobs: unknown): string[] {
  if (!Array.isArray(jobs)) return []
  return jobs
    .map((job) => (job && typeof job === "object" ? asString((job as { name?: unknown }).name) : undefined))
    .filter((name): name is string => Boolean(name))
}

/**
 * Maps one project. Returns null without an id, title or page slug — a project
 * without those cannot become a lead the user can open, and a shape change
 * should thin the list rather than crash the run.
 */
export function mapFreelancerProject(project: FreelancerProject): RawPosting | null {
  const externalId = asString(project.id)
  const title = asString(project.title)
  const slug = asString(project.seo_url)
  if (!externalId || !title || !slug) return null

  const isLocal = project.local === true
  const city = asString(project.location?.city)
  const country = asString(project.location?.country?.name)
  const place = [city, country].filter(Boolean).join(", ")
  const skills = skillNames(project.jobs)
  const body = asString(project.description) ?? asString(project.preview_description)
  const description = [body, skills.length > 0 ? `Skills requested: ${skills.join(", ")}` : undefined]
    .filter(Boolean)
    .join("\n\n")

  const submitted = typeof project.time_submitted === "number" && Number.isFinite(project.time_submitted)
    ? new Date(project.time_submitted * 1000).toISOString()
    : undefined

  return {
    provider: FREELANCER_PROVIDER_ID,
    externalId,
    title,
    companyName: FREELANCER_CLIENT_NAME,
    url: `${FREELANCER_PROJECT_ORIGIN}${slug.split("/").map(encodeURIComponent).join("/")}`,
    location: isLocal ? place || "On-site (location in the project)" : place ? `Remote · client in ${place}` : "Remote",
    workTypeHint: isLocal ? "onsite" : "remote",
    salaryText: freelancerBudgetText(project),
    description: description || undefined,
    postedAt: submitted,
    raw: {
      type: asString(project.type) ?? null,
      local: isLocal,
      skills,
    },
  }
}

/** Pulls the project list out of a response body, or null if it is not there. */
export function parseFreelancerResponse(body: unknown): RawPosting[] | null {
  if (!body || typeof body !== "object") return null
  const result = (body as { result?: unknown }).result
  if (!result || typeof result !== "object") return null
  const projects = (result as { projects?: unknown }).projects
  if (!Array.isArray(projects)) return null

  const postings: RawPosting[] = []
  for (const project of projects) {
    if (!project || typeof project !== "object") continue
    const mapped = mapFreelancerProject(project as FreelancerProject)
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

export const freelancerAdapter: SourceAdapter = {
  id: FREELANCER_PROVIDER_ID,
  label: providerLabel(FREELANCER_PROVIDER_ID),

  async search(query, signal) {
    const search = buildSearchTerm(query)
    if (!search) return []

    const url = new URL(FREELANCER_ENDPOINT)
    url.searchParams.set("query", search)
    url.searchParams.set("limit", String(FREELANCER_RESULT_LIMIT))
    url.searchParams.set("full_description", "true")
    url.searchParams.set("job_details", "true")

    try {
      const response = await fetch(url, {
        signal,
        cache: "no-store",
        headers: { accept: "application/json", "user-agent": USER_AGENT },
      })

      if (!response.ok) {
        log.warn("Freelancer search returned a non-OK status", { status: response.status, search })
        return []
      }

      const postings = parseFreelancerResponse(await response.json())
      if (postings === null) {
        log.warn("Freelancer response shape was not recognised", { search })
        return []
      }
      return postings.slice(0, FREELANCER_RESULT_LIMIT)
    } catch (err) {
      // Includes the AbortError from the caller's timeout. A dead source costs
      // the user an empty list, never an error screen.
      log.warn("Freelancer search failed", { err, search })
      return []
    }
  },
}
