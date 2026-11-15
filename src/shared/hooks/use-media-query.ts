"use client"

import { useSyncExternalStore } from "react"

/**
 * `getServerSnapshot` (always `false`) is what the hydration render reads, so
 * it matches the server-rendered markup and React corrects to the real value
 * right after mounting, before the browser paints — no hydration warning, no
 * visible flash. Same trick `Drawer`'s `mounted` flag uses one level up.
 *
 * jsdom ships no `matchMedia` by default (most test files never polyfill it),
 * so this degrades to the server snapshot (`false`) rather than throwing —
 * every consumer's "below lg" branch is therefore what a test sees unless it
 * polyfills `matchMedia` itself.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {}
      }
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : false,
    () => false
  )
}
