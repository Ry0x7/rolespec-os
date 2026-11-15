/**
 * Which pages the extension may ever read, and the match pattern to ask for one.
 *
 * Pure on purpose: no `chrome` globals, so the panel's gating logic is unit-testable.
 * The extension ships no `host_permissions` — page access is requested one origin at a
 * time from the panel (`optional_host_permissions` in `public/manifest.json`).
 */

/** Only the web is readable. Browser-owned pages are never injectable, grant or not. */
const READABLE_PROTOCOLS = new Set(["http:", "https:"])

/**
 * The narrowest match pattern that covers `url`'s origin, or null when the page can
 * never be read. The port is kept, so `http://localhost:8899/*` does not ask for every
 * other service on localhost.
 */
export function originPatternFor(url: string | undefined | null): string | null {
  const parsed = parse(url)
  if (!parsed) return null
  return `${parsed.protocol}//${parsed.host}/*`
}

/** True when a page could be read given a grant — i.e. it is an http(s) page. */
export function isReadableUrl(url: string | undefined | null): url is string {
  return parse(url) !== null
}

/** The host (with port, if any) to name in the grant prompt, or null when unreadable. */
export function hostLabelFor(url: string | undefined | null): string | null {
  return parse(url)?.host ?? null
}

function parse(url: string | undefined | null): URL | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!READABLE_PROTOCOLS.has(parsed.protocol)) return null
  // `http:///` and the like parse but have no origin to ask for.
  if (!parsed.host) return null
  return parsed
}

/**
 * Why a page read failed, which decides what the panel can honestly tell the user:
 * - "needs-grant": an http(s) page with no site grant — offer the grant button.
 * - "unreadable": an http(s) page that is granted yet still refused injection (Chrome
 *   blocks some web pages, e.g. the Chrome Web Store) — a grant would not help.
 * - "browser-page": chrome://, extension, file and similar pages — never readable.
 */
export type BlockedReason = "needs-grant" | "unreadable" | "browser-page"

export interface BlockedReadPlan {
  reason: BlockedReason
  /** Clear every field before writing `link`, so no field is left from another page. */
  clearForm: boolean
  /** The Job link to write, or null to leave the field as it is. */
  link: string | null
}

/**
 * What a failed page read does to the form. A read that would have replaced the form
 * (`clearFirst`) replaces all of it, keeping only the tab's URL as the Job link — never
 * a new link next to another page's company, title and description. A read that would
 * only have added to the form writes the link into an empty field and nothing else.
 */
export function planBlockedRead(input: {
  url: string | undefined | null
  granted: boolean
  clearFirst: boolean
  currentLink: string
}): BlockedReadPlan {
  const { url, granted, clearFirst, currentLink } = input
  const reason: BlockedReason = !isReadableUrl(url)
    ? "browser-page"
    : granted
      ? "unreadable"
      : "needs-grant"
  const readableUrl = isReadableUrl(url) ? url : null
  if (clearFirst) return { reason, clearForm: true, link: readableUrl }
  return { reason, clearForm: false, link: currentLink.trim() ? null : readableUrl }
}
