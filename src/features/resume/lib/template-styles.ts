import type { ResumeCustomization } from "../types/customization"

/**
 * Resolved preview tokens for one template + density + customization combo.
 *
 * Colours travel as CSS custom properties (`cssVars`) rather than Tailwind
 * classes so an arbitrary accent hex works without generating classes at
 * runtime — dynamic Tailwind class names never make it into the compiled CSS.
 */
export type TemplateVariant = "MINIMAL" | "MODERN" | "HARVARD" | "CORPORATE"

/**
 * Structural (not colour) differences between the four templates. The preview
 * section components branch on these instead of on the template name so the
 * intent of each arrangement stays readable.
 */
export interface TemplateLayout {
  /** Contact block arrangement. */
  header: "left" | "accent-bar" | "centered" | "banner"
  /** Decoration attached to a section heading. */
  heading: "hairline" | "accent-bar" | "rule" | "chip"
  /** How one skill category renders. */
  skills: "inline" | "pills" | "lines" | "grid"
  /** How one Experience entry is laid out. */
  entry: "single-line" | "accent-role" | "academic" | "structured"
}

const TEMPLATE_LAYOUTS: Record<TemplateVariant, TemplateLayout> = {
  MINIMAL: { header: "left", heading: "hairline", skills: "inline", entry: "single-line" },
  MODERN: { header: "accent-bar", heading: "accent-bar", skills: "pills", entry: "accent-role" },
  HARVARD: { header: "centered", heading: "rule", skills: "lines", entry: "academic" },
  CORPORATE: { header: "banner", heading: "chip", skills: "grid", entry: "structured" },
}

export interface TemplateStyles {
  variant: TemplateVariant
  layout: TemplateLayout
  wrapper: string
  heading: string
  name: string
  accent: string
  /** Page padding on every side. Vertical padding is counted twice when packing. */
  paddingPx: number
  /** Gap between two sections. Rendered as an explicit `rowGap`, never `space-y-*`. */
  gapPx: number
  /** Gap between a section heading and its first item. */
  headingGapPx: number
  /** Gap between items in Experience / Projects. */
  itemGapPx: number
  /** Gap between items in Education / Custom. */
  listGapPx: number
  /** Gap between certification rows. */
  certGapPx: number
  /** Gap between skill categories. */
  skillGapPx: number
  /** Space above a bullet list inside an item. */
  bulletTopPx: number
  /** Gap between bullets inside an item. */
  bulletGapPx: number
  /** Padding under the contact header rule. */
  contactPadPx: number
  /** Body text size in px. */
  fontSizePx: number
  /** Section heading text size in px. */
  headingSizePx: number
  /** Contact name text size in px. */
  nameSizePx: number
  lineHeight: number
  /**
   * Alignment for paragraph-ish body text only (summary, bullets, custom
   * content). Headings, the contact header, date rows and skills rows keep
   * their own alignment on both the preview and the PDF side.
   */
  textAlign: ResumeCustomization["textAlign"]
  cssVars: Record<string, string>
}

interface TemplateColors {
  name: string
  heading: string
  border: string
  muted: string
  headingBg?: string
}

interface TemplateDensityBase {
  /** Decoration-only classes; size and colour come from tokens/vars. */
  heading: string
  name: string
  paddingPx: number
  gapPx: number
  fontSizePx: number
  headingSizePx: number
  nameSizePx: number
  headingGapPx: number
  itemGapPx: number
  listGapPx: number
  certGapPx: number
  skillGapPx: number
  bulletTopPx: number
  bulletGapPx: number
  contactPadPx: number
}

interface TemplateBase {
  fontClass: string
  colors: TemplateColors
  normal: TemplateDensityBase
  compact: TemplateDensityBase
}

// Spacing shared by every template, split by density. Compact tightens
// intra-section spacing as well as the outer container so the toggle actually
// reclaims vertical space on item-heavy resumes.
export const NORMAL_SPACING = {
  headingGapPx: 8,
  itemGapPx: 12,
  listGapPx: 8,
  certGapPx: 6,
  skillGapPx: 4,
  bulletTopPx: 4,
  bulletGapPx: 2,
  contactPadPx: 16,
} as const

