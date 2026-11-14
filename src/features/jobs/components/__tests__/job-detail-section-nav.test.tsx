import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import {
  JobDetailSectionNav,
  JOB_DETAIL_SECTIONS,
} from "../job-detail-section-nav"

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void

let lastCallback: ObserverCallback | null = null

/** jsdom ships no IntersectionObserver, so the active-section logic needs one. */
class StubIntersectionObserver {
  constructor(callback: ObserverCallback) {
    lastCallback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

function entryFor(id: string, top: number, isIntersecting = true) {
  const element = document.getElementById(id) as HTMLElement
  return {
    target: element,
    isIntersecting,
    boundingClientRect: { top } as DOMRectReadOnly,
  } as unknown as IntersectionObserverEntry
}

/** The page renders the four anchors; the nav only reads them back. */
function renderWithSections() {
  const host = document.createElement("div")
  JOB_DETAIL_SECTIONS.forEach((section) => {
    const node = document.createElement("section")
    node.id = section.key
    host.append(node)
  })
  document.body.append(host)
  return render(<JobDetailSectionNav />)
}

beforeEach(() => {
  lastCallback = null
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver)
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

describe("JobDetailSectionNav", () => {
  it("renders one link per section pointed at that section's anchor", () => {
    renderWithSections()

    expect(screen.getByRole("link", { name: "Decide" }).getAttribute("href")).toBe(
      "#decide"
    )
    expect(screen.getByRole("link", { name: "Prepare" }).getAttribute("href")).toBe(
      "#prepare"
    )
    expect(screen.getByRole("link", { name: "Track" }).getAttribute("href")).toBe(
      "#track"
    )
    expect(screen.getByRole("link", { name: "Posting" }).getAttribute("href")).toBe(
      "#posting"
    )
    expect(screen.getAllByRole("link")).toHaveLength(4)
  })

  it("marks nothing current before the observer has reported anything", () => {
    renderWithSections()

    expect(
      screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current"))
    ).toHaveLength(0)
  })

  it("moves the active state to whichever observed section is nearest the top", () => {
    renderWithSections()

    act(() => {
      lastCallback?.([entryFor("prepare", 120), entryFor("track", 640)])
    })
    expect(screen.getByRole("link", { name: "Prepare" }).getAttribute("aria-current")).toBe(
      "true"
    )
    expect(screen.getByRole("link", { name: "Track" }).getAttribute("aria-current")).toBeNull()

    act(() => {
      lastCallback?.([entryFor("prepare", -300, false), entryFor("track", 90)])
    })
    expect(screen.getByRole("link", { name: "Track" }).getAttribute("aria-current")).toBe(
      "true"
    )
    expect(
      screen.getByRole("link", { name: "Prepare" }).getAttribute("aria-current")
    ).toBeNull()
  })

  it("scrolls a deep-linked section into view once on mount", async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    window.history.replaceState(null, "", "#track")

    renderWithSections()
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("track"))
    window.history.replaceState(null, "", window.location.pathname)
  })

  it("ignores a hash that is not one of its sections", async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    window.history.replaceState(null, "", "#elsewhere")

    renderWithSections()
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))

    expect(scrollIntoView).not.toHaveBeenCalled()
    window.history.replaceState(null, "", window.location.pathname)
  })
})
