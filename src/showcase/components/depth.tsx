import React, { useEffect, useRef, useState } from "react"
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion"

/**
 * Scroll and pointer depth for the showcase. Every effect here is decoration
 * on top of a page that already reads flat: with reduced motion, on touch
 * screens, or before JavaScript runs, the content is the same, only still.
 */

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener("change", update)
    return () => list.removeEventListener("change", update)
  }, [query])
  return matches
}

function motionIsReduced(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("reduce-motion")
}

/**
 * The product rises out of a tilted, receding plane and settles flat as the
 * reader scrolls toward it. The tilt is tied to scroll position, not a timer,
 * so it never plays while nobody is looking.
 */
export function ScrollShowcase({
  children,
  isReducedMotion,
  className,
}: {
  children: React.ReactNode
  isReducedMotion: boolean
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const narrow = useMediaQuery("(max-width: 640px)")
  const medium = useMediaQuery("(max-width: 1023px)")
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] })
  // Tipping the plane brings its lower edge toward the reader, which widens
  // it; the starting scale shrinks it back inside the column.
  const tilt = narrow ? 10 : medium ? 16 : 24
  const rotateX = useTransform(scrollYProgress, [0.3, 1], [tilt, 0])
  const scale = useTransform(scrollYProgress, [0.3, 1], [0.9, 1])
  const y = useTransform(scrollYProgress, [0.3, 1], [narrow ? 10 : 36, 0])

  return (
    <div ref={ref} className={`scroll-showcase ${className ?? ""}`} data-depth={isReducedMotion ? "flat" : "scroll"}>
      {isReducedMotion ? (
        <div className="scroll-showcase-plane">{children}</div>
      ) : (
        <motion.div className="scroll-showcase-plane" style={{ rotateX, scale, y, transformPerspective: 1400 }}>
          {children}
        </motion.div>
      )}
    </div>
  )
}

/**
 * Turns a block in from the side as it scrolls into view, then holds it flat.
 * `from` is the starting Y rotation in degrees; the sign picks the side.
 */
export function ScrollTurn({
  children,
  from,
  isReducedMotion,
}: {
  children: React.ReactNode
  from: number
  isReducedMotion: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const narrow = useMediaQuery("(max-width: 1023px)")
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center 0.6"] })
  const start = narrow ? 0 : from
  const rotateY: MotionValue<number> = useTransform(scrollYProgress, [0, 1], [start, 0])
  const x = useTransform(scrollYProgress, [0, 1], [narrow ? 0 : -Math.sign(from) * 24, 0])

  if (isReducedMotion) return <div ref={ref}>{children}</div>
  return (
    <div ref={ref} className="scroll-turn">
      <motion.div style={{ rotateY, x, transformPerspective: 1600 }}>{children}</motion.div>
    </div>
  )
}

/**
 * Pointer handlers that write the pointer position as CSS variables on the
 * element: `--mx`/`--my` for a spotlight, `--rx`/`--ry` for a small tilt
 * toward the pointer. CSS decides what to draw with them, and only under
 * `(hover: hover)`. Touch and pen input are ignored.
 */
export function pointerLight(maxTilt = 0) {
  return {
    onPointerMove(event: React.PointerEvent<HTMLElement>) {
      if (event.pointerType !== "mouse") return
      const el = event.currentTarget
      const rect = el.getBoundingClientRect()
      const px = (event.clientX - rect.left) / rect.width
      const py = (event.clientY - rect.top) / rect.height
      el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`)
      el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`)
      if (maxTilt > 0 && !motionIsReduced()) {
        el.style.setProperty("--rx", `${((0.5 - py) * maxTilt * 2).toFixed(2)}deg`)
        el.style.setProperty("--ry", `${((px - 0.5) * maxTilt * 2).toFixed(2)}deg`)
      }
    },
    onPointerLeave(event: React.PointerEvent<HTMLElement>) {
      event.currentTarget.style.setProperty("--rx", "0deg")
      event.currentTarget.style.setProperty("--ry", "0deg")
    },
  }
}

const SPOTLIGHT_HANDLERS = pointerLight()
/** Mock frames tip up to 4 degrees toward the pointer. */
export const STAGE_HANDLERS = pointerLight(4)

/** A surface with a soft light that follows the pointer and a small lift. */
export function SpotlightCard({
  children,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode
  className?: string
  as?: "div" | "article" | "li"
}) {
  return React.createElement(Tag, { ...SPOTLIGHT_HANDLERS, className: `spotlight-card ${className ?? ""}` }, children)
}
