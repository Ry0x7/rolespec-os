"use client"

import { useEffect, useState } from "react"

/**
 * Flips to true once the framer-motion chunk behind `load` has actually
 * arrived. Callers render plain, already-visible markup until then, so the
 * server HTML is never swapped out for an empty `next/dynamic` loading state
 * (and stays readable if hydration is slow or never happens).
 *
 * `load` must be a module-level constant so the effect does not re-run.
 */
export function useLazyMotionReady(
  load: () => Promise<unknown>,
  enabled = true
) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!enabled || ready) return
    let active = true
    load()
      .then(() => {
        if (active) setReady(true)
      })
      .catch(() => {
        // Chunk failed to load: keep the plain, visible markup.
      })
    return () => {
      active = false
    }
  }, [enabled, ready, load])

  return ready
}
