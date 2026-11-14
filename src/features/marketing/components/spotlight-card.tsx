"use client"

import type { ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { cn } from "@/shared/lib/utils"

interface SpotlightCardProps {
  children: ReactNode
  className?: string
}

/**
 * Plain surface card. The old cursor-spotlight lives on every card or none;
 * Apple restraint means the card is just a card with a quiet hover lift.
 */
export function SpotlightCard({ children, className }: SpotlightCardProps) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      whileHover={reduceMotion ? undefined : { y: -2, transition: { duration: 0.2, ease: "easeOut" } }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border bg-card p-6 transition-colors duration-200 hover:border-border",
        className
      )}
    >
      {children}
    </motion.div>
  )
}