export const COMPACT_SPACING = {
  headingGapPx: 5,
  itemGapPx: 6,
  listGapPx: 4,
  certGapPx: 3,
  skillGapPx: 2,
  bulletTopPx: 2,
  bulletGapPx: 1,
  contactPadPx: 8,
} as const

// Every colour/size below is emitted through a CSS var or an inline style, so
// these class strings only carry static decoration (weight, case, tracking,
// borders). Keep them literal — Tailwind only compiles what it can see.
const HEADING_COLOR_CLASS = "text-[color:var(--resume-heading)]"
const BORDER_COLOR_CLASS = "border-[color:var(--resume-border)]"
const NAME_CLASS_SUFFIX = "text-[color:var(--resume-name)]"

export const TEMPLATE_STYLES: Record<string, TemplateBase> = {
  MINIMAL: {
    fontClass: "font-sans",
    colors: { name: "#111827", heading: "#111827", border: "#e5e7eb", muted: "#4b5563" },
    normal: {
      heading: `font-semibold border-b pb-1 ${HEADING_COLOR_CLASS} ${BORDER_COLOR_CLASS}`,
      name: `font-bold tracking-tight ${NAME_CLASS_SUFFIX}`,
      paddingPx: 32,
      gapPx: 20,
      fontSizePx: 11,
      headingSizePx: 12,
      nameSizePx: 20,
      ...NORMAL_SPACING,
    },
    compact: {
      heading: `font-semibold border-b pb-0.5 ${HEADING_COLOR_CLASS} ${BORDER_COLOR_CLASS}`,
      name: `font-bold tracking-tight ${NAME_CLASS_SUFFIX}`,
      paddingPx: 24,
      gapPx: 12,
      fontSizePx: 10.5,
      headingSizePx: 10,
      nameSizePx: 18,
      ...COMPACT_SPACING,
    },
  },
  MODERN: {
    fontClass: "font-sans",
    colors: { name: "#1e3a8a", heading: "#1d4ed8", border: "#bfdbfe", muted: "#2563eb" },
    normal: {
      heading: `flex items-center gap-2 font-bold uppercase tracking-wide ${HEADING_COLOR_CLASS}`,
      name: `font-bold tracking-tight ${NAME_CLASS_SUFFIX}`,
      paddingPx: 32,
      gapPx: 20,
      fontSizePx: 11,
      headingSizePx: 12,
      nameSizePx: 24,
      ...NORMAL_SPACING,
    },
    compact: {
      heading: `flex items-center gap-2 font-bold uppercase tracking-wide ${HEADING_COLOR_CLASS}`,
      name: `font-bold tracking-tight ${NAME_CLASS_SUFFIX}`,
      paddingPx: 24,
      gapPx: 12,
      fontSizePx: 10.5,
      headingSizePx: 10,
      nameSizePx: 20,
      ...COMPACT_SPACING,
    },
  },
  HARVARD: {
    fontClass: "font-serif",
    colors: { name: "#111827", heading: "#1f2937", border: "#9ca3af", muted: "#374151" },
    normal: {
      heading: `font-bold uppercase tracking-widest border-b pb-1 ${HEADING_COLOR_CLASS} ${BORDER_COLOR_CLASS}`,
      name: `font-bold uppercase tracking-wide ${NAME_CLASS_SUFFIX}`,
      paddingPx: 40,
      gapPx: 16,
      fontSizePx: 11,
      headingSizePx: 12,
      nameSizePx: 20,
      ...NORMAL_SPACING,
    },
    compact: {
      heading: `font-bold uppercase tracking-widest border-b pb-0.5 ${HEADING_COLOR_CLASS} ${BORDER_COLOR_CLASS}`,
      name: `font-bold uppercase tracking-wide ${NAME_CLASS_SUFFIX}`,
      paddingPx: 28,
      gapPx: 12,
      fontSizePx: 10.5,
      headingSizePx: 10,
      nameSizePx: 18,
      ...COMPACT_SPACING,
    },
  },
  CORPORATE: {
    fontClass: "font-sans",
    colors: {
      name: "#0f172a",
      heading: "#334155",
      border: "transparent",
      muted: "#475569",
      headingBg: "#f1f5f9",
    },
    normal: {
      heading: `font-bold uppercase tracking-widest px-2 py-1 ${HEADING_COLOR_CLASS} bg-[color:var(--resume-heading-bg)]`,
      name: `font-bold tracking-tight ${NAME_CLASS_SUFFIX}`,
      paddingPx: 32,
      gapPx: 20,
      fontSizePx: 11,
      headingSizePx: 10,
      nameSizePx: 20,
      ...NORMAL_SPACING,
    },
    compact: {
      heading: `font-bold uppercase tracking-widest px-2 py-0.5 ${HEADING_COLOR_CLASS} bg-[color:var(--resume-heading-bg)]`,
      name: `font-bold tracking-tight ${NAME_CLASS_SUFFIX}`,
      paddingPx: 24,
      gapPx: 12,
      fontSizePx: 10.5,
      headingSizePx: 10,
      nameSizePx: 18,
      ...COMPACT_SPACING,
    },
  },
}

