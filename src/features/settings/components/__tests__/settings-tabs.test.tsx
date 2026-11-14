import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { SettingsTabs } from "../settings-tabs"

const { mockPathname } = vi.hoisted(() => ({ mockPathname: vi.fn() }))

vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }))

afterEach(cleanup)

/** The rail and the mobile pill row both render, so every tab appears twice. */
function tabs(name: string) {
  return screen.queryAllByRole("link", { name })
}

describe("SettingsTabs", () => {
  it("renders the primary settings tabs", () => {
    mockPathname.mockReturnValue("/settings/profile")
    render(<SettingsTabs />)

    expect(tabs("Profile").length).toBeGreaterThan(0)
    expect(tabs("AI model").length).toBeGreaterThan(0)
    expect(tabs("Browser extension").length).toBeGreaterThan(0)
    expect(tabs("Privacy & data").length).toBeGreaterThan(0)
  })

  it("marks the tab for the current route as the current page", () => {
    mockPathname.mockReturnValue("/settings/preferences")
    render(<SettingsTabs />)

    for (const link of tabs("Job preferences")) {
      expect(link.getAttribute("aria-current")).toBe("page")
    }
    for (const link of tabs("Profile")) {
      expect(link.getAttribute("aria-current")).toBeNull()
    }
  })
})
