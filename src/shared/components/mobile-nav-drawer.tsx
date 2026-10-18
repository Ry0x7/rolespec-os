"use client"

import { useEffect, useRef } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { X } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { variants } from "@/shared/lib/animations"
import { SidebarNav } from "./sidebar"

/**
 * The animated half of `MobileNav`, split out so framer-motion is not part of
 * the authenticated shell chunk: this module is only imported once the drawer is
 * first opened, which on desktop (`lg:hidden`) never happens.
 */
export function MobileNavDrawer({
  open,
  drawerRef,
  onClose,
}: {
  open: boolean
  drawerRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
}) {
  const reduceMotion = useReducedMotion()
  const closeRef = useRef<HTMLButtonElement>(null)

  // Move focus into the drawer on open. Lives here rather than in `MobileNav`
  // because on the very first open the close button does not exist until this
  // chunk has loaded.
  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  const duration = reduceMotion ? 0 : 0.2

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="overlay"
            {...variants.fadeIn}
            transition={{ duration }}
            onClick={onClose}
            className="fixed inset-0 z-[var(--z-overlay)] bg-background/80"
          />
          <motion.div
            key="drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            initial={{ x: reduceMotion ? 0 : "-100%", opacity: reduceMotion ? 0 : 1 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: reduceMotion ? 0 : "-100%", opacity: reduceMotion ? 0 : 1 }}
            transition={{ duration, ease: "easeOut" }}
            className="fixed left-0 top-0 z-[var(--z-overlay)] flex h-screen w-60 flex-col border-r border-border bg-sidebar shadow-lg"
          >
            <Button
              ref={closeRef}
              variant="ghost"
              size="icon"
              aria-label="Close navigation"
              onClick={onClose}
              className="absolute right-2 top-2"
            >
              <X className="h-4 w-4" />
            </Button>
            <SidebarNav onNavigate={onClose} />
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  )
}
