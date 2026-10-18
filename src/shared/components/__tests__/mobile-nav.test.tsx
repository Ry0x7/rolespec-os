import { describe, it, expect, afterEach, beforeAll, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MobileNav } from "../mobile-nav"

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}))

vi.mock("../sidebar", () => ({
  SidebarNav: () => (
    <nav>
      <a href="#dashboard">Dashboard</a>
      <a href="#resumes">Resumes</a>
    </nav>
  ),
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

// The drawer is a lazily imported chunk, so opening it resolves a promise before
// anything inside it is in the DOM.
async function openDrawer() {
  render(<MobileNav />)
  const trigger = screen.getByRole("button", { name: "Open navigation" })
  fireEvent.click(trigger)
  // Generous timeout: the first resolution in a run pays the module import cost,
  // which can exceed the 1s default when the suite runs in parallel.
  await screen.findByRole(
    "button",
    { name: "Close navigation" },
    { timeout: 10_000 }
  )
  return trigger
}

describe("MobileNav focus management", () => {
  it("moves focus into the drawer on open", async () => {
    await openDrawer()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close navigation" })
    )
  })

  it("wraps Tab from the last focusable back to the first", async () => {
    await openDrawer()
    const closeButton = screen.getByRole("button", { name: "Close navigation" })
    const last = screen.getByRole("link", { name: "Resumes" })
    last.focus()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(document.activeElement).toBe(closeButton)
  })

  it("wraps Shift+Tab from the first focusable to the last", async () => {
    await openDrawer()
    const closeButton = screen.getByRole("button", { name: "Close navigation" })
    closeButton.focus()
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Resumes" })
    )
  })

  it("pulls focus back inside when it has escaped the drawer", async () => {
    const trigger = await openDrawer()
    trigger.focus()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close navigation" })
    )
  })

  it("restores focus to the trigger when closed with Escape", async () => {
    const trigger = await openDrawer()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.activeElement).toBe(trigger)
  })
})
