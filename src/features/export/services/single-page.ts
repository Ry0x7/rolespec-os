import {
  DEFAULT_CUSTOMIZATION,
  type ResumeCustomization,
} from "@/features/resume/types/customization"

/** Shown when even the tightest supported layout spills onto a second page. */
export const SINGLE_PAGE_WARNING =
  "This resume still needs more than one page at the tightest supported layout."

/** A page counter that never runs longer than this, so an export cannot hang. */
const PAGE_COUNT_TIMEOUT_MS = 15_000

/**
 * Tighter layouts to try, most readable first. Only presentation settings move:
 * compact density/margins, the smallest supported body scale, and snug leading.
 * No template component, palette or section is altered, so an export that fits
 * still looks like the template the user chose.
 *
 * The user's font family, accent and alignment are preserved. The final
 * candidate drops alignment to left only when the user chose something else —
 * centred or justified body copy wraps less predictably, so `left` is a real
 * last-resort lever rather than a replacement for a fitting layout.
 */
export function singlePageCustomizations(
  base: ResumeCustomization = DEFAULT_CUSTOMIZATION
): ResumeCustomization[] {
  const tight: ResumeCustomization = {
    ...base,
    density: "compact",
    margins: "compact",
    fontScale: 0.9,
    lineHeight: "snug",
  }

  const candidates: ResumeCustomization[] = [
    tight,
    { ...tight, margins: "normal" },
  ]

  if (base.textAlign !== "left") {
    candidates.push({ ...tight, textAlign: "left" })
  }

  const seen = new Set<string>()
  return candidates
    .filter((candidate) => {
      const key = JSON.stringify(candidate)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 3)
}

/**
 * Reads the real page count out of a rendered PDF. `@react-pdf/renderer` does
 * not expose its layout engine's page boundaries, so the only reliable source
 * is the document itself. A parse failure returns `null` and the caller keeps
 * the last render: a page counter must never turn a working download into an
 * error.
 */
export async function countPdfPages(buffer: Uint8Array): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let parser:
    | {
        getText: () => Promise<{ total: number }>
        destroy?: () => Promise<void>
      }
    | undefined

  try {
    const { PDFParse } = await import("pdf-parse")
    parser = new PDFParse({ data: buffer })
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`PDF page count timed out after ${PAGE_COUNT_TIMEOUT_MS}ms`)),
        PAGE_COUNT_TIMEOUT_MS
      )
    })
    const result = await Promise.race([parser.getText(), timeout])
    return Number.isFinite(result.total) && result.total > 0 ? result.total : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
    await Promise.resolve(parser?.destroy?.()).catch(() => {})
  }
}
