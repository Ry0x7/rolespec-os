import { describe, expect, it } from "vitest"
import {
  DEFAULT_CUSTOMIZATION,
  type ResumeCustomization,
  type ResumeDensity,
  type ResumeFontScale,
  type ResumeLineHeight,
  type ResumeMargins,
  type ResumeTextAlign,
} from "@/features/resume/types/customization"
import {
  COMPACT_SPACING,
  NORMAL_SPACING,
  TEMPLATE_STYLES,
  getTemplateStyles,
  type TemplateVariant,
} from "@/features/resume/lib/template-styles"
import { resolvePdfConfig } from "../customize"
import { textSize } from "../primitives"

/**
 * Contract test: the preview measures pagination from `getTemplateStyles`, and
 * the preview page is A4 at 1px ≡ 1pt. So every page metric the PDF uses must
 * equal the preview's resolved number, or the export will paginate differently
 * from what the editor showed.
 */
const TEMPLATES: TemplateVariant[] = ["MINIMAL", "MODERN", "HARVARD", "CORPORATE"]
const DENSITIES: ResumeDensity[] = ["normal", "compact"]
const MARGINS: ResumeMargins[] = ["compact", "normal", "relaxed"]
const SCALES: ResumeFontScale[] = [0.9, 1, 1.1]
const LINE_HEIGHTS: ResumeLineHeight[] = ["snug", "normal", "relaxed"]
const TEXT_ALIGNS: ResumeTextAlign[] = ["left", "center", "right", "justify"]

function customization(overrides: Partial<ResumeCustomization> = {}): ResumeCustomization {
  return { ...DEFAULT_CUSTOMIZATION, ...overrides }
}

