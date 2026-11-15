"use client"

import { useCallback, useLayoutEffect, useRef, type UIEvent } from "react"

/**
 * Keeps a scroll container where the user left it across re-renders. A
 * `router.refresh()` after an in-list action (confirm, delete, pause) can
 * remount or reorder the rows, and the browser then resets the container to
 * the top. The last position the user chose is put back before paint.
 *
 * `resetScroll` is for moves that should start at the top on purpose — a page
 * change or a filter change.
 */
export function usePreservedScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const scrollTopRef = useRef(0)

  // No dependency list: restoring is a no-op unless something moved the
  // container, and any render can be the one that did.
  useLayoutEffect(() => {
    const element = ref.current
    if (element && element.scrollTop !== scrollTopRef.current) {
      element.scrollTop = scrollTopRef.current
    }
  })

  const onScroll = useCallback((event: UIEvent<T>) => {
    scrollTopRef.current = event.currentTarget.scrollTop
  }, [])

  const resetScroll = useCallback(() => {
    scrollTopRef.current = 0
    if (ref.current) ref.current.scrollTop = 0
  }, [])

  return { ref, onScroll, resetScroll }
}
