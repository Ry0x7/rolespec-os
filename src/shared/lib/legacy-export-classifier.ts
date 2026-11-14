/**
 * Pure classification logic for the P0.8 legacy-export-blob sweep
 * (`scripts/sweep-legacy-export-blobs.ts`). Kept dependency-free (no prisma,
 * no @vercel/blob) so it can be unit tested directly; the script wires this up
 * to real `list()`/Prisma reads.
 *
 * Background: before commit d5f65ff, `storeAllTemplateExports` uploaded PDFs
 * to Vercel Blob with `access: "public"` under
 * `exports/<resumeId>/<batch>/<template>.pdf` (Vercel's own `addRandomSuffix`
 * inserted an opaque suffix of unknown, undocumented shape before the
 * extension), and stored the resulting absolute CDN URL directly in
 * `ResumeExport.templateUrls[<template>].pdfUrl` (and, pre-multi-template,
 * flat `pdfUrl`/`docxUrl` columns later backfilled into `templateUrls.MINIMAL`
 * by migration 20260801130000). Since d5f65ff, uploads are `access: "private"`
 * with a filename this app generates itself —
 * `<template>-<9 random bytes, base64url>.pdf`, i.e. exactly 12
 * `[A-Za-z0-9_-]` characters between the last `-` and `.pdf` — and only the
 * same-origin `/api/exports/<resumeId>/<batch>/<filename>` URL is stored.
 *
 * Because Vercel's own legacy suffix format is not documented or introspect-
 * able from the SDK, pathname shape alone cannot positively identify a legacy
 * blob. It CAN, however, positively rule one out: the current writer always
 * produces the exact shape above, so any blob matching it could only have
 * been written by the current code path and must never be treated as legacy.
 * That asymmetry is what `classifyBlob` relies on — a shape match is a hard
 * "current", never overridden by a cutoff date.
 */

/** A single `{ pdfUrl?, docxUrl? }` entry inside `templateUrls`. */
export interface TemplateUrlEntry {
  pdfUrl?: unknown
  docxUrl?: unknown
}

/** The shape of `ResumeExport.templateUrls`: `{ [template]: TemplateUrlEntry }`. */
export type TemplateUrlsMap = Record<string, TemplateUrlEntry>

const SAME_ORIGIN_EXPORT_PREFIX = "/api/exports/"

/**
 * The exact filename shape the current writer produces:
 * `<template>-<12 base64url chars>.<ext>`. Used only to positively identify
 * "definitely current" — see module doc comment.
 */
const CURRENT_PATHNAME_SHAPE =
  /^exports\/[^/]+\/[^/]+\/[a-z0-9]+-[A-Za-z0-9_-]{12}\.(pdf|docx)$/

/**
 * Maps a same-origin download URL (`/api/exports/<resumeId>/<batch>/<file>`)
 * back to the blob/disk pathname it serves (`exports/<resumeId>/<batch>/<file>`),
 * or null if the value doesn't have that shape.
 */
export function pathnameFromSameOriginUrl(url: string): string | null {
  if (!url.startsWith(SAME_ORIGIN_EXPORT_PREFIX)) return null
  const rest = url.slice(SAME_ORIGIN_EXPORT_PREFIX.length)
  return rest.length > 0 ? `exports/${rest}` : null
}

/**
 * Extracts the pathname component from a legacy absolute blob CDN URL
 * (e.g. `https://<store>.public.blob.vercel-storage.com/exports/...`), or
 * null if the value isn't a parseable absolute URL.
 */
export function pathnameFromAbsoluteUrl(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\/+/, "")
  } catch {
    return null
  }
}

/** True when the pathname matches the shape only the current writer produces. */
export function matchesCurrentPathnameShape(pathname: string): boolean {
  return CURRENT_PATHNAME_SHAPE.test(pathname)
}

export interface ReferencedPathnames {
  /** Pathnames a live row references via a legacy absolute URL. */
  legacy: Set<string>
  /** Pathnames a live row references via the current same-origin URL. */
  current: Set<string>
}

/**
 * Walks every `ResumeExport.templateUrls` JSON value and splits the
 * pathnames it references into legacy (absolute CDN URL) and current
 * (same-origin `/api/exports/...` URL). Malformed/unknown shapes are skipped
 * rather than thrown on — `templateUrls` is a schemaless `Json` column.
 */
export function collectReferencedPathnames(
  templateUrlsValues: unknown[]
): ReferencedPathnames {
  const legacy = new Set<string>()
  const current = new Set<string>()

  for (const value of templateUrlsValues) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue

    for (const entry of Object.values(value as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue

      for (const key of ["pdfUrl", "docxUrl"] as const) {
        const raw = (entry as Record<string, unknown>)[key]
        if (typeof raw !== "string" || raw.length === 0) continue

        const samePathname = pathnameFromSameOriginUrl(raw)
        if (samePathname) {
          current.add(samePathname)
          continue
        }

        if (/^https?:\/\//i.test(raw)) {
          const legacyPathname = pathnameFromAbsoluteUrl(raw)
          if (legacyPathname) legacy.add(legacyPathname)
        }
      }
    }
  }

  return { legacy, current }
}

export type BlobClassification = "legacy" | "current" | "unknown"

export interface ClassifyBlobInput {
  pathname: string
  uploadedAt: Date
}

/**
 * Classifies one listed blob.
 *
 * Precedence (most to least certain):
 * 1. A live row's `templateUrls` still points at this pathname via the
 *    same-origin URL → "current". Never delete.
 * 2. The pathname has the exact shape only the current writer produces →
 *    "current", even with no DB reference (covers a row that was later
 *    deleted/overwritten, or a race between upload and DB write). Never
 *    delete based on a cutoff alone.
 * 3. A live row's `templateUrls` still points at this pathname via a legacy
 *    absolute URL → "legacy". Safe to delete (also a signal to run --fix-db).
 * 4. No DB reference either way, but a `--before` cutoff was supplied and
 *    this blob predates it → "legacy" heuristic.
 * 5. Otherwise → "unknown" (orphaned; requires manual review, never
 *    auto-deleted).
 */
export function classifyBlob(
  { pathname, uploadedAt }: ClassifyBlobInput,
  referenced: ReferencedPathnames,
  cutoff?: Date
): BlobClassification {
  if (referenced.current.has(pathname)) return "current"
  if (matchesCurrentPathnameShape(pathname)) return "current"
  if (referenced.legacy.has(pathname)) return "legacy"
  if (cutoff && uploadedAt < cutoff) return "legacy"
  return "unknown"
}