export const MARGIN_SCALE: Record<ResumeCustomization["margins"], number> = {
  compact: 0.75,
  normal: 1,
  relaxed: 1.25,
}

export const LINE_HEIGHT_VALUE: Record<ResumeCustomization["lineHeight"], number> = {
  snug: 1.35,
  normal: 1.55,
  relaxed: 1.75,
}

const FAMILY_CLASS: Record<ResumeCustomization["fontFamily"], string | null> = {
  template: null,
  sans: "font-sans",
  serif: "font-serif",
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Accent tint used for heading rules/backgrounds (hex + alpha suffix). */
function tint(hex: string, alpha: string): string {
  return `${hex}${alpha}`
}

/**
 * Pure derivation of preview tokens. Both the hidden measurement mirror and the
 * painted pages consume the exact same object, so pagination can never drift
 * from what is rendered.
 */
export function getTemplateStyles(
  template: string,
  customization: ResumeCustomization
): TemplateStyles {
  const variant: TemplateVariant = (
    template in TEMPLATE_STYLES ? template : "MINIMAL"
  ) as TemplateVariant
  const base = TEMPLATE_STYLES[variant]
  const density = customization.density === "compact" ? base.compact : base.normal
  const scale = customization.fontScale
  const accent = customization.accent

  const colors: TemplateColors = accent
    ? {
        name: accent,
        heading: accent,
        border: tint(accent, "55"),
        muted: base.colors.muted,
        headingBg: base.colors.headingBg ? tint(accent, "14") : undefined,
      }
    : base.colors

  const nameSizePx = round1(density.nameSizePx * scale)

  const cssVars: Record<string, string> = {
    "--resume-name": colors.name,
    "--resume-heading": colors.heading,
    "--resume-border": colors.border,
    "--resume-muted": colors.muted,
    "--resume-name-size": `${nameSizePx}px`,
    "--resume-heading-bg": colors.headingBg ?? "transparent",
  }

  return {
    variant,
    layout: TEMPLATE_LAYOUTS[variant],
    wrapper: `bg-white ${FAMILY_CLASS[customization.fontFamily] ?? base.fontClass}`,
    heading: density.heading,
    name: `${density.name} text-[length:var(--resume-name-size)]`,
    accent: "text-[color:var(--resume-muted)]",
    paddingPx: Math.round(density.paddingPx * MARGIN_SCALE[customization.margins]),
    gapPx: density.gapPx,
    headingGapPx: density.headingGapPx,
    itemGapPx: density.itemGapPx,
    listGapPx: density.listGapPx,
    certGapPx: density.certGapPx,
    skillGapPx: density.skillGapPx,
    bulletTopPx: density.bulletTopPx,
    bulletGapPx: density.bulletGapPx,
    contactPadPx: density.contactPadPx,
    fontSizePx: round1(density.fontSizePx * scale),
    headingSizePx: round1(density.headingSizePx * scale),
    nameSizePx,
    lineHeight: LINE_HEIGHT_VALUE[customization.lineHeight],
    textAlign: customization.textAlign,
    cssVars,
  }
}
