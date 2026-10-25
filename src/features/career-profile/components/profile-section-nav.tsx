"use client"

import type { MouseEvent } from "react"
import { Check } from "lucide-react"
import { useScrollSpy, jumpToSection } from "@/shared/hooks/use-scroll-spy"
import { cn } from "@/shared/lib/utils"
import type { ProfileSectionNavItem } from "../lib/section-completeness"

/**
 * A slim pill row so the six always-open sections below have something to
 * jump to. Sticky under the app header on desktop; a plain horizontal
 * scroller on narrow screens, where sticking it would eat too much of the
 * viewport. `scrollIntoView` (rather than a bare hash link) honors each
 * target's `scroll-mt-*` so the sticky header/nav never covers the section
 * it just jumped to.
 *
 * The active pill follows the reader via `useScrollSpy`, the same band and
 * pick rule the Job Detail nav uses.
 */
const SECTION_HINTS: Record<string, string> = {
  contact: "1",
  preferences: "2",
  "target-roles": "T",
  "linkedin-import": "I",
  evidence: "E",
  capabilities: "C",
}

export function ProfileSectionNav({ items }: { items: ProfileSectionNavItem[] }) {
  const { activeId, setActiveId } = useScrollSpy(items.map((item) => item.key))

  function handleClick(event: MouseEvent<HTMLAnchorElement>, key: string) {
    if (jumpToSection(event, key)) setActiveId(key)
  }

  return (
    <nav
      aria-label="Career profile sections"
      className="static top-14 z-20 -mx-4 flex gap-1.5 overflow-x-auto border-b border-border bg-background/80 px-4 py-2 backdrop-blur-sm lg:sticky lg:mx-0 lg:rounded-lg lg:border lg:px-2"
    >
      {items.map((item) => {
        const active = item.key === activeId
        return (
          <a
            key={item.key}
            href={`#${item.key}`}
            onClick={(event) => handleClick(event, item.key)}
            aria-label={
              item.complete === null
                ? item.label
                : `${item.label} — ${item.complete ? "complete" : "incomplete"}`
            }
            aria-current={active ? "location" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {item.complete !== null && (
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                  item.complete
                    ? "border-green-600/30 bg-green-600/10 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400"
                    : "border-border bg-transparent"
                )}
              >
                {item.complete && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
            )}
            {item.label}
            {SECTION_HINTS[item.key] && (
              <kbd className="hidden rounded border border-border/60 bg-muted px-1 font-mono text-[10px] opacity-60 lg:inline">
                {SECTION_HINTS[item.key]}
              </kbd>
            )}
          </a>
        )
      })}
    </nav>
  )
}
