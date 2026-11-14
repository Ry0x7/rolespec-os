import type { ExperienceLevel, WorkType } from "@/generated/prisma/enums"

/**
 * One Career Profile target role → ready-to-open search URLs on the job boards
 * the user already uses. Nothing is fetched: the user clicks a link and runs the
 * search themselves, on the board, signed in as themselves.
 *
 * The query carries the role title plus the user's own confirmed capability
 * names — never text read out of a posting — so nothing here can become
 * evidence of a qualification.
 */

export type JobBoard = "LINKEDIN" | "INDEED" | "JOBSTREET"

/** The subset of a Career Profile this needs — keeps the function testable. */
export interface BoardSearchInput {
  /** One target-role title, already trimmed. */
  role: string
  /** Confirmed capability names; the caller caps them. */
  keywords: string[]
  /** `profile.locations` as stored. */
  locations: string[]
  workModes: WorkType[]
  experienceLevel: ExperienceLevel | null
}

export interface BoardSearchLink {
  board: JobBoard
  /** "LinkedIn" | "Indeed (PH)" / "Indeed" | "JobStreet (PH)" */
  label: string
  /** What the user would type in that board's search box. */
  query: string
  /** The location term sent, or null. */
  location: string | null
  /** Absolute https URL. */
  url: string
}

/** The most capability names one board query may carry. */
export const MAX_BOARD_KEYWORDS = 4

/** The pseudo-location the profile picker offers for "anywhere, remotely". */
const REMOTE_ANYWHERE = "remote (anywhere)"

/** LinkedIn's geoId for "Worldwide". */
const LINKEDIN_WORLDWIDE_GEO_ID = "92000000"

/** LinkedIn `f_WT` codes. */
const LINKEDIN_WORK_TYPE: Record<WorkType, string> = {
  ONSITE: "1",
  REMOTE: "2",
  HYBRID: "3",
}

/** LinkedIn `f_E` codes. JUNIOR spans "Entry level" and "Associate". */
const LINKEDIN_EXPERIENCE: Record<ExperienceLevel, string> = {
  JUNIOR: "2,3",
  MID: "4",
  SENIOR: "4",
  LEAD: "5",
  EXECUTIVE: "6",
}

/** Indeed `explvl` values. Indeed has no level above senior. */
const INDEED_EXPERIENCE: Record<ExperienceLevel, string> = {
  JUNIOR: "entry_level",
  MID: "mid_level",
  SENIOR: "senior_level",
  LEAD: "senior_level",
  EXECUTIVE: "senior_level",
}

/** Country display name (lower-cased) → Indeed country front-end. */
const INDEED_HOSTS: Record<string, { host: string; code: string }> = {
  philippines: { host: "ph.indeed.com", code: "PH" },
  singapore: { host: "sg.indeed.com", code: "SG" },
  malaysia: { host: "malaysia.indeed.com", code: "MY" },
  indonesia: { host: "id.indeed.com", code: "ID" },
  australia: { host: "au.indeed.com", code: "AU" },
  "united kingdom": { host: "uk.indeed.com", code: "UK" },
  canada: { host: "ca.indeed.com", code: "CA" },
  india: { host: "in.indeed.com", code: "IN" },
  germany: { host: "de.indeed.com", code: "DE" },
}

/** Country display name (lower-cased) → JobStreet site. JobStreet only runs these. */
const JOBSTREET_HOSTS: Record<string, { host: string; code: string }> = {
  philippines: { host: "ph.jobstreet.com", code: "PH" },
  singapore: { host: "sg.jobstreet.com", code: "SG" },
  malaysia: { host: "my.jobstreet.com", code: "MY" },
  indonesia: { host: "id.jobstreet.com", code: "ID" },
}

function isRemoteAnywhere(location: string): boolean {
  return location.trim().toLowerCase() === REMOTE_ANYWHERE
}

/**
 * A search term as a boolean-query operand. Quoted when it contains whitespace
 * or punctuation ("Node.js", "C++") so the board treats it as one phrase; a
 * plain word is left bare. Embedded double quotes are dropped so a term can
 * never unbalance the query.
 */
