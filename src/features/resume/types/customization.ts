/**
 * Per-resume presentation settings. Stored in `localStorage` (never the DB) and
 * shared by the live preview and the PDF export so both stay WYSIWYG.
 */
export type ResumeDensity = "normal" | "compact"
export type ResumeFontFamily = "template" | "sans" | "serif"
export type ResumeFontScale = 0.9 | 1 | 1.1
export type ResumeMargins = "compact" | "normal" | "relaxed"
export type ResumeLineHeight = "snug" | "normal" | "relaxed"
export type ResumeTextAlign = "left" | "center" | "right" | "justify"

export interface ResumeCustomization {
  density: ResumeDensity
  fontFamily: ResumeFontFamily
  /** S / M / L text size multiplier. */
  fontScale: ResumeFontScale
  /** Hex colour, or `""` to keep the template's own palette. */
  accent: string
  margins: ResumeMargins
  lineHeight: ResumeLineHeight
  /** Alignment of paragraph-ish body text (summary, bullets, custom content). */
  textAlign: ResumeTextAlign
}

export const DEFAULT_CUSTOMIZATION: ResumeCustomization = {
  density: "normal",
  fontFamily: "template",
  fontScale: 1,
  accent: "",
  margins: "normal",
  lineHeight: "normal",
  textAlign: "left",
}

/** `""` is the "template default" option and is always listed first. */
export const ACCENT_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Template default" },
  { value: "#1d4ed8", label: "Blue" },
  { value: "#0f766e", label: "Teal" },
  { value: "#166534", label: "Green" },
  { value: "#9d174d", label: "Plum" },
  { value: "#b45309", label: "Amber" },
  { value: "#111827", label: "Ink" },
]

export const FONT_SCALE_OPTIONS: { value: ResumeFontScale; label: string }[] = [
  { value: 0.9, label: "S" },
  { value: 1, label: "M" },
  { value: 1.1, label: "L" },
]

export const FONT_FAMILY_OPTIONS: { value: ResumeFontFamily; label: string }[] = [
  { value: "template", label: "Template" },
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
]

export const MARGIN_OPTIONS: { value: ResumeMargins; label: string }[] = [
  { value: "compact", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Wide" },
]

export const LINE_HEIGHT_OPTIONS: { value: ResumeLineHeight; label: string }[] = [
  { value: "snug", label: "Snug" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relaxed" },
]

export const TEXT_ALIGN_OPTIONS: { value: ResumeTextAlign; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
]

export const DENSITY_OPTIONS: { value: ResumeDensity; label: string }[] = [
  { value: "normal", label: "Spacious" },
  { value: "compact", label: "Compact" },
]

const STORAGE_PREFIX = "resume-customization:"

export function customizationStorageKey(resumeId: string): string {
  return `${STORAGE_PREFIX}${resumeId}`
}

const DENSITIES: ResumeDensity[] = ["normal", "compact"]
const FAMILIES: ResumeFontFamily[] = ["template", "sans", "serif"]
const SCALES: ResumeFontScale[] = [0.9, 1, 1.1]
const MARGINS: ResumeMargins[] = ["compact", "normal", "relaxed"]
const LINE_HEIGHTS: ResumeLineHeight[] = ["snug", "normal", "relaxed"]
const TEXT_ALIGNS: ResumeTextAlign[] = ["left", "center", "right", "justify"]

/**
 * Narrows unknown (localStorage) input to a valid customization, falling back to
 * the default for any field that is missing or out of range.
 */
export function parseCustomization(raw: unknown): ResumeCustomization {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CUSTOMIZATION }
  const value = raw as Record<string, unknown>
  const accent = typeof value.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(value.accent) ? value.accent : ""

  return {
    density: DENSITIES.includes(value.density as ResumeDensity)
      ? (value.density as ResumeDensity)
      : DEFAULT_CUSTOMIZATION.density,
    fontFamily: FAMILIES.includes(value.fontFamily as ResumeFontFamily)
      ? (value.fontFamily as ResumeFontFamily)
      : DEFAULT_CUSTOMIZATION.fontFamily,
    fontScale: SCALES.includes(value.fontScale as ResumeFontScale)
      ? (value.fontScale as ResumeFontScale)
      : DEFAULT_CUSTOMIZATION.fontScale,
    accent,
    margins: MARGINS.includes(value.margins as ResumeMargins)
      ? (value.margins as ResumeMargins)
      : DEFAULT_CUSTOMIZATION.margins,
    lineHeight: LINE_HEIGHTS.includes(value.lineHeight as ResumeLineHeight)
      ? (value.lineHeight as ResumeLineHeight)
      : DEFAULT_CUSTOMIZATION.lineHeight,
    textAlign: TEXT_ALIGNS.includes(value.textAlign as ResumeTextAlign)
      ? (value.textAlign as ResumeTextAlign)
      : DEFAULT_CUSTOMIZATION.textAlign,
  }
}

export function loadCustomization(resumeId: string): ResumeCustomization {
  if (typeof window === "undefined") return { ...DEFAULT_CUSTOMIZATION }
  try {
    const raw = window.localStorage.getItem(customizationStorageKey(resumeId))
    if (!raw) return { ...DEFAULT_CUSTOMIZATION }
    return parseCustomization(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CUSTOMIZATION }
  }
}

export function saveCustomization(resumeId: string, customization: ResumeCustomization): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(customizationStorageKey(resumeId), JSON.stringify(customization))
  } catch {
    // Storage can be full or blocked (private mode); customization stays in memory.
  }
}
