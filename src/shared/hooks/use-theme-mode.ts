"use client"

import { useCallback, useSyncExternalStore } from "react"
import {
  applyMode,
  getStoredMode,
  storeMode,
  DARK_SCHEME_QUERY,
  DEFAULT_THEME_MODE,
  type ThemeMode,
} from "@/shared/lib/theme"

/**
 * Same shape as useAccentTheme: localStorage is the source of truth, read
 * through useSyncExternalStore so the server snapshot matches the markup React
 * hydrates (dark) and the client snapshot is the stored mode. The <html> class
 * is already correct before paint thanks to the blocking init script, so nothing
 * flashes.
 *
 * On top of that, while the stored mode is `system` this subscribes to the OS
 * preference and re-applies the class when it flips.
 */
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

let media: MediaQueryList | null = null

function handleSchemeChange() {
  if (getStoredMode() !== "system") return
  applyMode("system")
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!media && typeof window !== "undefined" && window.matchMedia) {
    media = window.matchMedia(DARK_SCHEME_QUERY)
    media.addEventListener("change", handleSchemeChange)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && media) {
      media.removeEventListener("change", handleSchemeChange)
      media = null
    }
  }
}

/** Cheap and always consistent: a primitive read straight from storage. */
function getSnapshot(): ThemeMode {
  return getStoredMode()
}

function getServerSnapshot(): ThemeMode {
  return DEFAULT_THEME_MODE
}

export function useThemeMode() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setMode = useCallback((next: ThemeMode) => {
    applyMode(next)
    storeMode(next)
    emit()
  }, [])

  return { mode, setMode }
}
