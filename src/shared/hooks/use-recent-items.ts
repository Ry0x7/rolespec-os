"use client"

import { useCallback, useSyncExternalStore } from "react"

const STORAGE_KEY = "rolespec-recent-items"
const MAX_ITEMS = 6

export interface RecentItem {
  href: string
  label: string
  visitedAt: number
}

// Shared empty list: the server snapshot, and what a first client render sees,
// must be one stable identity or useSyncExternalStore would re-render forever.
const EMPTY: RecentItem[] = []

// In-memory copy so repeated palette opens do not re-parse localStorage
// (avoids layout-blocking JSON work on every keystroke-driven render).
let memoryCache: RecentItem[] | null = null
const listeners = new Set<() => void>()

/** Reads the stored recent list. Safe on SSR / private mode. */
function readStored(): RecentItem[] {
  if (memoryCache) return memoryCache
  if (typeof window === "undefined") return EMPTY
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as RecentItem[]) : EMPTY
    memoryCache = Array.isArray(parsed)
      ? parsed
          .filter((item) => typeof item?.href === "string" && typeof item?.label === "string")
          .slice(0, MAX_ITEMS)
      : EMPTY
    return memoryCache
  } catch {
    return EMPTY
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

function writeItems(next: RecentItem[]): void {
  memoryCache = next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Non-fatal: recent list is a convenience, not data.
  }
  emit()
}

/**
 * Recently visited OS locations, persisted per device. The palette and
 * breadcrumbs read this so "back to what I was doing" is one keystroke.
 *
 * Storage is external state read through `useSyncExternalStore`, so mounting
 * never copies it into state inside an effect and every mounted reader stays
 * in step with the latest write.
 */
export function useRecentItems() {
  const items = useSyncExternalStore(subscribe, readStored, () => EMPTY)

  const record = useCallback((href: string, label: string) => {
    writeItems(
      [
        { href, label, visitedAt: Date.now() },
        ...readStored().filter((item) => item.href !== href),
      ].slice(0, MAX_ITEMS)
    )
  }, [])

  const clear = useCallback(() => {
    memoryCache = EMPTY
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore.
    }
    emit()
  }, [])

  return { items, record, clear }
}

/** One-shot read for non-React call sites (palette initial state). */
export function getStoredRecentItems(): RecentItem[] {
  return readStored()
}

/** One-shot write for non-React call sites. */
export function storeRecentItem(href: string, label: string): void {
  if (typeof window === "undefined") return
  writeItems(
    [
      { href, label, visitedAt: Date.now() },
      ...readStored().filter((item) => item.href !== href),
    ].slice(0, MAX_ITEMS)
  )
}
