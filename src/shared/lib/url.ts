/**
 * Shared URL helpers used by contact link inputs, the resume preview and the
 * PDF export templates. Keeps normalization in one place instead of the
 * ad-hoc regexes that used to live in each renderer.
 */

const MARKDOWN_LINK_REGEX = /^\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)\s*$/

/** True when a string looks like a URL (with or without a protocol). */
export function looksLikeUrl(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  return /^(https?:\/\/|www\.)/i.test(t) || /^[\w-]+\.\w{2,}/.test(t)
}

/** Adds `https://` when the value has no protocol. Empty input stays empty. */
export function normalizeUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ""
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

/** Strips protocol, leading `www.` and any trailing slash for display. */
export function displayUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ""
  return s
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
}

export interface ParsedLink {
  /** Text to display to the user. */
  label: string
  /** Absolute href, or an empty string when the value is not URL-like. */
  href: string
}

/**
 * Turns a stored contact link value into a display label + href.
 *
 * Degrades gracefully for values that contain a markdown `[label](url)`
 * artifact left behind by the old link-insert button, so those never render as
 * literal brackets in the preview or in exports.
 */
export function parseLinkValue(raw: string): ParsedLink {
  const s = raw.trim()
  if (!s) return { label: "", href: "" }

  const md = MARKDOWN_LINK_REGEX.exec(s)
  if (md) {
    const [, label, url] = md
    const href = normalizeUrl(url)
    const trimmedLabel = label.trim()
    return {
      label: looksLikeUrl(trimmedLabel) ? displayUrl(trimmedLabel) : trimmedLabel,
      href,
    }
  }

  if (!looksLikeUrl(s)) return { label: s, href: "" }

  return { label: displayUrl(s), href: normalizeUrl(s) }
}
