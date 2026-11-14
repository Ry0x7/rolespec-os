import path from "node:path"
import { Font } from "@react-pdf/renderer"

/**
 * Side-effect module: run once before any PDF render.
 *
 * react-pdf lays text out with Knuth–Plass line breaking and, by default, an
 * en-us hyphenation dictionary — so it can split "Extraordinarily" into
 * "Extraordinari-/ly" and fit a paragraph in fewer lines than the browser
 * preview, which never hyphenates. That divergence is what made the editor
 * predict two pages for a resume the export fit on one.
 *
 * Returning the word untouched disables hyphenation, so both sides break on
 * whitespace only and the preview's measured line count is the export's.
 */
Font.registerHyphenationCallback((word) => [word])

/**
 * The editor preview renders in Inter (next/font → `--font-sans`), but the PDF
 * used to render the sans templates in Helvetica. Inter's wider advance widths
 * made the preview wrap ~2 lines/page earlier than the export, so the preview
 * could predict two pages for a resume the PDF fit on one. Embedding the same
 * face on both sides makes line wrapping — and therefore page counts — agree.
 *
 * The .woff paths are built from `process.cwd()` instead of `require.resolve`:
 * Turbopack statically follows a resolve call and cannot bundle (or
 * externalize) a binary module, while a plain filesystem path is opaque to it.
 * `process.cwd()` is the project root under the Next.js server, `next start`
 * and `npx tsx scripts/render-pdf-preview.ts` alike. Serverless deploys don't
 * trace unreferenced files, so next.config.ts force-includes these .woffs via
 * `outputFileTracingIncludes`.
 *
 * Only the latin subset is embedded (same practical coverage as the WinAnsi
 * Helvetica it replaces). The templates never mix bold with italic, so the
 * registered styles mirror exactly what they use: 400, 400-italic and 700.
 */
const fontFile = (name: string) =>
  path.join(process.cwd(), "node_modules", "@fontsource", "inter", "files", name)

Font.register({
  family: "Inter",
  fonts: [
    { src: fontFile("inter-latin-400-normal.woff") },
    { src: fontFile("inter-latin-400-italic.woff"), fontStyle: "italic" },
  ],
})

// Registered as its own family because the templates address bold text via
// `boldFontFamily` (the Helvetica/Helvetica-Bold pattern), not `fontWeight`.
Font.register({
  family: "Inter-Bold",
  src: fontFile("inter-latin-700-normal.woff"),
})
