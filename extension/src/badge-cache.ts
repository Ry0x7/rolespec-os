/**
 * The background worker's verdict cache for the in-page badges, kept in
 * `chrome.storage.session` (memory only, cleared when the browser closes). Pure helpers
 * over the stored record, so TTL and the size cap are unit-testable; the worker owns
 * the storage reads and writes.
 */
import type { JobRiskLevel, QualificationVerdict } from "./types"

export const BADGE_CACHE_KEY = "rolespec.badge-cache"
export const BADGE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
export const BADGE_CACHE_MAX_ENTRIES = 2000

/** What a badge needs; the content script never sees more than this. */
export interface BadgeVerdict {
  key: string
  verdict: QualificationVerdict
  riskLevel: JobRiskLevel | null
  matched: string[]
}

export interface CachedVerdict {
  verdict: QualificationVerdict
  riskLevel: JobRiskLevel | null
  matched: string[]
  at: number
}

export type BadgeCache = Record<string, CachedVerdict>

function isFresh(entry: CachedVerdict | undefined, now: number): entry is CachedVerdict {
  return !!entry && typeof entry.at === "number" && now - entry.at >= 0 && now - entry.at < BADGE_CACHE_TTL_MS
}

/** Splits `keys` into fresh cached verdicts and the keys that need a network call. */
export function readCache(
  cache: BadgeCache | undefined,
  keys: string[],
  now: number,
): { hits: BadgeVerdict[]; misses: string[] } {
  const hits: BadgeVerdict[] = []
  const misses: string[] = []
  for (const key of keys) {
    const entry = cache?.[key]
    if (isFresh(entry, now)) {
      hits.push({ key, verdict: entry.verdict, riskLevel: entry.riskLevel, matched: entry.matched })
    } else {
      misses.push(key)
    }
  }
  return { hits, misses }
}

/**
 * Adds `results` stamped `now`, drops expired entries, and keeps only the newest
 * `BADGE_CACHE_MAX_ENTRIES`.
 */
export function mergeCache(cache: BadgeCache | undefined, results: BadgeVerdict[], now: number): BadgeCache {
  const merged: BadgeCache = {}
  for (const [key, entry] of Object.entries(cache ?? {})) {
    if (isFresh(entry, now)) merged[key] = entry
  }
  for (const result of results) {
    merged[result.key] = { verdict: result.verdict, riskLevel: result.riskLevel, matched: result.matched, at: now }
  }
  const entries = Object.entries(merged)
  if (entries.length <= BADGE_CACHE_MAX_ENTRIES) return merged
  entries.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(entries.slice(0, BADGE_CACHE_MAX_ENTRIES))
}
