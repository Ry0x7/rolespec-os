"use client"

import { useCallback, useSyncExternalStore } from "react"
import {
  applyTheme,
  getStoredTheme,
  storeTheme,
  DEFAULT_ACCENT_THEME,
  type AccentTheme,
} from "@/shared/lib/theme"

/**
 * localStorage is the source of truth, so the accent is read through
 * useSyncExternalStore: the server snapshot is the default (matching the markup
 * React hydrates) and the client snapshot is the stored value, which React
 * reconciles right after hydration. The <html> class is already correct by then
 * thanks to the blocking script in the root layout, so nothing flashes colour.
 */
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Cheap and always consistent: a primitive read straight from storage. */
function getSnapshot(): AccentTheme {
  return getStoredTheme()
}

function getServerSnapshot(): AccentTheme {
  return DEFAULT_ACCENT_THEME
}

export function useAccentTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setTheme = useCallback((next: AccentTheme) => {
    applyTheme(next)
    storeTheme(next)
    for (const listener of listeners) listener()
  }, [])

  return { theme, setTheme }
}