describe("PDF config matches preview metrics", () => {
  for (const template of TEMPLATES) {
    for (const density of DENSITIES) {
      for (const margins of MARGINS) {
        for (const fontScale of SCALES) {
          it(`${template} / ${density} / margins:${margins} / scale:${fontScale}`, () => {
            const custom = customization({ density, margins, fontScale })
            const preview = getTemplateStyles(template, custom)
            const pdf = resolvePdfConfig(template, custom)

            expect(pdf.page.paddingTop).toBe(preview.paddingPx)
            expect(pdf.page.paddingBottom).toBe(preview.paddingPx)
            expect(pdf.page.paddingHorizontal).toBe(preview.paddingPx)
            expect(pdf.body.fontSize).toBe(preview.fontSizePx)
            expect(pdf.heading.fontSize).toBe(preview.headingSizePx)
            expect(pdf.name.fontSize).toBe(preview.nameSizePx)
            expect(pdf.sectionGap).toBe(preview.gapPx)
            expect(pdf.heading.marginBottom).toBe(preview.headingGapPx)
            expect(pdf.body.lineHeight).toBe(preview.lineHeight)
            expect(pdf.body.textAlign).toBe(preview.textAlign)

            // Intra-section spacing rides the density table raw — neither
            // MARGIN_SCALE nor fontScale touches it on the preview side, so the
            // PDF numbers must stay equal across every margins/scale combo.
            expect(pdf.spacing).toEqual({
              itemGap: preview.itemGapPx,
              listGap: preview.listGapPx,
              certGap: preview.certGapPx,
              skillGap: preview.skillGapPx,
              bulletTop: preview.bulletTopPx,
              bulletGap: preview.bulletGapPx,
              contactPad: preview.contactPadPx,
            })
          })
        }
      }
    }
  }

  // Pinned against the preview's spacing tables directly, so a future edit to
  // NORMAL_SPACING/COMPACT_SPACING that the PDF does not pick up fails loudly.
  const SPACING_TABLES: Record<ResumeDensity, Record<keyof typeof NORMAL_SPACING, number>> = {
    normal: NORMAL_SPACING,
    compact: COMPACT_SPACING,
  }

  for (const template of TEMPLATES) {
    for (const density of DENSITIES) {
      it(`${template} / ${density} intra-section spacing equals the preview table`, () => {
        const table = SPACING_TABLES[density]
        const pdf = resolvePdfConfig(template, customization({ density }))

        expect(pdf.spacing).toEqual({
          itemGap: table.itemGapPx,
          listGap: table.listGapPx,
          certGap: table.certGapPx,
          skillGap: table.skillGapPx,
          bulletTop: table.bulletTopPx,
          bulletGap: table.bulletGapPx,
          contactPad: table.contactPadPx,
        })
        expect(pdf.heading.marginBottom).toBe(table.headingGapPx)
      })
    }
  }

  it("uses the preview's normal-density spacing when no customization is given", () => {
    for (const template of TEMPLATES) {
      const pdf = resolvePdfConfig(template)
      expect(pdf.spacing.itemGap).toBe(NORMAL_SPACING.itemGapPx)
      expect(pdf.spacing.contactPad).toBe(NORMAL_SPACING.contactPadPx)
    }
  })

  for (const lineHeight of LINE_HEIGHTS) {
    it(`line height ${lineHeight} matches the preview value`, () => {
      const custom = customization({ lineHeight })
      expect(resolvePdfConfig("MINIMAL", custom).body.lineHeight).toBe(
        getTemplateStyles("MINIMAL", custom).lineHeight
      )
    })
  }

  // Body alignment is a per-element style on both sides (summary, bullets,
  // custom content); headings/dates/skills never read it. The two resolvers must
  // agree on the value for every template and every option.
  for (const textAlign of TEXT_ALIGNS) {
    it(`text align ${textAlign} matches the preview value on every template`, () => {
      const custom = customization({ textAlign })
      for (const template of TEMPLATES) {
        expect(resolvePdfConfig(template, custom).body.textAlign).toBe(
          getTemplateStyles(template, custom).textAlign
        )
        expect(resolvePdfConfig(template, custom).body.textAlign).toBe(textAlign)
      }
    })
  }

  it("defaults body alignment to left with no customization", () => {
    for (const template of TEMPLATES) {
      expect(resolvePdfConfig(template).body.textAlign).toBe("left")
      expect(getTemplateStyles(template, DEFAULT_CUSTOMIZATION).textAlign).toBe("left")
    }
  })

  /**
   * Line boxes, not just font sizes.
   *
   * The browser resolves a unitless `line-height` against each element's own
   * font size, so the preview's box for any text role is `fontSize × lineHeight`.
   * react-pdf instead resolves a unitless `lineHeight` once, against the font
   * size on the same style object, then inherits the result as an absolute
   * value — so a `Text` that overrides only `fontSize` silently keeps the
   * `<Page>`'s box. `textSize()` is what re-pairs the two, and these cases pin
   * the result against the preview's per-element math for every role.
   */
  describe("derived line boxes match the preview's per-element math", () => {
    for (const template of TEMPLATES) {
      for (const density of DENSITIES) {
        for (const margins of MARGINS) {
          for (const fontScale of SCALES) {
            it(`${template} / ${density} / margins:${margins} / scale:${fontScale}`, () => {
              const custom = customization({ density, margins, fontScale })
              const preview = getTemplateStyles(template, custom)
              const pdf = resolvePdfConfig(template, custom)

              const box = (fontSize: number) => {
                const style = textSize(pdf, fontSize)
                return style.fontSize * style.lineHeight
              }

              // body / bullets / summary
              expect(box(pdf.body.fontSize)).toBeCloseTo(
                preview.fontSizePx * preview.lineHeight,
                10
              )
              // section headings
              expect(box(pdf.heading.fontSize)).toBeCloseTo(
                preview.headingSizePx * preview.lineHeight,
                10
              )
              // contact name
              expect(box(pdf.name.fontSize)).toBeCloseTo(
                preview.nameSizePx * preview.lineHeight,
                10
              )
              // job title under the name — `body + 1` on both sides
              expect(box(pdf.body.fontSize + 1)).toBeCloseTo(
                (preview.fontSizePx + 1) * preview.lineHeight,
                10
              )
              // dates / location / technologies — `body - 1` on both sides
              expect(box(pdf.body.fontSize - 1)).toBeCloseTo(
                (preview.fontSizePx - 1) * preview.lineHeight,
                10
              )
            })
          }
        }
      }
    }

    // Absolute pins at the shipped defaults, so the numbers above cannot all
    // drift together. Preview equivalents: body/bullets inherit 11px, the
    // heading is 12px, the name 20px, the job title 12px, and the meta spans are
    // `text-[10px]` — every one of them inheriting the container's 1.55.
    it("pins HARVARD defaults to the preview's rendered pixel boxes", () => {
      const pdf = resolvePdfConfig("HARVARD")
      expect(pdf.body.lineHeight).toBe(1.55)
      expect(textSize(pdf, pdf.body.fontSize)).toEqual({ fontSize: 11, lineHeight: 1.55 })
      expect(textSize(pdf, pdf.heading.fontSize)).toEqual({ fontSize: 12, lineHeight: 1.55 })
      expect(textSize(pdf, pdf.name.fontSize)).toEqual({ fontSize: 20, lineHeight: 1.55 })
      expect(textSize(pdf, pdf.body.fontSize + 1)).toEqual({ fontSize: 12, lineHeight: 1.55 })
      expect(textSize(pdf, pdf.body.fontSize - 1)).toEqual({ fontSize: 10, lineHeight: 1.55 })
    })

    for (const lineHeight of LINE_HEIGHTS) {
      it(`carries the ${lineHeight} line height onto every role`, () => {
        const custom = customization({ lineHeight })
        const preview = getTemplateStyles("MINIMAL", custom)
        const pdf = resolvePdfConfig("MINIMAL", custom)

        for (const fontSize of [
          pdf.body.fontSize,
          pdf.heading.fontSize,
          pdf.name.fontSize,
          pdf.body.fontSize + 1,
          pdf.body.fontSize - 1,
        ]) {
          expect(textSize(pdf, fontSize).lineHeight).toBe(preview.lineHeight)
        }
      })
    }
  })

  // The heading's rule sits `pb-1` (4px) above the border in the preview, and
  // `pb-0.5` (2px) at compact density; the PDF must reserve the same strip or a
  // full page's worth of headings drifts.
  it("reserves the preview's heading padding under the rule", () => {
    for (const template of ["MINIMAL", "HARVARD"] as const) {
      expect(resolvePdfConfig(template).heading.paddingBottom).toBe(4)
      expect(
        resolvePdfConfig(template, customization({ density: "normal" })).heading.paddingBottom
      ).toBe(4)
      expect(
        resolvePdfConfig(template, customization({ density: "compact" })).heading.paddingBottom
      ).toBe(2)
    }
  })

  // The preview paints the name from `--resume-name` and the job title/contact
  // line from `--resume-muted`; the PDF must read the same two tokens rather
  // than the nearest palette entry it happens to own.
  it("paints the contact block from the preview's colour tokens", () => {
    for (const template of TEMPLATES) {
      const base = TEMPLATE_STYLES[template].colors
      const pdf = resolvePdfConfig(template, customization())
      expect(pdf.colors.name).toBe(base.name)
      expect(pdf.colors.contact).toBe(base.muted)
    }
  })

  it("repaints only the name with a custom accent, as the preview does", () => {
    const accent = "#166534"
    for (const template of TEMPLATES) {
      const pdf = resolvePdfConfig(template, customization({ accent }))
      expect(pdf.colors.name).toBe(accent)
      expect(pdf.colors.heading).toBe(accent)
      // `text-gray-900` / `text-gray-600` / `--resume-muted` are literal in the
      // preview markup and never follow the accent.
      expect(pdf.colors.strong).toBe("#111827")
      expect(pdf.colors.org).toBe("#4b5563")
      expect(pdf.colors.contact).toBe(TEMPLATE_STYLES[template].colors.muted)
    }
  })

  // Preview tracking classes are em-based; the PDF restates them in points, so
  // each identity must equal `em factor × that element's normal-density size`.
  it("matches the preview's tracking classes in points", () => {
    const EM: Record<string, number> = { "tracking-tight": -0.025, "tracking-wide": 0.025, "tracking-widest": 0.1 }
    const trackingEm = (classes: string) => {
      const hit = Object.keys(EM).find((name) => classes.split(" ").includes(name))
      return hit ? EM[hit] : 0
    }

    for (const template of TEMPLATES) {
      const normal = TEMPLATE_STYLES[template].normal
      const pdf = resolvePdfConfig(template)
      expect(pdf.name.letterSpacing ?? 0).toBeCloseTo(
        trackingEm(normal.name) * normal.nameSizePx,
        10
      )
      expect(pdf.heading.letterSpacing).toBeCloseTo(
        trackingEm(normal.heading) * normal.headingSizePx,
        10
      )
    }
  })

  it("uses the preview's normal-density numbers as the uncustomized default", () => {
    const preview = getTemplateStyles("HARVARD", DEFAULT_CUSTOMIZATION)
    const pdf = resolvePdfConfig("HARVARD")
    expect(pdf.page.paddingTop).toBe(preview.paddingPx)
    expect(pdf.body.fontSize).toBe(preview.fontSizePx)
    expect(pdf.sectionGap).toBe(preview.gapPx)
    expect(pdf.body.lineHeight).toBe(preview.lineHeight)
  })
})
