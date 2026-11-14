import { describe, it, expect, afterEach, beforeEach } from "vitest"
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react"
import { AppearanceForm } from "../appearance-form"
import {
  ACCENT_STORAGE_KEY,
  ACCENT_THEMES,
  MODE_STORAGE_KEY,
  MOTION_MODES,
  PRESET_STORAGE_KEY,
  THEME_MODES,
  THEME_PRESETS,
} from "@/shared/lib/theme"
import { NOTIFICATION_SOUND_STORAGE_KEY } from "@/shared/lib/notification-sound"

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
      ACCENT_THEMES.length +
        THEME_MODES.length +
        MOTION_MODES.length +
        THEME_PRESETS.length +
        1
    )
  })

  it("renders one button per theme style and applies the preset class", () => {
    render(<AppearanceForm />)

    const group = screen.getByRole("group", { name: "Theme style" })
    for (const preset of THEME_PRESETS) {
      expect(within(group).getByRole("button", { name: new RegExp(preset.label) })).toBeTruthy()
    }

    fireEvent.click(within(group).getByRole("button", { name: /Ocean/ }))

    expect(window.localStorage.getItem(PRESET_STORAGE_KEY)).toBe("ocean")
    expect(document.documentElement.classList.contains("preset-ocean")).toBe(true)
    expect(
      within(group).getByRole("button", { name: /Ocean/ }).getAttribute("aria-pressed")
    ).toBe("true")
  })

  it("restores a stored theme style on mount", () => {
    window.localStorage.setItem(PRESET_STORAGE_KEY, "warm")

    render(<AppearanceForm />)

    // The class is applied by the pre-paint script in production; the form only
    // reads storage, so assert the selected chip rather than the class here.
    expect(
      screen.getByRole("button", { name: /Warm/ }).getAttribute("aria-pressed")
    ).toBe("true")
  })

  it("defaults the notification sound to Chime and persists a new choice", () => {
    render(<AppearanceForm />)

    const picker = screen.getByRole("combobox", { name: "Notification sound" }) as HTMLSelectElement
    expect(picker.value).toBe("chime")

    fireEvent.change(picker, { target: { value: "ping" } })

    expect(window.localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY)).toBe("ping")
    expect(picker.value).toBe("ping")
  })

  it("renders one button per colour mode", () => {
    render(<AppearanceForm />)

    const group = screen.getByRole("group", { name: "Colour mode" })
    for (const mode of THEME_MODES) {
      expect(within(group).getByRole("button", { name: mode.label })).toBeTruthy()
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

    const group = screen.getByRole("group", { name: "Colour mode" })
    expect(
      within(group).getByRole("button", { name: "System" }).getAttribute("aria-pressed")
    ).toBe("true")
  })

  it("marks the default accent as pressed on first render", () => {
    render(<AppearanceForm />)

    expect(
      screen.getByRole("button", { name: "Blue" }).getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      screen.getByRole("button", { name: "Violet" }).getAttribute("aria-pressed")
    ).toBe("false")
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
      screen.getByRole("button", { name: "Blue" }).getAttribute("aria-pressed")
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
