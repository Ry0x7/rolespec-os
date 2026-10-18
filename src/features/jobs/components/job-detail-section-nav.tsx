"use client"

import { useEffect, type MouseEvent } from "react"
import { useScrollSpy, jumpToSection } from "@/shared/hooks/use-scroll-spy"
import { cn } from "@/shared/lib/utils"

/** App header (56px) + this bar (~42px) + breathing room — the same clearance `scroll-mt-28` gives. */
const BAND_TOP_PX = 112

export interface JobDetailSectionNavItem {
  key: string
  label: string
}

/**
 * The four sections of Job Detail, in page order. Exported so the page and the
 * nav cannot drift apart.
 */
export const JOB_DETAIL_SECTIONS: JobDetailSectionNavItem[] = [
  { key: "decide", label: "Decide" },
  { key: "prepare", label: "Prepare" },
  { key: "track", label: "Track" },
  { key: "posting", label: "Posting" },
]

/**
 * A slim pill row for the four Job Detail sections, mirroring the career
 * profile section nav: sticky under the app header (`h-14`) on desktop, a plain
 * horizontal scroller on narrow screens where sticking it would eat too much of
 * the viewport. `scrollIntoView` (rather than a bare hash jump) honors each
 * target's `scroll-mt-28`, so the sticky header and this bar never cover the
 * section they just jumped to.
 *
 * The active pill is driven by `useScrollSpy` (an IntersectionObserver) rather
 * than the hash, so plain scrolling keeps the user oriented too.
 */
export function JobDetailSectionNav({
  items = JOB_DETAIL_SECTIONS,
}: {
  items?: JobDetailSectionNavItem[]
}) {
  const { activeId: activeKey, setActiveId: setActiveKey } = useScrollSpy(
    items.map((item) => item.key),
    { bandTopPx: BAND_TOP_PX }
  )

  // A deep link (`/jobs/:id#track` from a follow-up, `#prepare` from the resume
  // editor) is a hard load, and the browser's own hash jump does not reliably
  // land on the section here, so honor the hash once on mount — through
  // `scrollIntoView`, which respects `scroll-mt-28`.
  useEffect(() => {
    const key = window.location.hash.slice(1)
    if (!items.some((item) => item.key === key)) return
    const frame = requestAnimationFrame(() => {
      document.getElementById(key)?.scrollIntoView({ block: "start" })
    })
    return () => cancelAnimationFrame(frame)
    // Mount only: later hash changes come from this nav's own clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleClick(event: MouseEvent<HTMLAnchorElement>, key: string) {
    if (jumpToSection(event, key)) setActiveKey(key)
  }

  return (
    <nav
      aria-label="Job sections"
      className="static top-14 z-20 -mx-4 flex gap-1.5 overflow-x-auto border-b border-border bg-background/80 px-4 py-2 backdrop-blur-sm lg:sticky lg:mx-0 lg:rounded-lg lg:border lg:px-2"
    >
      {items.map((item) => {
        const active = item.key === activeKey
        return (
          <a
            key={item.key}
            href={`#${item.key}`}
            onClick={(event) => handleClick(event, item.key)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {item.label}
          </a>
        )
      })}
    </nav>
  )
}
