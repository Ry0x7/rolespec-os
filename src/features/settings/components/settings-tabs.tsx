"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/shared/lib/utils"
import { getActiveTabHref, settingsTabGroups } from "../constants/tabs"

/**
 * Left-hand tab rail for /settings. Links rather than an ARIA tablist: each tab
 * is a real route, so the browser back button and a pasted URL both work.
 *
 * Desktop gets a sticky column; below lg the same tabs collapse into a
 * two-column grid of pills above the content. Nothing scrolls sideways, so no
 * tab can sit hidden off the right edge of a phone.
 */
export function SettingsTabs() {
  const pathname = usePathname()
  const activeHref = getActiveTabHref(pathname)
  const groups = settingsTabGroups

  return (
    <>
      <nav
        aria-label="Settings"
        className="hidden w-56 shrink-0 lg:sticky lg:top-20 lg:block lg:self-start"
      >
        {groups.map((group, index) => (
          <div
            key={group.label}
            className={cn(
              "space-y-1",
              index > 0 && "mt-4 border-t border-border/60 pt-4"
            )}
          >
            <p className="px-2 pb-1 text-xs text-muted-foreground">{group.label}</p>
            {group.items.map((item) => {
              const active = activeHref === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground active:bg-muted"
                  )}
                >
                  <item.icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "text-brand-400" : "text-muted-foreground"
                    )}
                  />
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <nav
        aria-label="Settings"
        className="-mx-4 px-4 pb-1 lg:hidden"
      >
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {groups.flatMap((group) =>
            group.items.map((item) => {
              const active = activeHref === item.href
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-transparent bg-muted font-medium text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        active ? "text-brand-400" : "text-muted-foreground"
                      )}
                    />
                    {item.label}
                  </Link>
                </li>
              )
            })
          )}
        </ul>
      </nav>
    </>
  )
}
