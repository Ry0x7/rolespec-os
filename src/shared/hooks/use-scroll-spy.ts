"use client"

import { useEffect, useState, type MouseEvent } from "react"

/** App header (56px) + a sticky section nav (~42px) + breathing room — the same clearance `scroll-mt-28` gives. */
const DEFAULT_BAND_TOP_PX = 112
const BAND_BOTTOM_FRACTION = 0.55

/**
 * Tracks which of `sectionIds` (element ids, in page order) is currently
 * "being read", for a sticky section nav. Driven by an IntersectionObserver
 * rather than the hash, so plain scrolling keeps the user oriented too.
 *
 * Returns the active id (null until the observer has reported anything) and a
 * setter so a click can mark its target active immediately, before the smooth
 * scroll lands.
 */
export function useScrollSpy(
  sectionIds: string[],
  opts?: { bandTopPx?: number }
): { activeId: string | null; setActiveId: (id: string) => void } {
  const [activeId, setActiveId] = useState<string | null>(null)
  const bandTopPx = opts?.bandTopPx ?? DEFAULT_BAND_TOP_PX
  // Keyed on the ids' content, not the array's identity, so a caller mapping
  // its items inline does not re-subscribe on every render.
  const idsKey = sectionIds.join("\u0000")

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return
    const ids = idsKey === "" ? [] : idsKey.split("\u0000")

    // A callback only reports the sections whose visibility *changed*, so the
    // running set is kept here — reading `entries` alone made a section that was
    // already on screen lose to the one that had just scrolled into view.
    const visible = new Set<string>()

    // Several sections are in the band at once, and at the end of the page the
    // last two always are, so the one filling most of it wins rather than the
    // earliest. Ties (including jsdom, where every rect is empty) fall back to
    // page order.
    function pickActive() {
      const bandBottom = window.innerHeight * (1 - BAND_BOTTOM_FRACTION)
      let active: string | null = null
      let bestOverlap = -Infinity
      for (const id of ids) {
        if (!visible.has(id)) continue
        const rect = document.getElementById(id)?.getBoundingClientRect()
        if (!rect) continue
        const overlap =
          Math.min(rect.bottom, bandBottom) - Math.max(rect.top, bandTopPx)
        if (overlap > bestOverlap) {
          bestOverlap = overlap
          active = id
        }
      }
      if (active) setActiveId(active)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        pickActive()
      },
      // Top inset clears the app header + the nav bar so a section only counts
      // as active once it is actually readable.
      {
        rootMargin: `-${bandTopPx}px 0px -${BAND_BOTTOM_FRACTION * 100}% 0px`,
        threshold: 0,
      }
    )

    const observed = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    observed.forEach((element) => observer.observe(element))

    // The observer only fires on band crossings, so a scroll that ends with two
    // sections still in the band (every jump near the bottom of the page) would
    // otherwise keep whichever one dominated mid-scroll. One rAF-throttled read
    // per scroll settles it.
    let frame = 0
    function handleScroll() {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        pickActive()
      })
    }
    window.addEventListener("scroll", handleScroll, { passive: true })

    return () => {
      observer.disconnect()
      window.removeEventListener("scroll", handleScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [idsKey, bandTopPx])

  return { activeId, setActiveId }
}

/**
 * Click handler body for a section-nav anchor. `scrollIntoView` (rather than a
 * bare hash jump) honors the target's `scroll-mt-*`; the default hash jump is
 * what `preventDefault` suppresses, so the address bar is updated by hand.
 * Returns false (and leaves the default navigation alone) when the target is
 * not on the page.
 */
export function jumpToSection(
  event: MouseEvent<HTMLAnchorElement>,
  id: string
): boolean {
  const target = document.getElementById(id)
  if (!target) return false
  event.preventDefault()
  target.scrollIntoView({ behavior: "smooth", block: "start" })
  history.replaceState(null, "", `#${id}`)
  return true
}
