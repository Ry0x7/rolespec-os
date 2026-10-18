import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  ACCENT_STORAGE_KEY,
  ACCENT_THEMES,
  DEFAULT_ACCENT_THEME,
  DEFAULT_THEME_MODE,
  MODE_STORAGE_KEY,
  THEME_MODES,
  applyMode,
  applyTheme,
  getStoredMode,
  getStoredTheme,
  isAccentTheme,
  isThemeMode,
  resolveMode,
  storeMode,
  storeTheme,
} from "../theme"

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.className = "dark"
})

/** jsdom never evaluates prefers-color-scheme, so `system` needs a stub. */
function mockPrefersDark(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("applyTheme", () => {
  it("adds the theme class for a non-default accent", () => {
    applyTheme("emerald")

    expect(document.documentElement.classList.contains("theme-emerald")).toBe(true)
    // The dark-only base class is never disturbed.
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("removes the previous theme class when switching", () => {
    applyTheme("emerald")
    applyTheme("rose")

    expect(document.documentElement.classList.contains("theme-emerald")).toBe(false)
    expect(document.documentElement.classList.contains("theme-rose")).toBe(true)
  })

  it("leaves no theme class for the default accent", () => {
    applyTheme("cyan")
    applyTheme(DEFAULT_ACCENT_THEME)

    const classes = Array.from(document.documentElement.classList)
    expect(classes.filter((name) => name.startsWith("theme-"))).toEqual([])
  })
})

describe("getStoredTheme", () => {
  it("returns the default when nothing is stored", () => {
    expect(getStoredTheme()).toBe(DEFAULT_ACCENT_THEME)
  })

  it("returns the default for a garbage value", () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "chartreuse")

    expect(getStoredTheme()).toBe(DEFAULT_ACCENT_THEME)
  })

  it("round-trips every shipped theme", () => {
    for (const accent of ACCENT_THEMES) {
      storeTheme(accent.id)
      expect(getStoredTheme()).toBe(accent.id)
    }
  })
})

describe("isAccentTheme", () => {
  it("accepts shipped ids and rejects anything else", () => {
    expect(isAccentTheme("blue")).toBe(true)
    expect(isAccentTheme("purple")).toBe(false)
    expect(isAccentTheme(null)).toBe(false)
  })
})

describe("applyMode", () => {
  it("swaps dark for light", () => {
    applyMode("light")

    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.classList.contains("light")).toBe(true)
  })

  it("swaps back to dark", () => {
    applyMode("light")
    applyMode("dark")

    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.classList.contains("light")).toBe(false)
  })

  it("leaves the accent class alone", () => {
    applyTheme("rose")
    applyMode("light")

    expect(document.documentElement.classList.contains("theme-rose")).toBe(true)
  })

  it("follows the OS preference for system mode", () => {
    mockPrefersDark(false)
    applyMode("system")
    expect(document.documentElement.classList.contains("light")).toBe(true)

    mockPrefersDark(true)
    applyMode("system")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.classList.contains("light")).toBe(false)
  })
})

describe("resolveMode", () => {
  it("passes explicit modes through", () => {
    expect(resolveMode("dark")).toBe("dark")
    expect(resolveMode("light")).toBe("light")
  })

  it("resolves system from matchMedia", () => {
    mockPrefersDark(true)
    expect(resolveMode("system")).toBe("dark")
    mockPrefersDark(false)
    expect(resolveMode("system")).toBe("light")
  })
})

describe("getStoredMode", () => {
  it("returns dark when nothing is stored", () => {
    expect(getStoredMode()).toBe(DEFAULT_THEME_MODE)
    expect(DEFAULT_THEME_MODE).toBe("dark")
  })

  it("returns the default for a garbage value", () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, "sepia")

    expect(getStoredMode()).toBe(DEFAULT_THEME_MODE)
  })

  it("round-trips every shipped mode", () => {
    for (const mode of THEME_MODES) {
      storeMode(mode.id)
      expect(getStoredMode()).toBe(mode.id)
    }
  })
})

describe("isThemeMode", () => {
  it("accepts shipped ids and rejects anything else", () => {
    expect(isThemeMode("system")).toBe(true)
    expect(isThemeMode("dim")).toBe(false)
    expect(isThemeMode(null)).toBe(false)
  })
})
