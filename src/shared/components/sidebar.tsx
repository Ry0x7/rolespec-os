"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { memo, useCallback, useMemo, useSyncExternalStore } from "react"
import { PanelLeftClose } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { LogoMark } from "@/features/marketing/components/logo-mark"
import { navigationGroups, footerNavigation } from "@/config/navigation"
import { tourTargetForHref } from "@/shared/lib/guided-tour"

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

/* --------------------------------------------------------------------------
   Desktop rail collapse
   --------------------------------------------------------------------------
   The width itself is CSS (`--sidebar-width` in globals.css), because the
   content offset lives in the server-rendered (app) layout and cannot read a
   client store. `data-sidebar` is written to <html> by a pre-paint script in
   that layout, so a reload paints the stored width before React hydrates.
   React only reads it back for the toggle's icon and aria state. */

const SIDEBAR_STORAGE_KEY = "rolespec-sidebar-collapsed"
const SIDEBAR_CHANGE_EVENT = "rolespec:sidebar-change"

function sidebarIsCollapsed(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-sidebar") === "collapsed"
  )
}

function applySidebarState(collapsed: boolean) {
  document.documentElement.setAttribute(
    "data-sidebar",
    collapsed ? "collapsed" : "expanded"
  )
}

function subscribeToSidebar(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key !== SIDEBAR_STORAGE_KEY) return
    applySidebarState(event.newValue === "1")
    onChange()
  }
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onStorage)
  }
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
      data-tour={tourTargetForHref(href)}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      // The text label is hidden (CSS) when the rail is collapsed, so the
      // title is what names the icon on hover.
      title={label}
      className={cn(
        // Apple sidebar: 8px selection pill, quick ease-out transitions,
        // press feedback on the row itself.
        "sidebar-nav-link flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-2 lg:min-h-9 text-sm transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground active:bg-muted"
      )}
    >
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      />
      <span className="sidebar-label truncate">{label}</span>
    </Link>
  )
})

type CollapseToggle = {
  collapsed: boolean
  onToggle: () => void
}

/** Sidebar contents, shared by the fixed desktop rail and the mobile drawer. */
export const SidebarNav = memo(function SidebarNav({
  onNavigate,
  collapseToggle,
}: {
  onNavigate?: () => void
  /** Desktop-only affordance; the mobile drawer renders without it. */
  collapseToggle?: CollapseToggle
}) {
  const pathname = usePathname()
  const activeHref = useMemo(() => getActiveHref(pathname), [pathname])

  return (
    <>
      <div className="sidebar-brand flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
        {collapseToggle?.collapsed ? (
          // In the 72px rail the logo IS the expand control: a second 32px
          // button beside a 24px mark left the pair cramped and off-balance.
          <button
            type="button"
            onClick={collapseToggle.onToggle}
            aria-label="Expand sidebar"
            aria-expanded={false}
            title="Expand sidebar"
            className="sidebar-toggle inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
          >
            <LogoMark className="h-6 w-6" />
          </button>
        ) : (
          <>
            <LogoMark className="h-6 w-6" />
            <span className="sidebar-brand-text text-sm font-bold tracking-tight">
              RoleSpec
            </span>
            {collapseToggle && (
              <button
                type="button"
                onClick={collapseToggle.onToggle}
                aria-label="Collapse sidebar"
                aria-expanded
                title="Collapse sidebar"
                className="sidebar-toggle ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
              >
                <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            )}
          </>
        )}
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
              <p className="sidebar-group-label px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
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

      <div className="sidebar-footer shrink-0 space-y-1 border-t border-border px-3 py-4">
        <p className="sidebar-hint hidden px-2 pb-2 text-[11px] text-muted-foreground lg:block">
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
  const collapsed = useSyncExternalStore(
    subscribeToSidebar,
    sidebarIsCollapsed,
    () => false
  )

  const toggle = useCallback(() => {
    const next = !sidebarIsCollapsed()
    applySidebarState(next)
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0")
    } catch {
      // Storage can be blocked (private mode); the rail still collapses for
      // this session because the attribute is what drives the layout.
    }
    window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT))
  }, [])

  return (
    <aside
      aria-label="Primary"
      data-collapsed={collapsed ? "true" : "false"}
      className="app-sidebar fixed left-0 top-0 z-[var(--z-sidebar)] hidden h-screen flex-col border-r border-border bg-sidebar lg:flex"
    >
      <SidebarNav collapseToggle={{ collapsed, onToggle: toggle }} />
    </aside>
  )
})
