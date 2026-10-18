/**
 * Whether the panel should offer "Show fit badges on <host>" for the active tab.
 *
 * Pure on purpose: no `chrome` globals. The panel looks up `granted` with
 * `chrome.permissions.contains` for `pattern` and feeds it back in. A toolbar click only
 * gives activeTab, which badges cannot use, so a supported board without a persistent
 * origin grant is exactly the case that needs the button.
 */

import { siteFor } from "./badge-sites"
import { hostLabelFor, originPatternFor } from "./site-access"

export interface BadgeEnableState {
  show: boolean
  /** Host to name on the button, or null when the page is not a supported board. */
  host: string | null
  /** The single-origin pattern to request, or null when the page is not a supported board. */
  pattern: string | null
}

export function badgeEnableState(input: {
  url: string | null | undefined
  granted: boolean
}): BadgeEnableState {
  const pattern = siteFor(input.url) ? originPatternFor(input.url) : null
  const host = pattern ? hostLabelFor(input.url) : null
  if (!pattern || !host) return { show: false, host: null, pattern: null }
  return { show: !input.granted, host, pattern }
}
