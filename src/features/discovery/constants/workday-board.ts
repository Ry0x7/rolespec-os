/**
 * Workday board URL parsing.
 *
 * Greenhouse, Lever, Ashby, BambooHR and Freshteam each key a board on one
 * slug, so the watchlist can store a slug. Workday needs three parts — the
 * tenant (`globe`), the Workday data-centre subdomain (`wd3`) and the career
 * site id (`GLB_Careers`) — and none of them is derivable from the other two.
 * A watched Workday board is therefore the board URL the user can copy out of
 * their address bar, and this is the one place that takes it apart.
 *
 * Deliberately dependency-free: `preferences.schema.ts` validates watchlist
 * entries with it and that module is imported by a client component, so nothing
 * here may reach for the logger or any other server-only code.
 */

/** `{tenant}.{wd}.myworkdayjobs.com` — the only host a watched board may live on. */
const WORKDAY_HOST_PATTERN = /^([a-z0-9][a-z0-9-]*)\.(wd\d+)\.myworkdayjobs\.com$/

/** A Workday locale segment, e.g. `en-US`. Always hyphenated, so a site id cannot be mistaken for one. */
const WORKDAY_LOCALE_PATTERN = /^[a-z]{2}-[a-z]{2,4}$/i

/** The career site id as it appears in the path, e.g. `GLB_Careers`. Case is significant. */
const WORKDAY_SITE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

/** A watchlist entry is a URL, so it gets its own ceiling rather than the slug one. */
export const MAX_WORKDAY_BOARD_URL_LENGTH = 300

/** One watched Workday career site, taken apart into the three parts its API needs. */
export interface WorkdayBoard {
  /** The Workday tenant, e.g. `globe`. Stands in for the company name. */
  tenant: string
  /** The data-centre subdomain, e.g. `wd3`. */
  wd: string
  /** The career site id, e.g. `GLB_Careers`. */
  site: string
  /** The canonical `https://{tenant}.{wd}.myworkdayjobs.com/{site}` form, which is what is stored. */
  boardUrl: string
}

/**
 * `{ tenant, wd, site, boardUrl }` for a Workday career site URL, or null for
 * anything else.
 *
 * Accepts the board root with or without a locale segment and any deeper path
 * (a posting URL is a board URL plus `/job/...`), so a user who pastes the URL
 * of the posting they were reading still gets the board. The returned
 * `boardUrl` drops the locale and everything after the site id, so two ways of
 * writing the same board store as one entry.
 */
export function parseWorkdayBoardUrl(raw: string): WorkdayBoard | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed || trimmed.length > MAX_WORKDAY_BOARD_URL_LENGTH) return null

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }

  if (url.protocol !== "https:") return null

  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  const hostMatch = WORKDAY_HOST_PATTERN.exec(host)
  if (!hostMatch) return null
  const [, tenant, wd] = hostMatch
  if (!tenant || !wd) return null

  const segments = url.pathname.split("/").filter(Boolean)
  // A leading locale is optional; the site id is whatever follows it.
  const site = segments[0] && WORKDAY_LOCALE_PATTERN.test(segments[0]) ? segments[1] : segments[0]
  if (!site || !WORKDAY_SITE_PATTERN.test(site)) return null

  return { tenant, wd, site, boardUrl: `https://${tenant}.${wd}.myworkdayjobs.com/${site}` }
}

/**
 * The `/job/...` tail of a Workday posting URL, or null when the URL names a
 * board rather than one posting.
 *
 * Workday calls this the `externalPath` and returns it verbatim in its own
 * search payload, so the same string is this adapter's `externalId` whether a
 * posting arrived from a search or from a pasted URL.
 */
export function parseWorkdayExternalPath(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean)
  const start = segments[0] && WORKDAY_LOCALE_PATTERN.test(segments[0]) ? 2 : 1
  if (segments[start] !== "job") return null
  const tail = segments.slice(start)
  // `/job/{location}/{title}_{req}` is the shortest real posting path.
  if (tail.length < 3) return null
  return `/${tail.join("/")}`
}
