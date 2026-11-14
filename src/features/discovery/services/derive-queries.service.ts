import type { DiscoveryQuery } from "../types"

/**
 * Discovery searches for what the user said they want, not for what a resume
 * happens to contain: the queries come from the Career Profile's ACTIVE target
 * roles, in the user's own priority order.
 */

/** The most searches one run may fan out to. */
export const MAX_DISCOVERY_QUERIES = 5

/** The most profile keywords one query may carry. */
export const MAX_DISCOVERY_KEYWORDS = 6

/** The subset of a target role this needs — keeps the function testable. */
export interface TargetRoleInput {
  title: string
  priority: number
  active: boolean
}

/** The subset of a Career Profile capability this needs. */
export interface CapabilityInput {
  name: string
  confirmed: boolean
}

/**
 * The confirmed capability names a query carries as `keywords`.
 *
 * Only CONFIRMED capabilities qualify: an unconfirmed one is a claim the user
 * has not stood behind, and it should not steer what they are shown. The
 * caller's order is kept — `loadCareerProfile` already returns confirmed first,
 * then by name — and the list is capped so a long profile cannot swamp a query.
 *
 * These are the user's own words about themselves, never anything read out of a
 * posting, so nothing here can become evidence of a qualification.
 */
export function deriveDiscoveryKeywords(capabilities: CapabilityInput[]): string[] {
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const capability of capabilities) {
    if (!capability.confirmed) continue
    const name = capability.name.replace(/\s+/g, " ").trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    keywords.push(name)
    if (keywords.length >= MAX_DISCOVERY_KEYWORDS) break
  }
  return keywords
}

/**
 * ACTIVE target roles → one query per role title, priority ascending, capped at
 * {@link MAX_DISCOVERY_QUERIES}. Blank titles are dropped and repeated titles
 * collapse (case-insensitively) so a duplicate row cannot spend a query slot.
 *
 * Every query also carries the profile's confirmed capabilities as `keywords`.
 * They are a relevance signal, never a filter: a posting that matches the role
 * title is kept whether or not it mentions one. The field is omitted entirely
 * when the profile has no confirmed capability, so a query stays `{ role }`.
 *
 * Pure: `loadCareerProfile` already sorts, but this does not rely on that.
 */
export function deriveDiscoveryQueries(
  targetRoles: TargetRoleInput[],
  capabilities: CapabilityInput[] = []
): DiscoveryQuery[] {
  const keywords = deriveDiscoveryKeywords(capabilities)
  const active = targetRoles
    .filter((role) => role.active && role.title.trim().length > 0)
    .map((role, index) => ({ ...role, index }))
    // Ties keep the caller's order, matching `loadCareerProfile`'s createdAt tiebreak.
    .sort((a, b) => a.priority - b.priority || a.index - b.index)

  const seen = new Set<string>()
  const queries: DiscoveryQuery[] = []
  for (const role of active) {
    const title = role.title.replace(/\s+/g, " ").trim()
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    // A fresh copy per query: no adapter should be able to edit another's list.
    queries.push(keywords.length > 0 ? { role: title, keywords: [...keywords] } : { role: title })
    if (queries.length >= MAX_DISCOVERY_QUERIES) break
  }
  return queries
}
