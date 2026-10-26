/**
 * Tiny stale-while-revalidate cache for dashboard stats.
 * Server pages already fetch with Promise.all; this wraps a fetcher so
 * repeated renders within the TTL reuse the last value instantly while a
 * background refresh updates it — no client waterfalls, no extra queries.
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
  refreshing?: Promise<T>
}

const store = new Map<string, CacheEntry<unknown>>()

export const DASHBOARD_STATS_TTL_MS = 30_000

export async function getCachedDashboard<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DASHBOARD_STATS_TTL_MS
): Promise<T> {
  const now = Date.now()
  const hit = store.get(key) as CacheEntry<T> | undefined

  if (hit && hit.expiresAt > now) return hit.value

  // Stale-while-revalidate: serve stale instantly, refresh in background.
  if (hit) {
    if (!hit.refreshing) {
      hit.refreshing = fetcher()
        .then((value) => {
          store.set(key, { value, expiresAt: Date.now() + ttlMs })
          return value
        })
        .catch(() => hit.value)
        .finally(() => {
          const current = store.get(key) as CacheEntry<T> | undefined
          if (current) delete current.refreshing
        }) as Promise<T>
    }
    return hit.value
  }

  const value = await fetcher()
  store.set(key, { value, expiresAt: now + ttlMs })
  return value
}

export function invalidateDashboardCache(key?: string): void {
  if (key) store.delete(key)
  else store.clear()
}
