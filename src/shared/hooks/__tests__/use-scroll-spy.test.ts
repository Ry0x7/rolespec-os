import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useScrollSpy } from "../use-scroll-spy"

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void

let lastCallback: ObserverCallback | null = null
let lastOptions: IntersectionObserverInit | undefined
let observedIds: string[] = []
let disconnects = 0

/** jsdom ships no IntersectionObserver, so the hook needs one. */
class StubIntersectionObserver {
  constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
    lastCallback = callback
    lastOptions = options
  }
  observe(element: Element) {
    observedIds.push(element.id)
  }
  unobserve() {}
  disconnect() {
    disconnects += 1
  }
  takeRecords() {
    return []
  }
}

const IDS = ["alpha", "beta", "gamma"]

function mountSections() {
  IDS.forEach((id) => {
    const node = document.createElement("section")
    node.id = id
    document.body.append(node)
  })
}

function entryFor(id: string, isIntersecting = true) {
  return {
    target: document.getElementById(id) as HTMLElement,
    isIntersecting,
  } as unknown as IntersectionObserverEntry
}

function setRect(id: string, top: number, bottom: number) {
  ;(document.getElementById(id) as HTMLElement).getBoundingClientRect = () =>
    ({ top, bottom }) as DOMRect
}

/**
 * `0.55 * 100` is `55.00000000000001` in floating point; the string is kept
 * byte-identical to the original Job Detail implementation, so the bottom inset
 * is compared numerically.
 */
function expectBand(rootMargin: string | undefined, topPx: number) {
  const match = /^-(\d+)px 0px -([\d.]+)% 0px$/.exec(rootMargin ?? "")
  expect(match).not.toBeNull()
  expect(Number(match![1])).toBe(topPx)
  expect(Number(match![2])).toBeCloseTo(55)
}

beforeEach(() => {
  lastCallback = null
  lastOptions = undefined
  observedIds = []
  disconnects = 0
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver)
  mountSections()
})

afterEach(() => {
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useScrollSpy", () => {
  it("observes every present section with the default 112px band and starts null", () => {
    const { result } = renderHook(() => useScrollSpy([...IDS, "missing"]))

    expect(result.current.activeId).toBeNull()
    expect(observedIds).toEqual(IDS)
    expectBand(lastOptions?.rootMargin, 112)
    expect(lastOptions?.threshold).toBe(0)
  })

  it("honors a custom bandTopPx", () => {
    renderHook(() => useScrollSpy(IDS, { bandTopPx: 80 }))
    expectBand(lastOptions?.rootMargin, 80)
  })

  it("falls back to page order on overlap ties and keeps a still-visible section", () => {
    const { result } = renderHook(() => useScrollSpy(IDS))

    act(() => lastCallback?.([entryFor("gamma"), entryFor("beta")]))
    expect(result.current.activeId).toBe("beta")

    // Only alpha's visibility changed; beta and gamma are still in the band.
    act(() => lastCallback?.([entryFor("alpha")]))
    expect(result.current.activeId).toBe("alpha")

    act(() => lastCallback?.([entryFor("alpha", false)]))
    expect(result.current.activeId).toBe("beta")
  })

  it("picks the section filling most of the band", () => {
    const { result } = renderHook(() => useScrollSpy(IDS))
    setRect("alpha", 0, 150) // 38px in the band
    setRect("beta", 150, 900) // fills the rest of the band

    act(() => lastCallback?.([entryFor("alpha"), entryFor("beta")]))
    expect(result.current.activeId).toBe("beta")
  })

  it("re-picks once per animation frame on scroll", () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb)
      return frames.length
    })
    const { result } = renderHook(() => useScrollSpy(IDS))
    setRect("alpha", 112, 400)
    setRect("beta", 400, 900)
    act(() => lastCallback?.([entryFor("alpha"), entryFor("beta")]))
    expect(result.current.activeId).toBe("alpha")

    // The page scrolled without a band crossing: beta now dominates.
    setRect("alpha", -200, 150)
    setRect("beta", 150, 700)
    act(() => {
      window.dispatchEvent(new Event("scroll"))
      window.dispatchEvent(new Event("scroll"))
    })
    expect(frames).toHaveLength(1)
    act(() => frames[0](0))
    expect(result.current.activeId).toBe("beta")
  })

  it("lets the caller set the active id directly", () => {
    const { result } = renderHook(() => useScrollSpy(IDS))
    act(() => result.current.setActiveId("gamma"))
    expect(result.current.activeId).toBe("gamma")
  })

  it("disconnects and stops listening to scroll on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener")
    const { unmount } = renderHook(() => useScrollSpy(IDS))
    unmount()
    expect(disconnects).toBe(1)
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function))
  })

  it("does not re-subscribe when re-rendered with an equal id list", () => {
    const { rerender } = renderHook(({ ids }) => useScrollSpy(ids), {
      initialProps: { ids: [...IDS] },
    })
    rerender({ ids: [...IDS] })
    expect(disconnects).toBe(0)
  })
})