function quoteTerm(term: string): string {
  const clean = term.replace(/"/g, "").replace(/\s+/g, " ").trim()
  return /[^\p{L}\p{N}]/u.test(clean) ? `"${clean}"` : clean
}

/**
 * `"Software Engineer" AND (React OR "Node.js" OR TypeScript)` — the form both
 * LinkedIn and Indeed accept. With no keywords it is just the (quoted) role.
 * Keywords are de-duplicated case-insensitively, and one that just repeats the
 * role title is dropped, before the cap is applied.
 */
function booleanQuery(role: string, keywords: string[]): string {
  const roleTerm = quoteTerm(role)
  const seen = new Set([role.replace(/"/g, "").toLowerCase()])
  const terms = keywords
    .map((keyword) => keyword.replace(/"/g, "").replace(/\s+/g, " ").trim())
    .filter((keyword) => {
      const key = keyword.toLowerCase()
      if (keyword.length === 0 || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_BOARD_KEYWORDS)
    .map(quoteTerm)
  return terms.length > 0 ? `${roleTerm} AND (${terms.join(" OR ")})` : roleTerm
}

/**
 * Board search links for one role, in the order LinkedIn, Indeed, JobStreet.
 * JobStreet is only included when the primary location is a country it serves.
 * A blank role yields no links.
 *
 * Remote-only (LinkedIn "Worldwide", Indeed "Remote") applies only when there
 * is no non-remote primary location: the locations are empty or just
 * "Remote (anywhere)", and either that pseudo-location is present or the work
 * modes are exactly [REMOTE]. A REMOTE-only work mode with a country set keeps
 * the country and relies on LinkedIn's `f_WT=2` remote filter.
 *
 * Pure: no I/O, and every URL is encoded through `URL`/`URLSearchParams`.
 */
export function buildBoardSearchLinks(input: BoardSearchInput): BoardSearchLink[] {
  const role = input.role.replace(/\s+/g, " ").trim()
  if (!role) return []

  const primaryLocation =
    input.locations.map((location) => location.trim()).find((location) => location && !isRemoteAnywhere(location)) ??
    null
  const hasRemoteAnywhere = input.locations.some(isRemoteAnywhere)
  const remoteWorkModeOnly = input.workModes.length === 1 && input.workModes[0] === "REMOTE"
  const remoteOnly = primaryLocation === null && (hasRemoteAnywhere || remoteWorkModeOnly)
  const countryKey = primaryLocation?.toLowerCase() ?? null

  const links: BoardSearchLink[] = []
  const boolQuery = booleanQuery(role, input.keywords)

  // LinkedIn
  {
    const url = new URL("https://www.linkedin.com/jobs/search/")
    url.searchParams.set("keywords", boolQuery)
    let location: string | null = null
    if (remoteOnly) {
      location = "Worldwide"
      url.searchParams.set("location", location)
      url.searchParams.set("geoId", LINKEDIN_WORLDWIDE_GEO_ID)
    } else if (primaryLocation) {
      location = primaryLocation
      url.searchParams.set("location", location)
    }
    const workTypeCodes = [...new Set(input.workModes.map((mode) => LINKEDIN_WORK_TYPE[mode]))].sort()
    if (workTypeCodes.length > 0) url.searchParams.set("f_WT", workTypeCodes.join(","))
    if (input.experienceLevel) url.searchParams.set("f_E", LINKEDIN_EXPERIENCE[input.experienceLevel])
    links.push({ board: "LINKEDIN", label: "LinkedIn", query: boolQuery, location, url: url.toString() })
  }

  // Indeed
  {
    const front = countryKey ? INDEED_HOSTS[countryKey] : undefined
    const url = new URL(`https://${front?.host ?? "www.indeed.com"}/jobs`)
    url.searchParams.set("q", boolQuery)
    let location: string | null = null
    if (primaryLocation) location = primaryLocation
    else if (remoteOnly) location = "Remote"
    if (location) url.searchParams.set("l", location)
    if (input.experienceLevel) url.searchParams.set("explvl", INDEED_EXPERIENCE[input.experienceLevel])
    links.push({
      board: "INDEED",
      label: front ? `Indeed (${front.code})` : "Indeed",
      query: boolQuery,
      location,
      url: url.toString(),
    })
  }

  // JobStreet — plain role title: its search handles plain keywords best.
  // No remote filter param: `workarrangement` could not be verified live.
  const jobStreet = countryKey ? JOBSTREET_HOSTS[countryKey] : undefined
  if (jobStreet) {
    const url = new URL(`https://${jobStreet.host}/jobs`)
    url.searchParams.set("keywords", role)
    links.push({
      board: "JOBSTREET",
      label: `JobStreet (${jobStreet.code})`,
      query: role,
      location: null,
      url: url.toString(),
    })
  }

  return links
}
