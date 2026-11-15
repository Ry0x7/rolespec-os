import { renderHook, act } from "@testing-library/react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { useMotionMode } from "../use-motion-mode"
import { MOTION_STORAGE_KEY } from "@/shared/lib/theme"

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.className = "dark"
})

function mockPrefersReduced(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useMotionMode", () => {
  it("defaults to system motion mode", () => {
    mockPrefersReduced(false)
    const { result } = renderHook(() => useMotionMode())
    expect(result.current.motionMode).toBe("system")
    expect(result.current.isReducedMotion).toBe(false)
  })

  it("reflects system prefers-reduced-motion when system is active", () => {
    mockPrefersReduced(true)
    const { result } = renderHook(() => useMotionMode())
    expect(result.current.motionMode).toBe("system")
    expect(result.current.isReducedMotion).toBe(true)
  })

  it("can explicitly enable reduced motion", () => {
    mockPrefersReduced(false)
    const { result } = renderHook(() => useMotionMode())

    act(() => {
      result.current.setMotionMode("reduced")
    })

    expect(result.current.motionMode).toBe("reduced")
    expect(result.current.isReducedMotion).toBe(true)
    expect(window.localStorage.getItem(MOTION_STORAGE_KEY)).toBe("reduced")
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(true)
  })

  it("can explicitly disable reduced motion (full motion)", () => {
    mockPrefersReduced(true)
    const { result } = renderHook(() => useMotionMode())

    act(() => {
      result.current.setMotionMode("full")
    })

    expect(result.current.motionMode).toBe("full")
    expect(result.current.isReducedMotion).toBe(false)
    expect(window.localStorage.getItem(MOTION_STORAGE_KEY)).toBe("full")
    expect(document.documentElement.classList.contains("motion-full")).toBe(true)
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(false)
  })
})
