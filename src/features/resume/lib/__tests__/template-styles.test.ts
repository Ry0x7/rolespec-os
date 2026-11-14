import { describe, expect, it } from "vitest"
import { getTemplateStyles } from "../template-styles"
import { DEFAULT_CUSTOMIZATION, type ResumeCustomization } from "../../types/customization"

function customization(overrides: Partial<ResumeCustomization> = {}): ResumeCustomization {
  return { ...DEFAULT_CUSTOMIZATION, ...overrides }
}

describe("getTemplateStyles", () => {
  it("falls back to MINIMAL for an unknown template", () => {
    expect(getTemplateStyles("NOPE", customization())).toEqual(
      getTemplateStyles("MINIMAL", customization())
    )
  })

  it("tightens spacing and padding in compact density", () => {
    const normal = getTemplateStyles("MINIMAL", customization())
    const compact = getTemplateStyles("MINIMAL", customization({ density: "compact" }))

    expect(compact.paddingPx).toBeLessThan(normal.paddingPx)
    expect(compact.gapPx).toBeLessThan(normal.gapPx)
    expect(compact.itemGapPx).toBeLessThan(normal.itemGapPx)
    expect(compact.fontSizePx).toBeLessThan(normal.fontSizePx)
  })

  it("scales every text token by fontScale", () => {
    const medium = getTemplateStyles("MINIMAL", customization())
    const large = getTemplateStyles("MINIMAL", customization({ fontScale: 1.1 }))
    const small = getTemplateStyles("MINIMAL", customization({ fontScale: 0.9 }))

    expect(large.fontSizePx).toBeCloseTo(medium.fontSizePx * 1.1, 1)
    expect(large.headingSizePx).toBeCloseTo(medium.headingSizePx * 1.1, 1)
    expect(large.nameSizePx).toBeCloseTo(medium.nameSizePx * 1.1, 1)
    expect(small.fontSizePx).toBeLessThan(medium.fontSizePx)
    expect(large.cssVars["--resume-name-size"]).toBe(`${large.nameSizePx}px`)
  })

  it("maps margins to page padding", () => {
    const tight = getTemplateStyles("MINIMAL", customization({ margins: "compact" }))
    const normal = getTemplateStyles("MINIMAL", customization())
    const wide = getTemplateStyles("MINIMAL", customization({ margins: "relaxed" }))

    expect(tight.paddingPx).toBe(24)
    expect(normal.paddingPx).toBe(32)
    expect(wide.paddingPx).toBe(40)
  })

  it("maps lineHeight to a numeric value", () => {
    expect(getTemplateStyles("MINIMAL", customization({ lineHeight: "snug" })).lineHeight).toBeLessThan(
      getTemplateStyles("MINIMAL", customization({ lineHeight: "normal" })).lineHeight
    )
    expect(
      getTemplateStyles("MINIMAL", customization({ lineHeight: "relaxed" })).lineHeight
    ).toBeGreaterThan(getTemplateStyles("MINIMAL", customization()).lineHeight)
  })

  it("overrides the font family class without touching the template default", () => {
    expect(getTemplateStyles("HARVARD", customization()).wrapper).toContain("font-serif")
    expect(getTemplateStyles("HARVARD", customization({ fontFamily: "sans" })).wrapper).toContain(
      "font-sans"
    )
    expect(getTemplateStyles("MINIMAL", customization({ fontFamily: "serif" })).wrapper).toContain(
      "font-serif"
    )
  })

  it("routes accent colour through CSS vars, never through class names", () => {
    const accented = getTemplateStyles("MODERN", customization({ accent: "#166534" }))

    expect(accented.cssVars["--resume-heading"]).toBe("#166534")
    expect(accented.cssVars["--resume-name"]).toBe("#166534")
    expect(accented.cssVars["--resume-border"]).toBe("#16653455")
    // Class strings must stay static so Tailwind can compile them.
    expect(accented.heading).not.toContain("#166534")
    expect(accented.name).not.toContain("#166534")
  })

  it("keeps the template palette when no accent is chosen", () => {
    const modern = getTemplateStyles("MODERN", customization())
    expect(modern.cssVars["--resume-heading"]).toBe("#1d4ed8")
  })

  it("returns identical tokens for the same inputs (mirror and pages cannot drift)", () => {
    const a = getTemplateStyles("CORPORATE", customization({ density: "compact", fontScale: 1.1 }))
    const b = getTemplateStyles("CORPORATE", customization({ density: "compact", fontScale: 1.1 }))
    expect(a).toEqual(b)
  })
})
