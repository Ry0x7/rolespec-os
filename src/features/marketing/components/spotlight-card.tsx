"use client"

import { useRef, useState, type ReactNode, type MouseEvent } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { cn } from "@/shared/lib/utils"

interface SpotlightCardProps {
  children: ReactNode
  className?: string
}

export function SpotlightCard({
  children,
  className,
}: SpotlightCardProps) {
  const divRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [opacity, setOpacity] = useState(0)
  const reduceMotion = useReducedMotion()

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!divRef.current) return
    const rect = divRef.current.getBoundingClientRect()
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const handleMouseEnter = () => setOpacity(1)
  const handleMouseLeave = () => setOpacity(0)

  return (
    <motion.div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      whileHover={reduceMotion ? undefined : { y: -4, transition: { duration: 0.2, ease: "easeOut" } }}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-card/60 p-6 backdrop-blur-sm transition-colors hover:border-brand-500/50",
        className
      )}
    >
      {/* Spotlight glow following cursor */}
      <div
        className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition-opacity duration-300"
        style={{
          opacity,
          background: `radial-gradient(400px circle at ${position.x}px ${position.y}px, rgba(168, 85, 247, 0.15), transparent 80%)`,
        }}
      />
      {/* Glowing subtle border hairline on hover */}
      <div
        className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition-opacity duration-300"
        style={{
          opacity,
          background: `radial-gradient(250px circle at ${position.x}px ${position.y}px, rgba(168, 85, 247, 0.4), transparent 70%)`,
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "xor",
          WebkitMaskComposite: "xor",
          padding: "1px",
        }}
      />
      <div className="relative z-10">{children}</div>
    </motion.div>
  )
}
