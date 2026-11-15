import { describe, expect, it } from "vitest"
import { DEFAULT_CUSTOMIZATION, type ResumeCustomization } from "@/features/resume/types/customization"
import { TEMPLATE_PDF_STYLES } from "../styles"
import { applyCustomizationToPdfConfig, resolvePdfConfig } from "../customize"

function customization(overrides: Partial<ResumeCustomization> = {}): ResumeCustomization {
  return { ...DEFAULT_CUSTOMIZATION, ...overrides }
}

const base = TEMPLATE_PDF_STYLES.MINIMAL

describe("applyCustomizationToPdfConfig", () => {
  it("returns the base config untouched when there is no customization", () => {
    expect(applyCustomizationToPdfConfig(base)).toBe(base)
  })

  it("is a no-op on values for the default customization", () => {
    const result = applyCustomizationToPdfConfig(base, customization())
    expect(result.body.fontSize).toBe(base.body.fontSize)
    expect(result.name.fontSize).toBe(base.name.fontSize)
    expect(result.page).toEqual(base.page)
    expect(result.sectionGap).toBe(base.sectionGap)
    expect(result.colors).toEqual(base.colors)
  })

  it("multiplies font sizes by fontScale", () => {
    const large = applyCustomizationToPdfConfig(base, customization({ fontScale: 1.1 }))
    expect(large.body.fontSize).toBeCloseTo(base.body.fontSize * 1.1, 1)
    expect(large.name.fontSize).toBeCloseTo(base.name.fontSize * 1.1, 1)
    expect(large.heading.fontSize).toBeCloseTo(base.heading.fontSize * 1.1, 1)

    const small = applyCustomizationToPdfConfig(base, customization({ fontScale: 0.9 }))
    expect(small.body.fontSize).toBeLessThan(base.body.fontSize)
  })

  it("maps margins to page padding", () => {
    const tight = applyCustomizationToPdfConfig(base, customization({ margins: "compact" }))
    const wide = applyCustomizationToPdfConfig(base, customization({ margins: "relaxed" }))

    // MINIMAL normal padding is 32pt (the preview's paddingPx) × MARGIN_SCALE.
    expect(tight.page).toEqual({ paddingTop: 24, paddingBottom: 24, paddingHorizontal: 24 })
    expect(wide.page).toEqual({ paddingTop: 40, paddingBottom: 40, paddingHorizontal: 40 })
  })

  it("replaces heading/accent/border colours with the accent hex", () => {
    const accented = applyCustomizationToPdfConfig(base, customization({ accent: "#9d174d" }))
    expect(accented.colors.accent).toBe("#9d174d")
    expect(accented.colors.heading).toBe("#9d174d")
    expect(accented.colors.border).toBe("#9d174d")
    // Body/muted text stays readable.
    expect(accented.colors.body).toBe(base.colors.body)
  })

  it("adjusts line height", () => {
    expect(applyCustomizationToPdfConfig(base, customization({ lineHeight: "snug" })).body.lineHeight)
      .toBeLessThan(base.body.lineHeight)
    expect(
      applyCustomizationToPdfConfig(base, customization({ lineHeight: "relaxed" })).body.lineHeight
    ).toBeGreaterThan(base.body.lineHeight)
  })

  it("swaps the font pair when the family is overridden", () => {
    const serif = applyCustomizationToPdfConfig(base, customization({ fontFamily: "serif" }))
    expect(serif.fontFamily).toBe("Times-Roman")
    expect(serif.boldFontFamily).toBe("Times-Bold")

    const harvardSans = applyCustomizationToPdfConfig(
      TEMPLATE_PDF_STYLES.HARVARD,
      customization({ fontFamily: "sans" })
    )
    // The sans pair is the embedded Inter — the same face the preview renders
    // via next/font — not Helvetica, whose narrower metrics wrapped differently.
    expect(harvardSans.fontFamily).toBe("Inter")

    const templateDefault = applyCustomizationToPdfConfig(
      TEMPLATE_PDF_STYLES.HARVARD,
      customization()
    )
    expect(templateDefault.fontFamily).toBe("Times-Roman")
  })

  it("tightens section rhythm in compact density", () => {
    const compact = applyCustomizationToPdfConfig(base, customization({ density: "compact" }))
    expect(compact.sectionGap).toBeLessThan(base.sectionGap)
    expect(compact.heading.marginBottom).toBeLessThan(base.heading.marginBottom)
  })

  it("swaps the whole metric table in compact density, not just the gaps", () => {
    const compact = applyCustomizationToPdfConfig(base, customization({ density: "compact" }))
    // Compact MINIMAL in the preview: padding 24, body 10.5, heading 10, name 18.
    expect(compact.page).toEqual({ paddingTop: 24, paddingBottom: 24, paddingHorizontal: 24 })
    expect(compact.body.fontSize).toBe(10.5)
    expect(compact.heading.fontSize).toBe(10)
    expect(compact.name.fontSize).toBe(18)
  })

  it("applies margins on top of the compact padding", () => {
    const compact = applyCustomizationToPdfConfig(
      base,
      customization({ density: "compact", margins: "relaxed" })
    )
    // round(24 * 1.25) = 30
    expect(compact.page.paddingTop).toBe(30)
  })
})

describe("resolvePdfConfig", () => {
  it("falls back to MINIMAL for unknown templates", () => {
    expect(resolvePdfConfig("NOPE")).toBe(TEMPLATE_PDF_STYLES.MINIMAL)
  })

  it("resolves per template", () => {
    expect(resolvePdfConfig("CORPORATE", customization({ fontScale: 1.1 })).heading.fontSize)
      .toBeCloseTo(TEMPLATE_PDF_STYLES.CORPORATE.heading.fontSize * 1.1, 1)
  })
})
