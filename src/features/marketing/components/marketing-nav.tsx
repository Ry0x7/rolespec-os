"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { EyeOff, Menu, Sparkles, X } from "lucide-react"
import { siteConfig } from "@/config/site"
import { Button, buttonVariants } from "@/shared/ui/button"
import { useLazyMotionReady } from "@/shared/hooks/use-lazy-motion-ready"
import { useMotionMode } from "@/shared/hooks/use-motion-mode"
import { cn } from "@/shared/lib/utils"
import { LogoMark } from "./logo-mark"

// The animated panel pulls in framer-motion, so it is a separate chunk fetched
// on the first hover/tap of the trigger. Until it lands the same panel markup
// renders without animation, so the menu always works.
const loadMenuPanel = () => import("./marketing-menu-panel")

const MarketingMenuPanel = dynamic(
  () => loadMenuPanel().then((m) => m.MarketingMenuPanel),
  { ssr: false }
)

const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#ai-stack", label: "AI Models" },
  { href: "/#pricing", label: "Self-hosting" },
]

export function MarketingNav() {
  const [open, setOpen] = useState(false)
  // Sticky once warmed, so the panel keeps its exit animation on close.
  const [panelRequested, setPanelRequested] = useState(false)
  const panelReady = useLazyMotionReady(loadMenuPanel, panelRequested)
  const pathname = usePathname()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  // Close on route change so a nav tap does not leave the panel hanging open.
  const [lastPathname, setLastPathname] = useState(pathname)
  if (lastPathname !== pathname) {
    setLastPathname(pathname)
    setOpen(false)
  }

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  // Return focus to the trigger on close.
  useEffect(() => {
    if (!open && wasOpen.current) {
      triggerRef.current?.focus()
    }
    wasOpen.current = open
  }, [open])

  function toggleNav() {
    setPanelRequested(true)
    setOpen((prev) => !prev)
  }

  const { setMotionMode, isReducedMotion } = useMotionMode()

  function toggleMotion() {
    if (isReducedMotion) {
      setMotionMode("full")
    } else {
      setMotionMode("reduced")
    }
  }

  const menuLinks = (
    <ul className="mx-auto w-full max-w-6xl px-4 py-2 sm:px-6">
      {NAV_LINKS.map((link) => (
        <li key={link.href}>
          <Link
            href={link.href}
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {link.label}
          </Link>
        </li>
      ))}
      <li className="sm:hidden">
        <Link
          href="/dashboard"
          onClick={() => setOpen(false)}
          className="flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Open workspace
        </Link>
      </li>
      <li className="pt-2 border-t border-border/50">
        <button
          type="button"
          onClick={toggleMotion}
          className="flex min-h-11 w-full items-center justify-between text-sm text-muted-foreground hover:text-foreground"
        >
          <span className="flex items-center gap-2">
            {isReducedMotion ? <EyeOff className="h-4 w-4 text-brand-400" /> : <Sparkles className="h-4 w-4 text-brand-400" />}
            <span>Reduce motion</span>
          </span>
          <span className="font-mono text-xs rounded bg-muted px-2 py-0.5">
            {isReducedMotion ? "Enabled" : "Disabled"}
          </span>
        </button>
      </li>
    </ul>
  )

  return (
    <header className="glass sticky top-0 z-50 w-full bg-background/72 backdrop-blur-xl">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-6"
      >
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <LogoMark className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight">
            {siteConfig.name}
          </span>
        </Link>

        <ul className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={cn(
                  "inline-flex min-h-11 items-center transition-colors hover:text-foreground",
                  pathname === link.href && "text-foreground"
                )}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleMotion}
            aria-label={
              isReducedMotion
                ? "Reduced motion active. Click to enable full animations."
                : "Full animations active. Click to enable reduced motion."
            }
            title={
              isReducedMotion
                ? "Reduced motion active (click to enable full motion)"
                : "Full motion active (click to enable reduced motion)"
            }
            className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground h-9 px-2.5 rounded-full hover:bg-muted"
          >
            {isReducedMotion ? (
              <>
                <EyeOff className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                <span>Reduced</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 text-brand-400" aria-hidden="true" />
                <span>Motion</span>
              </>
            )}
          </Button>

          <Link
            href="/dashboard"
            className={cn(buttonVariants({ size: "sm" }), "min-h-11 rounded-full px-4")}
          >
            Open workspace
          </Link>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="marketing-mobile-menu"
            onClick={toggleNav}
            // Warm the chunk before the tap lands so the panel animates.
            onPointerEnter={() => setPanelRequested(true)}
            onTouchStart={() => setPanelRequested(true)}
            className="h-11 w-11 rounded-full md:hidden"
          >
            {open ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>
        </div>
      </nav>

      {panelReady ? (
        <MarketingMenuPanel open={open}>{menuLinks}</MarketingMenuPanel>
      ) : open ? (
        <div
          id="marketing-mobile-menu"
          className="overflow-hidden border-t border-border bg-card md:hidden"
        >
          {menuLinks}
        </div>
      ) : null}
    </header>
  )
}
