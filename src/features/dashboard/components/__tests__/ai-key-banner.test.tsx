import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { AiKeyBanner, shouldShowAiKeyBanner } from "../ai-key-banner"

afterEach(cleanup)

describe("shouldShowAiKeyBanner", () => {
  it("shows when no usable AI configuration exists", () => {
    expect(shouldShowAiKeyBanner({ hasUsableKey: false })).toBe(true)
  })

  it("hides once a usable provider/key exists", () => {
    expect(shouldShowAiKeyBanner({ hasUsableKey: true })).toBe(false)
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
