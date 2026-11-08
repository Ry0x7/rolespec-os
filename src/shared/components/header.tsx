"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Lock, Search, Settings } from "lucide-react"

import { lockWorkspaceAction } from "@/features/auth/unlock.actions"
import { getPageTitle } from "@/config/navigation"
import { Breadcrumbs } from "@/shared/components/breadcrumbs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu"
import { MobileNav } from "./mobile-nav"

function initialOf(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || ""
  return source.charAt(0).toUpperCase() || "?"
}

// Command palette is a separate chunk — fetched on first open/hover so the
// header stays light on initial paint. Cmd/Ctrl+K still works because the
// palette registers its own key listener once loaded; the header buttons
// preload on hover/focus as well.
const CommandPalette = dynamic(
  () => import("@/shared/components/command-palette").then((m) => m.CommandPalette),
  { ssr: false }
)

interface HeaderProps {
  owner: {
    name: string | null
    email: string
  }
  /** Only true behind the public key gate; a local instance has nothing to lock. */
  canLock?: boolean
}

export const Header = memo(function Header({ owner, canLock = false }: HeaderProps) {
  const pathname = usePathname()
  const title = useMemo(() => getPageTitle(pathname), [pathname])
  const [paletteToken, setPaletteToken] = useState(0)
  const [paletteArmed, setPaletteArmed] = useState(false)
  const openPalette = useCallback(() => {
    setPaletteArmed(true)
    setPaletteToken((n) => n + 1)
  }, [])
  const armPalette = useCallback(() => setPaletteArmed(true), [])
  // Cmd/Ctrl+K must work even before the palette chunk loads, so the header
  // owns the hotkey until the palette mounts — after that the palette's own
  // listener toggles (header stays out of the way to avoid double-toggle).
  useEffect(() => {
    if (paletteArmed) return
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        openPalette()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [openPalette, paletteArmed])

  return (
    <>
      {paletteArmed ? <CommandPalette openToken={paletteToken} /> : null}
      <header className="sticky top-0 z-[var(--z-sticky)] flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur-sm lg:px-6">
        <MobileNav />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <Breadcrumbs />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={openPalette}
            onPointerEnter={armPalette}
            onFocus={armPalette}
            className="hidden h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
            aria-label="Open quick actions (Control or Command K)"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-xs">Quick actions</span>
            <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={openPalette}
            onPointerEnter={armPalette}
            onFocus={armPalette}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            aria-label="Open quick actions"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Workspace menu"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground transition-colors duration-150 hover:bg-input active:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {initialOf(owner.name, owner.email)}
            </DropdownMenuTrigger>
            <DropdownMenuContent label="Workspace">
              <DropdownMenuLabel className="truncate">
                <span className="block truncate font-medium">{owner.name ?? "Owner"}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {owner.email}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings className="h-4 w-4" aria-hidden="true" />
                  Settings
                </Link>
              </DropdownMenuItem>
              {canLock ? (
                <form action={lockWorkspaceAction}>
                  <DropdownMenuItem
                    type="submit"
                    variant="destructive"
                    closeOnSelect={false}
                  >
                    <Lock className="h-4 w-4" aria-hidden="true" />
                    Lock workspace
                  </DropdownMenuItem>
                </form>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  )
})
