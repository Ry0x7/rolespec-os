import type { ResumeDensity, ResumeTextAlign } from "@/features/resume/types/customization"
import {
  LINE_HEIGHT_VALUE,
  TEMPLATE_STYLES,
  type TemplateVariant,
} from "@/features/resume/lib/template-styles"

/**
 * Structural identity of a template, mirroring `TemplateLayout` on the preview
 * side so an export looks like what the editor showed.
 */
export interface PdfTemplateLayout {
  header: "left" | "accent-bar" | "centered" | "banner"
  heading: "hairline" | "accent-bar" | "rule" | "chip"
  skills: "inline" | "chips" | "lines" | "grid"
  entry: "single-line" | "accent-role" | "academic" | "structured"
}

export interface TemplateStyleConfig {
  /** Which preview template's metric table this config was derived from. */
  variant: TemplateVariant
  layout: PdfTemplateLayout
  fontFamily: string
  boldFontFamily: string
  /**
   * One entry per colour *role* the preview paints, so the export can never
   * borrow a near-miss token. `name` / `contact` come straight from the preview
   * colour table; `strong` / `org` are the literal greys the preview markup
   * uses for emphasised text and the organisation/school trailing text.
   */
  colors: {
    heading: string
    border: string
    accent: string
    body: string
    muted: string
    /** Contact name — the preview's `--resume-name`. */
    name: string
    /** Job title + contact detail line — the preview's `--resume-muted`. */
    contact: string
    /** Emphasised entry text — the preview's `text-gray-900`. */
    strong: string
    /** Organisation / school trailing text — the preview's `text-gray-600`. */
    org: string
    headingBg?: string
  }
  page: {
    paddingTop: number
    paddingBottom: number
    paddingHorizontal: number
  }
  name: {
    fontSize: number
    fontWeight: number
    textTransform?: "uppercase" | "capitalize" | "lowercase" | "none"
    letterSpacing?: number
  }
  heading: {
    fontSize: number
    fontWeight: number
    textTransform: "uppercase" | "capitalize" | "lowercase" | "none"
    letterSpacing: number
    marginBottom: number
    paddingBottom: number
    borderBottomWidth: number
    paddingHorizontal?: number
    paddingVertical?: number
  }
  body: {
    fontSize: number
    lineHeight: number
    /**
     * Alignment of paragraph-ish body text (summary, bullets, custom content),
     * mirroring the preview's `TemplateStyles.textAlign`. Applied per element,
     * never on the page, so headings/dates/skills keep their own alignment.
     */
    textAlign: ResumeTextAlign
  }
  sectionGap: number
  /**
   * Spacing *inside* a section, mirroring the preview's `NORMAL_SPACING` /
   * `COMPACT_SPACING` tables element-for-element. The preview applies these raw
   * (neither `MARGIN_SCALE` nor `fontScale` touches them), so the PDF does too.
   */
  spacing: {
    /** Gap between Experience / Projects items. */
    itemGap: number
    /** Gap between Education / Custom items. */
    listGap: number
    /** Gap between certification rows. */
    certGap: number
    /** Gap between skill categories. */
    skillGap: number
    /** Space above a bullet list inside an item. */
    bulletTop: number
    /** Gap between bullets inside an item. */
    bulletGap: number
    /** Padding under the contact header rule. */
    contactPad: number
  }
}

/**
 * Everything about a template that the preview metric tables do not describe:
 * font pair, palette, and the decoration on the name/heading. Page padding,
 * font sizes, body line height, section gap and intra-section spacing are
 * *derived* from
 * `TEMPLATE_STYLES` instead of restated here, so an export can never drift
 * from what the editor preview measured.
 */
type TemplateIdentity = Omit<
  TemplateStyleConfig,
  "variant" | "page" | "body" | "sectionGap" | "spacing" | "name" | "heading" | "colors"
