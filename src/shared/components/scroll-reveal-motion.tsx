"use client"

import type { ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { stagger } from "@/shared/lib/animations"
import { cn } from "@/shared/lib/utils"

/** expo-out — same curve as the marketing hero reveal. */
const EASE = [0.16, 1, 0.3, 1] as const

const containerVariants = {
  initial: {},
  animate: {
    transition: { ...stagger.container.animate.transition, staggerChildren: 0.06 },
  },
} as const

const itemVariants = {
  initial: { ...stagger.item.initial, y: 16 },
  animate: {
    ...stagger.item.animate,
    transition: { duration: 0.42, ease: EASE },
  },
} as const

interface MotionScrollRevealProps {
  children: ReactNode
  className?: string
}

interface MotionScrollRevealItemProps extends MotionScrollRevealProps {
  /** Render as a list item so cards can live directly inside a `ul`/`ol`. */
  as?: "div" | "li"
}

/**
 * framer-motion half of {@link import("./scroll-reveal").ScrollReveal}. Loaded
 * as a separate chunk after hydration; the plain wrapper is what ships in the
 * HTML, so the section is readable before (and without) JS.
 */
export function MotionScrollReveal({
  children,
  className,
}: MotionScrollRevealProps) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className={className}
      variants={containerVariants}
      initial={reduceMotion ? "animate" : "initial"}
      whileInView="animate"
      viewport={{ once: true, margin: "-80px" }}
    >
      {children}
    </motion.div>
  )
}

/** A single staggered child of {@link MotionScrollReveal}. */
export function MotionScrollRevealItem({
  children,
  className,
  as = "div",
}: MotionScrollRevealItemProps) {
  const Item = as === "li" ? motion.li : motion.div

  return (
    <Item className={cn("scroll-reveal-item", className)} variants={itemVariants}>
      {children}
    </Item>
  )
}
