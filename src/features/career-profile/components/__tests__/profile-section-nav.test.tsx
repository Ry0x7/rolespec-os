import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ProfileSectionNav } from "../profile-section-nav"
import {
  computeSectionCompleteness,
  summarizeSectionCompleteness,
} from "../../lib/section-completeness"

afterEach(cleanup)

describe("computeSectionCompleteness", () => {
  it("marks every section incomplete for a brand-new profile", () => {
    const items = computeSectionCompleteness({
      contactFullName: null,
      contactEmail: null,
      experienceLevel: null,
      activeTargetRoleCount: 0,
      evidenceCount: 0,
      capabilityCount: 0,
    })

    expect(items.find((i) => i.key === "contact")?.complete).toBe(false)
    expect(items.find((i) => i.key === "preferences")?.complete).toBe(false)
    expect(items.find((i) => i.key === "target-roles")?.complete).toBe(false)
    expect(items.find((i) => i.key === "evidence")?.complete).toBe(false)
    expect(items.find((i) => i.key === "capabilities")?.complete).toBe(false)
    // LinkedIn import is a tool, not a record — it never gets a signal.
    expect(items.find((i) => i.key === "linkedin-import")?.complete).toBeNull()
  })

  it("requires both name and email for contact to count as complete", () => {
    const nameOnly = computeSectionCompleteness({
      contactFullName: "Jordan Lee",
      contactEmail: null,
      experienceLevel: null,
      activeTargetRoleCount: 0,
      evidenceCount: 0,
      capabilityCount: 0,
    })
    expect(nameOnly.find((i) => i.key === "contact")?.complete).toBe(false)

    const both = computeSectionCompleteness({
      contactFullName: "Jordan Lee",
      contactEmail: "jordan@example.com",
      experienceLevel: null,
      activeTargetRoleCount: 0,
      evidenceCount: 0,
      capabilityCount: 0,
    })
    expect(both.find((i) => i.key === "contact")?.complete).toBe(true)
  })

  it("treats a fully-filled profile as complete on every scored section", () => {
    const items = computeSectionCompleteness({
      contactFullName: "Jordan Lee",
      contactEmail: "jordan@example.com",
      experienceLevel: "MID",
      activeTargetRoleCount: 2,
      evidenceCount: 5,
      capabilityCount: 3,
    })

    expect(summarizeSectionCompleteness(items)).toEqual({ complete: 5, total: 5 })
  })

  it("only counts a target role as complete once at least one is active", () => {
    const items = computeSectionCompleteness({
      contactFullName: null,
      contactEmail: null,
      experienceLevel: null,
      activeTargetRoleCount: 0,
      evidenceCount: 0,
      capabilityCount: 0,
    })
    expect(items.find((i) => i.key === "target-roles")?.complete).toBe(false)
  })
})

describe("ProfileSectionNav", () => {
  const items = computeSectionCompleteness({
    contactFullName: "Jordan Lee",
    contactEmail: "jordan@example.com",
    experienceLevel: null,
    activeTargetRoleCount: 0,
    evidenceCount: 0,
    capabilityCount: 0,
  })

  it("renders one anchor per section pointed at that section's id", () => {
    render(<ProfileSectionNav items={items} />)

    expect(
      screen.getByRole("link", { name: /Contact/ }).getAttribute("href")
    ).toBe("#contact")
    expect(
      screen.getByRole("link", { name: /Preferences/ }).getAttribute("href")
    ).toBe("#preferences")
    expect(
      screen.getByRole("link", { name: /Target roles/ }).getAttribute("href")
    ).toBe("#target-roles")
    expect(
      screen.getByRole("link", { name: "LinkedIn import" }).getAttribute("href")
    ).toBe("#linkedin-import")
    expect(
      screen.getByRole("link", { name: /Evidence/ }).getAttribute("href")
    ).toBe("#evidence")
    expect(
      screen.getByRole("link", { name: /Capabilities/ }).getAttribute("href")
    ).toBe("#capabilities")
  })

  it("labels a complete section distinctly from an incomplete one", () => {
    render(<ProfileSectionNav items={items} />)

    expect(screen.getByRole("link", { name: "Contact — complete" })).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Preferences — incomplete" })
    ).toBeTruthy()
  })

  it("gives the neutral LinkedIn import item no completeness label", () => {
    render(<ProfileSectionNav items={items} />)
    expect(screen.getByRole("link", { name: "LinkedIn import" })).toBeTruthy()
  })
})

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

describe("ProfileSectionNav active section", () => {
  const items = computeSectionCompleteness({
    contactFullName: "Jordan Lee",
    contactEmail: "jordan@example.com",
    experienceLevel: null,
    activeTargetRoleCount: 0,
    evidenceCount: 0,
    capabilityCount: 0,
  })

  /** The page renders the six anchors; the nav only reads them back. */
  function renderWithSections() {
    const host = document.createElement("div")
    items.forEach((item) => {
      const node = document.createElement("div")
      node.id = item.key
      host.append(node)
    })
    document.body.append(host)
    return render(<ProfileSectionNav items={items} />)
  }

  function currentLinks() {
    return screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current"))
  }

  beforeEach(() => {
    lastCallback = null
    vi.stubGlobal("IntersectionObserver", StubIntersectionObserver)
  })

  afterEach(() => {
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
  })

  it("marks nothing current before the observer has reported anything", () => {
    renderWithSections()
    expect(currentLinks()).toHaveLength(0)
  })

  it("moves aria-current=location to the observed section and styles it active", () => {
    renderWithSections()

    act(() => {
      lastCallback?.([entryFor("evidence", 120), entryFor("capabilities", 640)])
    })
    const evidence = screen.getByRole("link", { name: /Evidence/ })
    expect(evidence.getAttribute("aria-current")).toBe("location")
    expect(evidence.className).toContain("bg-muted")
    expect(evidence.className).toContain("text-foreground")
    expect(currentLinks()).toHaveLength(1)

    act(() => {
      lastCallback?.([entryFor("evidence", -300, false), entryFor("capabilities", 90)])
    })
    expect(
      screen.getByRole("link", { name: /Capabilities/ }).getAttribute("aria-current")
    ).toBe("location")
    expect(
      screen.getByRole("link", { name: /Evidence/ }).getAttribute("aria-current")
    ).toBeNull()
  })

  it("keeps the completeness label and checkmark on the active item", () => {
    renderWithSections()

    act(() => {
      lastCallback?.([entryFor("contact", 120)])
    })
    const contact = screen.getByRole("link", { name: "Contact — complete" })
    expect(contact.getAttribute("aria-current")).toBe("location")
    expect(contact.querySelector("svg")).not.toBeNull()
  })

  it("on click scrolls to the section, marks it current and writes the hash", () => {
    renderWithSections()
    const scrollIntoView = vi.fn()
    ;(document.getElementById("evidence") as HTMLElement).scrollIntoView =
      scrollIntoView
    const replaceState = vi.spyOn(history, "replaceState")

    fireEvent.click(screen.getByRole("link", { name: /Evidence/ }))

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" })
    expect(replaceState).toHaveBeenCalledWith(null, "", "#evidence")
    expect(
      screen.getByRole("link", { name: /Evidence/ }).getAttribute("aria-current")
    ).toBe("location")
    replaceState.mockRestore()
  })
})
