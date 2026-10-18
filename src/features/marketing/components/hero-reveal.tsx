"use client"

import { createContext, useContext, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { useLazyMotionReady } from "@/shared/hooks/use-lazy-motion-ready"
import { cn } from "@/shared/lib/utils"

// The animated variants pull in framer-motion, so they live in a separate
// chunk fetched after hydration. The server ships the plain markup below, which
// is fully visible without JS.
const loadMotion = () => import("./hero-reveal-motion")

const MotionHeroReveal = dynamic(
  () => loadMotion().then((m) => m.MotionHeroReveal),
  { ssr: false }
)
const MotionHeroRevealItem = dynamic(
  () => loadMotion().then((m) => m.MotionHeroRevealItem),
  { ssr: false }
)

/** True once the container has swapped in, so items swap in the same render. */
const MotionReadyContext = createContext(false)

interface HeroRevealProps {
  children: ReactNode
  className?: string
}

/**
 * Staggered entrance wrapper for the hero. Children marked with
 * `<HeroRevealItem>` fade up in document order once the framer-motion chunk
 * has loaded; before that (and with JS off) they render as plain, visible
 * elements. Reduced motion keeps the resolved state, so nothing animates.
 */
export function HeroReveal({ children, className }: HeroRevealProps) {
  const ready = useLazyMotionReady(loadMotion)

  if (!ready) return <div className={className}>{children}</div>

  return (
    <MotionReadyContext.Provider value={true}>
      <MotionHeroReveal className={className}>{children}</MotionHeroReveal>
    </MotionReadyContext.Provider>
  )
}

/** A single staggered child of {@link HeroReveal}. */
export function HeroRevealItem({ children, className }: HeroRevealProps) {
  const ready = useContext(MotionReadyContext)

  if (!ready) {
    return <div className={cn("hero-reveal-item", className)}>{children}</div>
  }

  return (
    <MotionHeroRevealItem className={className}>{children}</MotionHeroRevealItem>
  )
}