> & {
  /** `name` / `contact` are derived from the preview colour table instead. */
  colors: Omit<TemplateStyleConfig["colors"], "name" | "contact">
  name: Omit<TemplateStyleConfig["name"], "fontSize">
  heading: Omit<TemplateStyleConfig["heading"], "fontSize" | "marginBottom"> & {
    /** Compact-density override — the preview tightens `pb-1` to `pb-0.5`. */
    paddingBottomCompact?: number
  }
}

/**
 * The preview paints emphasised entry text with a literal `text-gray-900` and
 * the trailing organisation/school text with `text-gray-600` on every template,
 * so both are template-independent constants rather than palette entries.
 */
const STRONG_TEXT = "#111827"
const ORG_TEXT = "#4b5563"
/** Dates, locations, GPA, credential IDs — the preview's `text-gray-500`. */
const META_TEXT = "#6b7280"
/**
 * The combined Skills + Certifications block paints its own text with literal
 * greys on every template (`CombinedAdditionalPreview` in `resume-preview.tsx`),
 * so the PDF block reads these constants instead of the template palette — the
 * palette is template-tinted and the accent customization overwrites it.
 *
 * The block's "Skills" / "Certifications" sub-labels — `text-gray-400`.
 */
export const SUB_LABEL_TEXT = "#9ca3af"
/** Skill lists and certification names — `text-gray-700`. */
export const BODY_TEXT = "#374151"

