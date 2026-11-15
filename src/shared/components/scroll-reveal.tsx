"use client"

import { createContext, useContext, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { useLazyMotionReady } from "@/shared/hooks/use-lazy-motion-ready"
import { cn } from "@/shared/lib/utils"

// The animated variants pull in framer-motion, so they live in a separate
// chunk fetched after hydration. The server ships the plain markup below, which
// is fully visible without JS.
const loadMotion = () => import("./scroll-reveal-motion")

const MotionScrollReveal = dynamic(
  () => loadMotion().then((m) => m.MotionScrollReveal),
  { ssr: false }
)
const MotionScrollRevealItem = dynamic(
  () => loadMotion().then((m) => m.MotionScrollRevealItem),
  { ssr: false }
)

/** True once the container has swapped in, so items swap in the same render. */
const MotionReadyContext = createContext(false)

interface ScrollRevealProps {
  children: ReactNode
  className?: string
}

interface ScrollRevealItemProps extends ScrollRevealProps {
  /** Render as a list item so cards can live directly inside a `ul`/`ol`. */
  as?: "div" | "li"
}

/**
 * Scroll-triggered reveal container. Children marked with `<ScrollRevealItem>`
 * fade up once the section enters the viewport, in document order. Only
 * opacity/transform animate, so nothing reflows. Until the framer-motion chunk
 * has loaded (and with JS off) the section renders as plain, visible markup.
 * With reduced motion the container starts resolved.
 */
export function ScrollReveal({ children, className }: ScrollRevealProps) {
  const ready = useLazyMotionReady(loadMotion)

  if (!ready) return <div className={className}>{children}</div>

  return (
    <MotionReadyContext.Provider value={true}>
      <MotionScrollReveal className={className}>{children}</MotionScrollReveal>
    </MotionReadyContext.Provider>
  )
}

/** A single staggered child of {@link ScrollReveal}. */
export function ScrollRevealItem({
  children,
  className,
  as = "div",
}: ScrollRevealItemProps) {
  const ready = useContext(MotionReadyContext)

  if (!ready) {
    const Item = as === "li" ? "li" : "div"
    return (
      <Item className={cn("scroll-reveal-item", className)}>{children}</Item>
    )
  }

  return (
    <MotionScrollRevealItem className={className} as={as}>
      {children}
    </MotionScrollRevealItem>
  )
}
