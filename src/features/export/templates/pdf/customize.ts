import type { ResumeCustomization } from "@/features/resume/types/customization"
import { LINE_HEIGHT_VALUE, MARGIN_SCALE } from "@/features/resume/lib/template-styles"
import { buildPdfConfig, TEMPLATE_PDF_STYLES, type TemplateStyleConfig } from "./styles"

const FONT_PAIRS: Record<"sans" | "serif", { fontFamily: string; boldFontFamily: string }> = {
  sans: { fontFamily: "Inter", boldFontFamily: "Inter-Bold" },
  serif: { fontFamily: "Times-Roman", boldFontFamily: "Times-Bold" },
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Swaps in the metric table for the chosen density, exactly as the preview
 * resolver picks `base.compact` / `base.normal` before any scaling. Only the
 * derived numbers move; the template's own decoration and palette (which the
 * caller may have overridden on `base`) are preserved.
 */
function withDensity(base: TemplateStyleConfig, density: ResumeCustomization["density"]) {
  const derived = buildPdfConfig(base.variant, density)
  return {
    ...base,
    page: derived.page,
    name: { ...base.name, fontSize: derived.name.fontSize },
    heading: {
      ...base.heading,
      fontSize: derived.heading.fontSize,
      marginBottom: derived.heading.marginBottom,
      // Compact headings sit `pb-0.5` above the rule in the preview, not `pb-1`.
      paddingBottom: derived.heading.paddingBottom,
    },
    body: { ...base.body, fontSize: derived.body.fontSize },
    sectionGap: derived.sectionGap,
    spacing: derived.spacing,
  }
}

/**
 * Applies the user's preview customization to a template's PDF style config so
 * the exported document matches what the editor shows. Pure — no react-pdf
 * dependency — so it can be unit tested on its own.
 *
 * Mirrors `getTemplateStyles` on the preview side: density picks the metric
 * table first, then `MARGIN_SCALE` / `fontScale` / `LINE_HEIGHT_VALUE` apply on
 * top with the same rounding.
 */
export function applyCustomizationToPdfConfig(
  base: TemplateStyleConfig,
  customization?: ResumeCustomization
): TemplateStyleConfig {
  if (!customization) return base

  const scale = customization.fontScale
  const marginScale = MARGIN_SCALE[customization.margins] ?? 1
  const dense = withDensity(base, customization.density)
  const fonts =
    customization.fontFamily === "template" ? null : FONT_PAIRS[customization.fontFamily]

  return {
    ...dense,
    fontFamily: fonts?.fontFamily ?? dense.fontFamily,
    boldFontFamily: fonts?.boldFontFamily ?? dense.boldFontFamily,
    colors: customization.accent
      ? {
          ...dense.colors,
          heading: customization.accent,
          accent: customization.accent,
          border: customization.accent,
          // The preview repaints `--resume-name` with the accent as well;
          // `strong` / `org` / `contact` stay on their literal greys.
          name: customization.accent,
        }
      : dense.colors,
    page: {
      paddingTop: Math.round(dense.page.paddingTop * marginScale),
      paddingBottom: Math.round(dense.page.paddingBottom * marginScale),
      paddingHorizontal: Math.round(dense.page.paddingHorizontal * marginScale),
    },
    name: { ...dense.name, fontSize: round1(dense.name.fontSize * scale) },
    heading: {
      ...dense.heading,
      fontSize: round1(dense.heading.fontSize * scale),
    },
    body: {
      fontSize: round1(dense.body.fontSize * scale),
      lineHeight: LINE_HEIGHT_VALUE[customization.lineHeight] ?? dense.body.lineHeight,
      textAlign: customization.textAlign ?? dense.body.textAlign,
    },
    sectionGap: dense.sectionGap,
  }
}

/** Resolves the config for one template name, applying customization if given. */
export function resolvePdfConfig(
  template: string,
  customization?: ResumeCustomization
): TemplateStyleConfig {
  const base = TEMPLATE_PDF_STYLES[template] ?? TEMPLATE_PDF_STYLES.MINIMAL
  return applyCustomizationToPdfConfig(base, customization)
}
