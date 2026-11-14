const JOBS_PATH = "/jobs"

/**
 * sessionStorage key for the list's current URL. `useJobFilters` writes it
 * whenever it mirrors its state into the address bar, because a client-side
 * navigation into a job does not update `document.referrer`.
 */
export const JOBS_LIST_HREF_STORAGE_KEY = "rolespec:jobs-list-href"

/** Records the list URL (`/jobs` plus its query) for the Job Detail back link. */
export function rememberJobsListHref(href: string): void {
  try {
    window.sessionStorage.setItem(JOBS_LIST_HREF_STORAGE_KEY, href)
  } catch {
    // Storage can be unavailable (privacy mode, quota); the link falls back.
  }
}

/** `pathname + search` of `candidate` when it is the `/jobs` list on `origin`, else null. */
function toJobsListHref(candidate: string | null, origin: string): string | null {
  if (!candidate) return null
  try {
    const url = new URL(candidate, origin)
    if (url.origin !== origin || url.pathname !== JOBS_PATH) return null
    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}

/**
 * Where "back to the list" should go: the list URL this tab last showed, else
 * the referrer when it is that list on this origin, else the bare list.
 */
export function resolveBackToJobsHref({
  storedHref,
  referrer,
  origin,
}: {
  storedHref: string | null
  referrer: string
  origin: string
}): string {
  return (
    toJobsListHref(storedHref, origin) ??
    toJobsListHref(referrer, origin) ??
    JOBS_PATH
  )
}
