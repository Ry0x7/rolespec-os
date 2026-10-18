import { describe, it, expect, afterEach, beforeAll, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MarketingNav } from "../marketing-nav"

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}))

beforeAll(() => {
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
})

afterEach(cleanup)

function openMenu() {
  render(<MarketingNav />)
  const trigger = screen.getByRole("button", { name: "Open menu" })
  fireEvent.click(trigger)
  return trigger
}

describe("MarketingNav mobile menu", () => {
  it("is closed by default with aria-expanded false", () => {
    render(<MarketingNav />)
    const trigger = screen.getByRole("button", { name: "Open menu" })
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(document.getElementById("marketing-mobile-menu")).toBeNull()
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull()
    expect(screen.getByRole("link", { name: "Create account" }).getAttribute("href")).toBe("/sign-up")
  })

  it("opens the panel with the nav links and Sign in", () => {
    const trigger = openMenu()
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    const panel = document.getElementById("marketing-mobile-menu")
    expect(panel).not.toBeNull()
    for (const label of ["Features", "How it works", "Self-hosting", "Sign in"]) {
      expect(
        screen.getAllByRole("link", { name: label }).length
      ).toBeGreaterThan(0)
    }
  })

  it("closes when the trigger is pressed again", () => {
    openMenu()
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }))
    expect(
      screen
        .getByRole("button", { name: "Open menu" })
        .getAttribute("aria-expanded")
    ).toBe("false")
  })

  it("closes on Escape and restores focus to the trigger", () => {
    const trigger = openMenu()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(trigger)
  })

  it("closes when a menu link is clicked", () => {
    openMenu()
    const panel = document.getElementById("marketing-mobile-menu")
    expect(panel).not.toBeNull()
    const link = panel!.querySelector<HTMLAnchorElement>('a[href="/#pricing"]')
    expect(link).not.toBeNull()
    fireEvent.click(link!)
    expect(
      screen
        .getByRole("button", { name: "Open menu" })
        .getAttribute("aria-expanded")
    ).toBe("false")
  })
})
