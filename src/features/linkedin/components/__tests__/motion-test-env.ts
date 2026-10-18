import { vi } from "vitest"

/**
 * jsdom ships neither `matchMedia` nor `IntersectionObserver`, both of which
 * Framer Motion needs for the scroll reveals (`whileInView` + `useReducedMotion`)
 * in the LinkedIn view. Call once from `beforeAll`.
 */
export function installMotionTestEnv() {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  if (!("IntersectionObserver" in window)) {
    class StubIntersectionObserver {
      root = null
      rootMargin = ""
      thresholds: number[] = []
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
    vi.stubGlobal("IntersectionObserver", StubIntersectionObserver)
  }
}
