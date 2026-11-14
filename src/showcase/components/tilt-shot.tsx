import React, { useEffect, useRef, useState } from "react"
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion"
import { ShotImage } from "./shot-image"

/**
 * A product screenshot that lifts toward the pointer in 3D. The image inside
 * moves a little further than the frame, which gives the shallow parallax
 * pop that makes a real screenshot feel like an object rather than a flat
 * picture. Pointer-only by design: touch devices keep the static frame.
 */
export function TiltShot({
  light,
  dark,
  alt,
  width,
  height,
  loading,
  className = "",
  reducedMotion = false,
}: {
  light: string
  dark: string
  alt: string
  width: number
  height: number
  loading?: "lazy" | "eager"
  className?: string
  reducedMotion?: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [canHover, setCanHover] = useState(false)
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const active = useMotionValue(0)

  const smoothX = useSpring(pointerX, { stiffness: 260, damping: 28, mass: 0.5 })
  const smoothY = useSpring(pointerY, { stiffness: 260, damping: 28, mass: 0.5 })
  const smoothActive = useSpring(active, { stiffness: 220, damping: 30 })

  // The card presses away under the cursor (top under the top edge, right
  // under the right edge), while the screenshot itself drifts the other way.
  const rotateX = useTransform(smoothY, [-0.5, 0.5], [7, -7])
  const rotateY = useTransform(smoothX, [-0.5, 0.5], [-8, 8])
  const imageX = useTransform(smoothX, [-0.5, 0.5], [10, -10])
  const imageY = useTransform(smoothY, [-0.5, 0.5], [7, -7])
  const imageScale = useTransform(smoothActive, [0, 1], [1, 1.055])

  const glareX = useTransform(smoothX, [-0.5, 0.5], [18, 82])
  const glareY = useTransform(smoothY, [-0.5, 0.5], [18, 82])
  const glare = useMotionTemplate`radial-gradient(360px circle at ${glareX}% ${glareY}%, rgba(255,255,255,0.5), rgba(255,255,255,0.08) 38%, transparent 66%)`

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)")
    const update = () => setCanHover(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  const enabled = !reducedMotion && canHover

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!enabled || event.pointerType !== "mouse" || !frameRef.current) return
    const rect = frameRef.current.getBoundingClientRect()
    pointerX.set((event.clientX - rect.left) / rect.width - 0.5)
    pointerY.set((event.clientY - rect.top) / rect.height - 0.5)
    active.set(1)
  }

  function onPointerLeave() {
    pointerX.set(0)
    pointerY.set(0)
    active.set(0)
  }

  return (
    <div
      ref={frameRef}
      className={`tilt-scene ${className}`}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <motion.div
        className="shot tilt-card"
        style={
          enabled
            ? {
                rotateX,
                rotateY,
                transformPerspective: 1100,
              }
            : undefined
        }
        whileHover={enabled ? { scale: 1.02, y: -4 } : undefined}
        transition={{ type: "spring", stiffness: 250, damping: 26, mass: 0.7 }}
      >
        <motion.div
          className="tilt-media"
          style={enabled ? { x: imageX, y: imageY, scale: imageScale } : undefined}
        >
          <ShotImage
            light={light}
            dark={dark}
            alt={alt}
            width={width}
            height={height}
            loading={loading}
          />
        </motion.div>
        {enabled && (
          <motion.span
            aria-hidden="true"
            className="tilt-glare"
            style={{ background: glare }}
          />
        )}
      </motion.div>
    </div>
  )
}
