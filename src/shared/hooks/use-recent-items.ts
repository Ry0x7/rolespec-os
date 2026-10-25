"use client"

import { useCallback, useEffect, useState } from "react"

const STORAGE_KEY = "rolespec-recent-items"
const MAX_ITEMS = 6

export interface RecentItem {
  href: string
  label: string
  visitedAt: number
}

// In-memory copy so repeated palette opens do not re-parse localStorage
// (avoids layout-blocking JSON work on every keystroke-driven render).
let memoryCache: RecentItem[] | null = null

/** Reads the stored recent list. Safe on SSR / private mode. */
function readStored(): RecentItem[] {
  if (memoryCache) return memoryCache
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecentItem[]
    if (!Array.isArray(parsed)) {
      memoryCache = []
      return memoryCache
    }
    memoryCache = parsed
      .filter((item) => typeof item?.href === "string" && typeof item?.label === "string")
      .slice(0, MAX_ITEMS)
    return memoryCache
  } catch {
    return []
  }
}

/**
 * Recently visited OS locations, persisted per device. The palette and
 * breadcrumbs read this so "back to what I was doing" is one keystroke.
 */
export function useRecentItems() {
  const [items, setItems] = useState<RecentItem[]>([])

  useEffect(() => {
    setItems(readStored())
  }, [])

  const record = useCallback((href: string, label: string) => {
    setItems((prev) => {
      const next = [
        { href, label, visitedAt: Date.now() },
        ...prev.filter((item) => item.href !== href),
      ].slice(0, MAX_ITEMS)
      memoryCache = next
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Non-fatal: recent list is a convenience, not data.
      }
      return next
    })
  }, [])

  const clear = useCallback(() => {
    memoryCache = []
    setItems([])
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore.
    }
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
  try {
    const next = [
      { href, label, visitedAt: Date.now() },
      ...readStored().filter((item) => item.href !== href),
    ].slice(0, MAX_ITEMS)
    memoryCache = next
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore.
  }
}
