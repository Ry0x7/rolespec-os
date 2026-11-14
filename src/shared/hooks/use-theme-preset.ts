"use client"

import { useCallback, useSyncExternalStore } from "react"
import {
  applyPreset,
  DEFAULT_THEME_PRESET,
  getStoredPreset,
  storePreset,
  type ThemePreset,
} from "@/shared/lib/theme"

/**
 * localStorage is the source of truth, read through useSyncExternalStore so
 * the server snapshot matches the markup React hydrates (Midnight) and the
 * client snapshot is the stored preset. The <html> class is already correct
 * before paint thanks to the blocking init script.
 */
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ThemePreset {
  return getStoredPreset()
}

function getServerSnapshot(): ThemePreset {
  return DEFAULT_THEME_PRESET
}

export function useThemePreset() {
  const preset = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setPreset = useCallback((next: ThemePreset) => {
    applyPreset(next)
    storePreset(next)
    for (const listener of listeners) listener()
  }, [])

  return { preset, setPreset }
}
