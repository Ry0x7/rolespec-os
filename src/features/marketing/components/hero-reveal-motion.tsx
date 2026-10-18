"use client"

import type { ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { stagger } from "@/shared/lib/animations"
import { cn } from "@/shared/lib/utils"

/** expo-out */
const EASE = [0.16, 1, 0.3, 1] as const

const containerVariants = {
  initial: {},
  animate: {
    transition: { ...stagger.container.animate.transition, staggerChildren: 0.08 },
  },
} as const

const itemVariants = {
  initial: { ...stagger.item.initial, y: 16 },
  animate: {
    ...stagger.item.animate,
    transition: { duration: 0.42, ease: EASE },
  },
} as const

interface MotionHeroRevealProps {
  children: ReactNode
  className?: string
}

/**
 * framer-motion half of {@link import("./hero-reveal").HeroReveal}. Loaded as a
 * separate chunk after hydration; the plain wrapper is what ships in the HTML.
 */
export function MotionHeroReveal({ children, className }: MotionHeroRevealProps) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className={className}
      variants={containerVariants}
      initial={reduceMotion ? "animate" : "initial"}
      animate="animate"
    >
      {children}
    </motion.div>
  )
}

/** A single staggered child of {@link MotionHeroReveal}. */
export function MotionHeroRevealItem({
  children,
  className,
}: MotionHeroRevealProps) {
  return (
    <motion.div
      className={cn("hero-reveal-item", className)}
      variants={itemVariants}
    >
      {children}
    </motion.div>
  )
}
