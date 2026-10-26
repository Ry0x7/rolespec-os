"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { memo, useMemo } from "react"
import { cn } from "@/shared/lib/utils"
import { LogoMark } from "@/features/marketing/components/logo-mark"
import { navigationGroups, footerNavigation } from "@/config/navigation"

const ALL_NAV_HREFS: string[] = [
  ...navigationGroups.flatMap((group) => group.items.map((item) => item.href)),
  ...footerNavigation.map((item) => item.href),
]

/**
 * Longest matching prefix wins — the same rule as `getPageTitle` — so a nested
 * entry like /jobs/cover-letter does not also light up its parent /jobs.
 */
function getActiveHref(pathname: string): string | null {
  let active: string | null = null
  for (const href of ALL_NAV_HREFS) {
    const matches = pathname === href || pathname.startsWith(`${href}/`)
    if (matches && (active === null || href.length > active.length)) {
      active = href
    }
  }
  return active
}

const NavLink = memo(function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-md px-2 py-2 lg:min-h-9 text-sm transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground active:bg-muted"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-brand-400" : "text-muted-foreground"
        )}
      />
      {label}
    </Link>
  )
})

/** Sidebar contents, shared by the fixed desktop rail and the mobile drawer. */
export const SidebarNav = memo(function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const activeHref = useMemo(() => getActiveHref(pathname), [pathname])

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
        <LogoMark className="h-6 w-6" />
        <span className="text-sm font-bold tracking-tight">RoleSpec</span>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
        {navigationGroups.map((group, index) => (
          <div
            key={group.label ?? `group-${index}`}
            className={cn(
              "space-y-1",
              index > 0 && "mt-4 border-t border-border/60 pt-4"
            )}
          >
            {group.label && (
              <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={activeHref === item.href}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-1 border-t border-border px-3 py-4">
        <p className="hidden px-2 pb-2 text-[11px] text-muted-foreground lg:block">
          Press <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">⌘K</kbd> for quick actions · <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">?</kbd> for shortcuts
        </p>
        {footerNavigation.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={activeHref === item.href}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </>
  )
})

export const Sidebar = memo(function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-[var(--z-sidebar)] hidden h-screen w-60 flex-col border-r border-border bg-sidebar lg:flex">
      <SidebarNav />
    </aside>
  )
})
