/**
 * Tiny TTL memo for hot server paths (no new deps).
 * Dedupe concurrent callers on the same key so a burst of
 * dashboard/workspace/job renders pays for one upstream call.
 */

interface Entry<T> {
  value: T
  expiresAt: number
  inflight?: Promise<T>
}

const store = new Map<string, Entry<unknown>>()

export async function memoTtl<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now()
  const hit = store.get(key) as Entry<T> | undefined
  if (hit) {
    if (hit.inflight) return hit.inflight
    if (now < hit.expiresAt) return hit.value
  }
  const inflight = (async () => {
    try {
      const value = await fn()
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
      return value
    } catch (err) {
      store.delete(key)
      throw err
    }
  })()
  store.set(key, { value: undefined as T, expiresAt: 0, inflight })
  try {
    return await inflight
  } finally {
    const cur = store.get(key) as Entry<T> | undefined
    if (cur?.inflight === inflight) {
      // Value already stored on success; clear stale inflight shell on failure.
      if (cur.expiresAt === 0) store.delete(key)
    }
  }
}

export function clearMemoTtl(key?: string): void {
  if (key) store.delete(key)
  else store.clear()
}
