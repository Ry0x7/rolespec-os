import { describe, expect, it } from "vitest"
import { BADGE_CACHE_MAX_ENTRIES, BADGE_CACHE_TTL_MS, mergeCache, readCache, type BadgeVerdict } from "./badge-cache"

const verdict = (key: string): BadgeVerdict => ({ key, verdict: "STRONG", riskLevel: null, matched: ["X"] })

describe("badge cache", () => {
  it("serves fresh entries and misses expired ones", () => {
    const t0 = 1_000_000
    const cache = mergeCache(undefined, [verdict("a"), verdict("b")], t0)
    expect(readCache(cache, ["a", "b", "c"], t0 + 1000)).toEqual({ hits: [verdict("a"), verdict("b")], misses: ["c"] })
    expect(readCache(cache, ["a"], t0 + BADGE_CACHE_TTL_MS)).toEqual({ hits: [], misses: ["a"] })
    expect(readCache(cache, ["a"], t0 + BADGE_CACHE_TTL_MS - 1).hits).toHaveLength(1)
  })

  it("drops expired entries on merge and caps the size, keeping the newest", () => {
    const old = mergeCache(undefined, [verdict("stale")], 0)
    const merged = mergeCache(old, [verdict("new")], BADGE_CACHE_TTL_MS + 1)
    expect(Object.keys(merged)).toEqual(["new"])

    let cache = mergeCache(undefined, Array.from({ length: BADGE_CACHE_MAX_ENTRIES }, (_, i) => verdict(`k${i}`)), 10)
    cache = mergeCache(cache, [verdict("latest")], 20)
    expect(Object.keys(cache)).toHaveLength(BADGE_CACHE_MAX_ENTRIES)
    expect(cache.latest.at).toBe(20)
  })

  it("treats a malformed stored entry as a miss", () => {
    const cache = { a: { verdict: "STRONG", riskLevel: null, matched: [] } } as never
    expect(readCache(cache, ["a"], 5)).toEqual({ hits: [], misses: ["a"] })
  })
})
