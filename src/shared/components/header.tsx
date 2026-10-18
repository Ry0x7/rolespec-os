"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { LogOut, Settings } from "lucide-react"
import { signOutAction } from "@/features/auth/actions"
import { getPageTitle } from "@/config/navigation"
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

export function Header() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const title = getPageTitle(pathname)
  const user = session?.user

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur-sm lg:px-6">
      <MobileNav />
      <p className="truncate text-sm font-medium text-foreground">{title}</p>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground transition-colors duration-150 hover:bg-input active:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {initialOf(user?.name, user?.email)}
          </DropdownMenuTrigger>
          <DropdownMenuContent label="Account">
            <DropdownMenuLabel className="truncate">
              {user?.email ?? "Signed in"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="h-4 w-4" aria-hidden="true" />
                Settings
              </Link>
            </DropdownMenuItem>
            {/* Kept as a form post so sign-out keeps the server-action redirect.
                closeOnSelect is off so the form is not unmounted mid-submit. */}
            <form action={signOutAction}>
              <DropdownMenuItem
                type="submit"
                variant="destructive"
                closeOnSelect={false}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
