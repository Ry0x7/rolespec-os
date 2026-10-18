"use client"

import type { ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"

interface MarketingMenuPanelProps {
  open: boolean
  children: ReactNode
}

/**
 * framer-motion half of the marketing nav's mobile menu: the height/opacity
 * collapse plus its exit animation. Loaded as a separate chunk on the first
 * hover/tap of the trigger; until then the nav renders the same panel markup
 * without animation.
 */
export function MarketingMenuPanel({ open, children }: MarketingMenuPanelProps) {
  const reduceMotion = useReducedMotion()
  const duration = reduceMotion ? 0 : 0.2

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          id="marketing-mobile-menu"
          initial={{ opacity: reduceMotion ? 1 : 0, height: reduceMotion ? "auto" : 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: reduceMotion ? 1 : 0, height: reduceMotion ? "auto" : 0 }}
          transition={{ duration, ease: "easeOut" }}
          className="overflow-hidden border-t border-border bg-card md:hidden"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