const TEMPLATE_IDENTITY: Record<TemplateVariant, TemplateIdentity> = {
  MINIMAL: {
    layout: { header: "left", heading: "hairline", skills: "inline", entry: "single-line" },
    fontFamily: "Inter",
    boldFontFamily: "Inter-Bold",
    colors: {
      heading: "#111827",
      border: "#e5e7eb",
      accent: "#6b7280",
      body: "#374151",
      muted: META_TEXT,
      strong: STRONG_TEXT,
      org: ORG_TEXT,
    },
    name: {
      fontWeight: 700,
      // Preview `tracking-tight` (-0.025em) at the 20px name size.
      letterSpacing: -0.5,
    },
    heading: {
      fontWeight: 700,
      // Sentence case over a hairline — the quiet ATS-classic look.
      textTransform: "none",
      // The preview heading carries no tracking class.
      letterSpacing: 0,
      // Matches the preview heading's `pb-1` (4px) above the hairline.
      paddingBottom: 4,
      // …tightened to `pb-0.5` at compact density.
      paddingBottomCompact: 2,
      borderBottomWidth: 0.75,
    },
  },

  MODERN: {
    layout: { header: "accent-bar", heading: "accent-bar", skills: "chips", entry: "accent-role" },
    fontFamily: "Inter",
    boldFontFamily: "Inter-Bold",
    colors: {
      heading: "#1d4ed8",
      border: "#bfdbfe",
      accent: "#2563eb",
      body: "#374151",
      muted: META_TEXT,
      strong: STRONG_TEXT,
      org: ORG_TEXT,
    },
    name: {
      fontWeight: 700,
      // Preview `tracking-tight` (-0.025em) at the 24px name size.
      letterSpacing: -0.6,
    },
    heading: {
      fontWeight: 700,
      textTransform: "uppercase",
      // Preview `tracking-wide` (0.025em) at the 12px heading size.
      letterSpacing: 0.3,
      paddingBottom: 2,
      // The accent bar replaces the full-width rule.
      borderBottomWidth: 0,
    },
  },

  HARVARD: {
    layout: { header: "centered", heading: "rule", skills: "lines", entry: "academic" },
    fontFamily: "Times-Roman",
    boldFontFamily: "Times-Bold",
    colors: {
      heading: "#1f2937",
      border: "#9ca3af",
      accent: "#374151",
      body: "#374151",
      muted: META_TEXT,
      strong: STRONG_TEXT,
      org: ORG_TEXT,
    },
    name: {
      fontWeight: 700,
      textTransform: "uppercase",
      // Preview `tracking-wide` (0.025em) at the 20px name size.
      letterSpacing: 0.5,
    },
    heading: {
      fontWeight: 700,
      textTransform: "uppercase",
      // Preview `tracking-widest` (0.1em) at the 12px heading size.
      letterSpacing: 1.2,
      // Matches the preview heading's `pb-1` (4px) above the rule.
      paddingBottom: 4,
      // …tightened to `pb-0.5` at compact density.
      paddingBottomCompact: 2,
      borderBottomWidth: 1,
    },
  },

  CORPORATE: {
    layout: { header: "banner", heading: "chip", skills: "grid", entry: "structured" },
    fontFamily: "Inter",
    boldFontFamily: "Inter-Bold",
    colors: {
      heading: "#334155",
      border: "#e2e8f0",
      accent: "#0f172a",
      body: "#334155",
      // Dates/locations paint `text-gray-500` here too, not a slate tint.
      muted: META_TEXT,
      strong: STRONG_TEXT,
      org: ORG_TEXT,
      headingBg: "#f1f5f9",
    },
    name: {
      fontWeight: 700,
      // Preview `tracking-tight` (-0.025em) at the 20px name size.
      letterSpacing: -0.5,
    },
    heading: {
      fontWeight: 700,
      textTransform: "uppercase",
      // Preview `tracking-widest` (0.1em) at the 10px heading size.
      letterSpacing: 1,
      paddingBottom: 0,
      borderBottomWidth: 0,
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
  },
}

/**
 * Builds the unscaled config for one template at one density. The preview
 * renders on a 595pt-wide A4 page at 1px ≡ 1pt, so every `*Px` number in
 * `TEMPLATE_STYLES` transfers to PDF points unchanged.
 */
export function buildPdfConfig(
  variant: TemplateVariant,
  density: ResumeDensity = "normal"
): TemplateStyleConfig {
  const identity = TEMPLATE_IDENTITY[variant]
  const base = TEMPLATE_STYLES[variant]
  const metrics = density === "compact" ? base.compact : base.normal
  const { paddingBottomCompact, ...heading } = identity.heading

  return {
    variant,
    layout: identity.layout,
    fontFamily: identity.fontFamily,
    boldFontFamily: identity.boldFontFamily,
    colors: {
      ...identity.colors,
      // The preview paints these two straight from its own colour table.
      name: base.colors.name,
      contact: base.colors.muted,
    },
    page: {
      paddingTop: metrics.paddingPx,
      paddingBottom: metrics.paddingPx,
      paddingHorizontal: metrics.paddingPx,
    },
    name: { ...identity.name, fontSize: metrics.nameSizePx },
    heading: {
      ...heading,
      fontSize: metrics.headingSizePx,
      marginBottom: metrics.headingGapPx,
      paddingBottom:
        density === "compact" ? paddingBottomCompact ?? heading.paddingBottom : heading.paddingBottom,
    },
    body: {
      fontSize: metrics.fontSizePx,
      lineHeight: LINE_HEIGHT_VALUE.normal,
      textAlign: "left",
    },
    sectionGap: metrics.gapPx,
    spacing: {
      itemGap: metrics.itemGapPx,
      listGap: metrics.listGapPx,
      certGap: metrics.certGapPx,
      skillGap: metrics.skillGapPx,
      bulletTop: metrics.bulletTopPx,
      bulletGap: metrics.bulletGapPx,
      contactPad: metrics.contactPadPx,
    },
  }
}

/** Normal-density defaults — the base each export is customized from. */
export const TEMPLATE_PDF_STYLES: Record<string, TemplateStyleConfig> = {
  MINIMAL: buildPdfConfig("MINIMAL"),
  MODERN: buildPdfConfig("MODERN"),
  HARVARD: buildPdfConfig("HARVARD"),
  CORPORATE: buildPdfConfig("CORPORATE"),
}
