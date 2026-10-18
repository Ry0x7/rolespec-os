import { describe, it, expect, afterEach, beforeEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"
import { AppearanceForm } from "../appearance-form"
import {
  ACCENT_STORAGE_KEY,
  ACCENT_THEMES,
  MODE_STORAGE_KEY,
  THEME_MODES,
} from "@/shared/lib/theme"

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.className = "dark"
})

afterEach(cleanup)

describe("AppearanceForm", () => {
  it("renders one swatch per shipped accent", () => {
    render(<AppearanceForm />)

    for (const accent of ACCENT_THEMES) {
      expect(screen.getByRole("button", { name: accent.label })).toBeTruthy()
    }
    expect(screen.getAllByRole("button")).toHaveLength(
      ACCENT_THEMES.length + THEME_MODES.length
    )
  })

  it("renders one button per colour mode", () => {
    render(<AppearanceForm />)

    for (const mode of THEME_MODES) {
      expect(screen.getByRole("button", { name: mode.label })).toBeTruthy()
    }
  })

  it("marks dark as the pressed mode on first render", () => {
    render(<AppearanceForm />)

    expect(
      screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")
    ).toBe("false")
  })

  it("persists the mode and flips the html classes", () => {
    render(<AppearanceForm />)

    fireEvent.click(screen.getByRole("button", { name: "Light" }))

    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe("light")
    expect(document.documentElement.classList.contains("light")).toBe(true)
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(
      screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")
    ).toBe("true")
  })

  it("switches back to dark", () => {
    render(<AppearanceForm />)

    fireEvent.click(screen.getByRole("button", { name: "Light" }))
    fireEvent.click(screen.getByRole("button", { name: "Dark" }))

    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.classList.contains("light")).toBe(false)
  })

  it("restores a stored mode on mount", () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, "system")

    render(<AppearanceForm />)

    expect(
      screen.getByRole("button", { name: "System" }).getAttribute("aria-pressed")
    ).toBe("true")
  })

  it("marks the default accent as pressed on first render", () => {
    render(<AppearanceForm />)

    expect(
      screen.getByRole("button", { name: "Violet" }).getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      screen.getByRole("button", { name: "Emerald" }).getAttribute("aria-pressed")
    ).toBe("false")
  })

  it("persists the pick and applies the html class", () => {
    render(<AppearanceForm />)

    fireEvent.click(screen.getByRole("button", { name: "Emerald" }))

    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("emerald")
    expect(document.documentElement.classList.contains("theme-emerald")).toBe(true)
    expect(
      screen.getByRole("button", { name: "Emerald" }).getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      screen.getByRole("button", { name: "Violet" }).getAttribute("aria-pressed")
    ).toBe("false")
  })

  it("swaps the html class when picking a second accent", () => {
    render(<AppearanceForm />)

    fireEvent.click(screen.getByRole("button", { name: "Emerald" }))
    fireEvent.click(screen.getByRole("button", { name: "Rose" }))

    expect(document.documentElement.classList.contains("theme-emerald")).toBe(false)
    expect(document.documentElement.classList.contains("theme-rose")).toBe(true)
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("rose")
  })

  it("restores a stored accent on mount", () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "cyan")

    render(<AppearanceForm />)

    expect(
      screen.getByRole("button", { name: "Cyan" }).getAttribute("aria-pressed")
    ).toBe("true")
  })
})
