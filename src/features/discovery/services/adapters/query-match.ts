import type { DiscoveryQuery } from "../../types"

/**
 * Local query matching for sources that cannot search.
 *
 * Remotive takes a `search` term server-side. Arbeitnow returns one global
 * feed, and an ATS board endpoint returns every opening a company has, so those
 * adapters have to do the filtering themselves. Keeping it here means the three
 * of them agree on what "matches the query" means.
 */

/** Lowercased words of the role plus keywords, deduped, one-character tokens dropped. */
export function queryTokens(query: DiscoveryQuery): string[] {
  const words = [query.role, ...(query.keywords ?? [])]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((word) => word.length > 1)
  return [...new Set(words)]
}

/**
 * True when any token appears in any of the haystack fields. Deliberately an
 * OR: a "Senior Frontend Engineer" query should still surface "Frontend
 * Developer", and a stricter match is the ranking step's job, not the
 * adapter's. An empty token list matches nothing, so a blank query cannot pull
 * a whole board in.
 */
export function matchesQuery(tokens: string[], fields: (string | undefined)[]): boolean {
  if (tokens.length === 0) return false
  const haystack = fields.filter(Boolean).join(" ").toLowerCase()
  return tokens.some((token) => haystack.includes(token))
}
