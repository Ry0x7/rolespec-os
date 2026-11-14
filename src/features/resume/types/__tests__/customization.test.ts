import { describe, expect, it } from "vitest"
import {
  DEFAULT_CUSTOMIZATION,
  STYLE_PRESETS,
  activeStylePreset,
  customizationStorageKey,
  loadCustomization,
  parseCustomization,
  saveCustomization,
} from "../customization"

describe("parseCustomization", () => {
  it("falls back to defaults for junk input", () => {
    expect(parseCustomization(null)).toEqual(DEFAULT_CUSTOMIZATION)
    expect(parseCustomization("nope")).toEqual(DEFAULT_CUSTOMIZATION)
    expect(parseCustomization({ density: "huge", fontScale: 4, accent: "red" })).toEqual(
      DEFAULT_CUSTOMIZATION
    )
    // Unknown or missing alignment falls back to the default.
    expect(parseCustomization({ textAlign: "middle" }).textAlign).toBe("left")
    expect(parseCustomization({}).textAlign).toBe("left")
    expect(DEFAULT_CUSTOMIZATION.textAlign).toBe("left")
  })

  it("keeps every valid alignment", () => {
    for (const textAlign of ["left", "center", "right", "justify"] as const) {
      expect(parseCustomization({ textAlign }).textAlign).toBe(textAlign)
    }
  })

  it("keeps valid values", () => {
    expect(
      parseCustomization({
        density: "compact",
        fontFamily: "serif",
        fontScale: 1.1,
        accent: "#0F766E",
        margins: "relaxed",
        lineHeight: "snug",
        textAlign: "justify",
      })
    ).toEqual({
      density: "compact",
      fontFamily: "serif",
      fontScale: 1.1,
      accent: "#0F766E",
      margins: "relaxed",
      lineHeight: "snug",
      textAlign: "justify",
    })
  })
})

describe("style presets", () => {
  it("marks Classic as active on a fresh resume", () => {
    expect(activeStylePreset(DEFAULT_CUSTOMIZATION)).toBe("classic")
  })

  it("derives the active preset without storing an id", () => {
    const modern = STYLE_PRESETS.find((preset) => preset.id === "modern")!
    expect(activeStylePreset({ ...modern.values })).toBe("modern")

    // Every preset round-trips through the persisted shape intact.
    for (const preset of STYLE_PRESETS) {
      expect(activeStylePreset(parseCustomization(preset.values))).toBe(preset.id)
    }
  })

  it("drops back to no preset after a custom tweak", () => {
    const compact = STYLE_PRESETS.find((preset) => preset.id === "compact")!
    expect(activeStylePreset({ ...compact.values, accent: "#9d174d" })).toBeNull()
  })

  it("ignores an unknown stored style key", () => {
    expect(parseCustomization({ ...DEFAULT_CUSTOMIZATION, style: "neon" })).toEqual(
      DEFAULT_CUSTOMIZATION
    )
  })
})

describe("localStorage round trip", () => {
  it("saves and reloads per resume id", () => {
    window.localStorage.clear()
    expect(loadCustomization("r1")).toEqual(DEFAULT_CUSTOMIZATION)

    saveCustomization("r1", { ...DEFAULT_CUSTOMIZATION, density: "compact", accent: "#166534" })

    expect(window.localStorage.getItem(customizationStorageKey("r1"))).toBeTruthy()
    expect(loadCustomization("r1").density).toBe("compact")
    expect(loadCustomization("r1").accent).toBe("#166534")
    // A different resume keeps its own settings.
    expect(loadCustomization("r2")).toEqual(DEFAULT_CUSTOMIZATION)
  })

  it("recovers from corrupted storage", () => {
    window.localStorage.setItem(customizationStorageKey("r3"), "{not json")
    expect(loadCustomization("r3")).toEqual(DEFAULT_CUSTOMIZATION)
  })
})
