"use client"

import { useCallback, useSyncExternalStore } from "react"
import {
  applyMotion,
  getStoredMotion,
  storeMotion,
  resolveMotion,
  REDUCED_MOTION_QUERY,
  DEFAULT_MOTION_MODE,
  type MotionMode,
} from "@/shared/lib/theme"

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

let media: MediaQueryList | null = null

function handleMotionChange() {
  if (getStoredMotion() !== "system") return
  applyMotion("system")
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!media && typeof window !== "undefined" && window.matchMedia) {
    media = window.matchMedia(REDUCED_MOTION_QUERY)
    media.addEventListener("change", handleMotionChange)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && media) {
      media.removeEventListener("change", handleMotionChange)
      media = null
    }
  }
}

function getSnapshot(): MotionMode {
  return getStoredMotion()
}

function getServerSnapshot(): MotionMode {
  return DEFAULT_MOTION_MODE
}

export function useMotionMode() {
  const motionMode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setMotionMode = useCallback((next: MotionMode) => {
    applyMotion(next)
    storeMotion(next)
    emit()
  }, [])

  const isReducedMotion = resolveMotion(motionMode)

  return {
    motionMode,
    setMotionMode,
    isReducedMotion,
  }
}
