import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { AiKeyBanner, shouldShowAiKeyBanner } from "../ai-key-banner"

afterEach(cleanup)

describe("shouldShowAiKeyBanner", () => {
  it("shows for a non-admin without a usable key", () => {
    expect(shouldShowAiKeyBanner({ role: "USER", hasUsableKey: false })).toBe(true)
  })

  it("hides once the non-admin has a usable key", () => {
    expect(shouldShowAiKeyBanner({ role: "USER", hasUsableKey: true })).toBe(false)
  })

  it("never shows for an admin", () => {
    expect(shouldShowAiKeyBanner({ role: "ADMIN", hasUsableKey: false })).toBe(false)
    expect(shouldShowAiKeyBanner({ role: "ADMIN", hasUsableKey: true })).toBe(false)
  })

  it("shows when the role is unknown and no key is configured", () => {
    expect(shouldShowAiKeyBanner({ role: undefined, hasUsableKey: false })).toBe(true)
  })
})

describe("AiKeyBanner", () => {
  it("links to the AI settings page", () => {
    render(<AiKeyBanner />)
    const link = screen.getByRole("link", { name: "Add your key" })
    expect(link.getAttribute("href")).toBe("/settings/ai")
    expect(screen.getByText("AI features need your own API key")).toBeTruthy()
  })
})
