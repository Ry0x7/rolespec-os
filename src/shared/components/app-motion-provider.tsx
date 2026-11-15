"use client"

import * as React from "react"
import { MotionConfig } from "framer-motion"
import { useMotionMode } from "@/shared/hooks/use-motion-mode"

export function AppMotionProvider({ children }: { children: React.ReactNode }) {
  const { motionMode, isReducedMotion } = useMotionMode()

  const reducedMotionSetting = React.useMemo(() => {
    if (motionMode === "reduced") return "always"
    if (motionMode === "full") return "never"
    return "user"
  }, [motionMode])

  // Also ensure root element has matching attributes
  React.useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("reduce-motion", isReducedMotion)
      document.documentElement.classList.toggle("motion-full", motionMode === "full")
      document.documentElement.setAttribute("data-motion", motionMode)
    }
  }, [motionMode, isReducedMotion])

  return (
    <MotionConfig reducedMotion={reducedMotionSetting}>
      {children}
    </MotionConfig>
  )
}
