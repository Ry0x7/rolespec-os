"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { memo, useCallback, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { CircleHelp, Lock, Search, Settings } from "lucide-react"

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
import { GuidedTour } from "./guided-tour"
import { startGuidedTour } from "@/shared/lib/guided-tour"
import { AttentionInbox } from "@/features/dashboard/components/attention-inbox"
import { WorkflowModeSwitch } from "@/features/workflows/components/workflow-mode-switch"

function initialOf(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || ""
  return source.charAt(0).toUpperCase() || "?"
}

// Keep the palette in a separate client chunk, mounted so its documented
// shortcuts work before the user has hovered over the search button.
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
  const openPalette = useCallback(() => {
    setPaletteToken((n) => n + 1)
  }, [])

  return (
    <>
      <CommandPalette openToken={paletteToken} />
      <GuidedTour />
      {/* Apple toolbar material: translucent + blur + saturation, content scrolls under. */}
      <header className="sticky top-0 z-[var(--z-sticky)] flex min-h-14 flex-wrap items-center gap-2 border-b border-border bg-background/72 px-4 py-1 backdrop-blur-xl lg:px-6">
        <MobileNav />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <Breadcrumbs />
        </div>

        <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
          <div className="hidden sm:block"><WorkflowModeSwitch compact /></div>
          <button
            type="button"
            onClick={startGuidedTour}
            aria-label="Open help and the guided tour"
            title="Help and guided tour"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CircleHelp className="h-4 w-4" aria-hidden="true" />
          </button>
          <AttentionInbox />
          <button
            type="button"
            onClick={openPalette}
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
