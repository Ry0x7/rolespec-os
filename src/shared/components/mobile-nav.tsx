"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"
import { Button } from "@/shared/ui/button"

// The drawer itself pulls in framer-motion, so it is a separate chunk fetched on
// the first open. Desktop viewports hide the trigger and never pay for it.
const MobileNavDrawer = dynamic(
  () => import("./mobile-nav-drawer").then((m) => m.MobileNavDrawer),
  { ssr: false }
)

export function MobileNav() {
  const [open, setOpen] = useState(false)
  // Sticky once opened, so the drawer stays mounted and can play its exit
  // animation on close.
  const [drawerLoaded, setDrawerLoaded] = useState(false)
  const pathname = usePathname()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)

  // Close on route change so a nav tap does not leave the drawer hanging open.
  const [lastPathname, setLastPathname] = useState(pathname)
  if (lastPathname !== pathname) {
    setLastPathname(pathname)
    setOpen(false)
  }

  // Escape closes; Tab is trapped inside the drawer while it is open.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
        return
      }
      if (event.key !== "Tab") return

      const drawer = drawerRef.current
      if (!drawer) return

      const focusables = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusables.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && drawer.contains(active)

      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  // Focus returns to the trigger on close. Moving focus *into* the drawer is the
  // drawer's own job, since it may not be mounted yet at the moment of opening.
  useEffect(() => {
    if (!open && wasOpen.current) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  function openNav() {
    setDrawerLoaded(true)
    setOpen(true)
  }

  return (
    <div className="lg:hidden">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={openNav}
        // Warm the chunk before the tap lands so the drawer opens without a gap.
        onPointerEnter={() => setDrawerLoaded(true)}
        onTouchStart={() => setDrawerLoaded(true)}
      >
        <Menu className="h-4 w-4" />
      </Button>

      {drawerLoaded ? (
        <MobileNavDrawer
          open={open}
          drawerRef={drawerRef}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}
