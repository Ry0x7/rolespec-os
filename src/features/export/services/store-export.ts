import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import { del, list, put } from "@vercel/blob"

import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"

export interface TemplateExportUrls {
  pdfUrl: string
}

const PDF_MIME = "application/pdf"

const log = logger("export/store")

/**
 * An export holds the resume's full contents: name, email, phone and work
 * history. The privacy model is therefore authorization, not obscurity —
 * whichever backend stores the bytes:
 *
 * - Vercel Blob objects are written with `access: "private"`, so the blob's own
 *   URL serves nothing without the store credentials.
 * - Local-disk files live under EXPORT_STORAGE_DIR, outside any static route.
 *
 * Both backends hand back the same same-origin URL (`/api/exports/...`), and
 * that route is the only download path: it checks the session and that the
 * caller owns the resume before it reads a byte. The random filename below is
 * defense in depth (a leaked URL is still not derivable from a resume id), not
 * the access control.
 */
const BLOB_UPLOAD_OPTIONS = { access: "private" } as const

/**
 * Where the local-disk fallback stores export files when no Vercel Blob
 * credentials are configured. Self-hosted (Docker) deploys set
 * EXPORT_STORAGE_DIR to a mounted volume; the default keeps local dev working
 * out of the box. Files here are served by /api/exports, which additionally
 * checks session + resume ownership.
 */
export function exportStorageDir(): string {
  return process.env.EXPORT_STORAGE_DIR || path.join(process.cwd(), ".exports")
}

interface UploadResult {
  template: string
  format: "pdf"
  url: string
}

/**
 * Both backends generate the filename here rather than letting the storage
 * layer do it, so a blob and a disk file for the same export are named the
 * same way and one URL shape (`/api/exports/<resumeId>/<batch>/<filename>`)
 * describes both. Must keep matching the route's SAFE_FILENAME pattern.
 */
function exportFilename(template: string, format: "pdf"): string {
  return `${template.toLowerCase()}-${randomBytes(9).toString("base64url")}.${format}`
}

function downloadUrl(resumeId: string, batch: string, filename: string): string {
  return `/api/exports/${resumeId}/${batch}/${filename}`
}

/**
 * Vercel Blob branch. The URL `put` returns is deliberately discarded: a private
 * blob is not fetchable from it anyway, and the app serves every export through
 * the authenticated /api/exports route.
 */
function storeViaBlob(
  resumeId: string,
  batch: string,
  exports: Array<{ template: string; pdfBuffer: Buffer }>
): Array<Promise<UploadResult>> {
  return exports.map(({ template, pdfBuffer }) => {
    const filename = exportFilename(template, "pdf")
    return put(`exports/${resumeId}/${batch}/${filename}`, pdfBuffer, {
      ...BLOB_UPLOAD_OPTIONS,
      contentType: PDF_MIME,
    }).then(() => ({
      template,
      format: "pdf" as const,
      url: downloadUrl(resumeId, batch, filename),
    }))
  })
}

/**
 * Local-disk fallback, used when BLOB_READ_WRITE_TOKEN is absent (self-hosted /
 * Docker). Mirrors the blob layout (<resumeId>/<batch>/<file>) and returns the
 * same /api/exports URL, which is where authentication and ownership are
 * enforced.
 */
function storeOnDisk(
  resumeId: string,
  batch: string,
  exports: Array<{ template: string; pdfBuffer: Buffer }>
): Array<Promise<UploadResult>> {
  const dir = path.join(exportStorageDir(), resumeId, batch)
  const ready = mkdir(dir, { recursive: true })

  const writeOne = async (
    template: string,
    format: "pdf",
    buffer: Buffer
  ): Promise<UploadResult> => {
    await ready
    const filename = exportFilename(template, format)
    await writeFile(path.join(dir, filename), buffer)
    return { template, format, url: downloadUrl(resumeId, batch, filename) }
  }

  return exports.map(({ template, pdfBuffer }) => writeOne(template, "pdf", pdfBuffer))
}

/**
 * Prefix every valid `pdfUrl` must have. Same-origin download route enforced
 * by /api/exports — see the module doc comment above.
 */
const SAME_ORIGIN_EXPORT_PREFIX = "/api/exports/"

/**
 * Rows written before commit d5f65ff stored absolute Vercel Blob CDN URLs
 * (e.g. `https://...public.blob.vercel-storage.com/...`) in `templateUrls`.
 * Those legacy blobs are subject to deletion by an ops sweep and were never
 * meant to be public in the first place, so a legacy absolute URL must never
 * reach the client — only the current same-origin `/api/exports/...` shape is
 * safe to hand back. This is a pure, defensive parse: unknown/malformed JSON
 * shapes are dropped rather than thrown on, since `templateUrls` is a
 * `Json` column with no schema guarantee at read time.
 */
export function sanitizeTemplateUrls(
  value: unknown
): Record<string, TemplateExportUrls> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null

  const result: Record<string, TemplateExportUrls> = {}

  for (const [template, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue
    const pdfUrl = (entry as { pdfUrl?: unknown }).pdfUrl
    if (typeof pdfUrl !== "string") continue
    if (!pdfUrl.startsWith(SAME_ORIGIN_EXPORT_PREFIX)) continue
    result[template] = { pdfUrl }
  }

  return Object.keys(result).length > 0 ? result : null
}

export async function storeAllTemplateExports(
  resumeId: string,
  exports: Array<{ template: string; pdfBuffer: Buffer }>
): Promise<Record<string, TemplateExportUrls>> {
  const results: Record<string, TemplateExportUrls> = {}
  const batch = `${Date.now()}-${randomUUID().slice(0, 8)}`

  // Checked per call (not at module scope) so a token added at runtime — or
  // removed in tests — takes effect without a restart.
  const uploads = process.env.BLOB_READ_WRITE_TOKEN
    ? storeViaBlob(resumeId, batch, exports)
    : storeOnDisk(resumeId, batch, exports)

  const uploaded = await Promise.all(uploads)

  for (const { template, url } of uploaded) {
    results[template] = { pdfUrl: url }
  }

  return results
}

/** Every export blob lives under this prefix — see `storeViaBlob`. */
const BLOB_EXPORT_PREFIX = "exports/"

/** Deletes every blob under exports/<resumeId>/, following list pagination. */
async function deleteBlobsForResume(resumeId: string): Promise<void> {
  const pathnames: string[] = []
  let cursor: string | undefined

  do {
    const page = await list({ prefix: `${BLOB_EXPORT_PREFIX}${resumeId}/`, cursor })
    for (const blob of page.blobs) pathnames.push(blob.pathname)
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  if (pathnames.length > 0) await del(pathnames)
}

/**
 * Removes the stored export files for the given resumes. Called when a user
 * account is hard-deleted: the `ResumeExport` rows go with the cascade, but the
 * PDFs they point at live outside the database and would otherwise survive the
 * erasure the account deletion promises.
 *
 * Best-effort by design — the account is already gone by the time this runs, so
 * a storage failure is logged and swallowed rather than surfaced as a failed
 * deletion. Disk cleanup runs even when a blob token is configured, so a
 * deployment that switched backends still clears the files the other one wrote.
 *
 * Resume deletion inside an account stays soft (ARCHIVED) and keeps its
 * exports; only account removal reaches here.
 */
export async function deleteExportFilesForResumes(resumeIds: string[]): Promise<void> {
  if (resumeIds.length === 0) return

  for (const resumeId of resumeIds) {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        await deleteBlobsForResume(resumeId)
      } catch (error) {
        log.warn("Failed to delete blob exports for resume", {
          resumeId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    try {
      await rm(path.join(exportStorageDir(), resumeId), { recursive: true, force: true })
    } catch (error) {
      log.warn("Failed to delete on-disk exports for resume", {
        resumeId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

// ─── Retention / expiry ───────────────────────────────────────────────────────

/**
 * How long a generated export is kept when the operator has not said otherwise.
 * An export is a full copy of the resume's personal data (name, email, phone,
 * work history) sitting outside the database, so it should not live forever
 * just because the account does.
 */
export const DEFAULT_EXPORT_RETENTION_DAYS = 90

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Vercel Blob rejects a delete of more than 1000 pathnames in one call. */
const BLOB_DELETE_CHUNK = 1000

/**
 * Reads EXPORT_RETENTION_DAYS, a positive integer number of days.
 *
 * A missing, malformed, zero or negative value falls back to the documented
 * default rather than disabling the sweep: an unset variable already means 90
 * days, so a typo behaving like "unset" is the least surprising outcome, and a
 * retention job that quietly stops running is the failure mode this task
 * exists to prevent. The effective value is returned by `pruneExpiredExports`
 * (and therefore by the cron route) so a misconfiguration is visible.
 */
export function exportRetentionDays(): number {
  const raw = process.env.EXPORT_RETENTION_DAYS
  if (raw === undefined || raw.trim() === "") return DEFAULT_EXPORT_RETENTION_DAYS

  const parsed = Number(raw.trim())
  if (!Number.isInteger(parsed) || parsed <= 0) {
    log.warn("Ignoring invalid EXPORT_RETENTION_DAYS, using default", {
      value: raw,
      defaultDays: DEFAULT_EXPORT_RETENTION_DAYS,
    })
    return DEFAULT_EXPORT_RETENTION_DAYS
  }

  return parsed
}

export interface ExportPruneResult {
  retentionDays: number
  cutoff: string
  /** `ResumeExport` rows deleted. */
  rows: number
  /** Vercel Blob objects deleted (0 when no blob token is configured). */
  blobs: number
  /** On-disk batch directories removed. */
  batches: number
}

/**
 * Deletes every blob under `exports/` whose `uploadedAt` predates the cutoff,
 * following list pagination.
 *
 * Pathnames are collected across all pages before anything is deleted: mutating
 * the store mid-pagination would be listing against a cursor whose underlying
 * set is shifting. Deletes then go out in chunks the API accepts. A failing
 * chunk is logged and the rest still run.
 */
async function pruneExpiredBlobs(cutoff: Date): Promise<number> {
  const cutoffMs = cutoff.getTime()
  const expired: string[] = []
  let cursor: string | undefined

  do {
    const page = await list({ prefix: BLOB_EXPORT_PREFIX, cursor })
    for (const blob of page.blobs) {
      // `uploadedAt` is typed as a Date; re-wrapping also tolerates a string
      // from a serialized response. An unparseable value yields NaN, and
      // `NaN < cutoffMs` is false — unknown age means keep, never delete.
      if (new Date(blob.uploadedAt).getTime() < cutoffMs) expired.push(blob.pathname)
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  let deleted = 0
  for (let i = 0; i < expired.length; i += BLOB_DELETE_CHUNK) {
    const chunk = expired.slice(i, i + BLOB_DELETE_CHUNK)
    try {
      await del(chunk)
      deleted += chunk.length
    } catch (error) {
      log.warn("Failed to delete expired export blobs", {
        count: chunk.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return deleted
}

/**
 * Age of a `<timestamp>-<uuid prefix>` batch directory.
 *
 * The name is generated in `storeAllTemplateExports` as
 * `${Date.now()}-${randomUUID().slice(0, 8)}` — a *decimal* epoch millisecond
 * count, not hex. Reading it avoids a `stat` per directory and survives a copy
 * that reset mtimes; anything that does not parse as a plausible timestamp
 * (including directories written by an older layout) falls back to the
 * directory's own mtime.
 */
async function batchTimestampMs(dir: string, name: string): Promise<number> {
  const [head] = name.split("-")
  if (/^\d{13,}$/.test(head)) {
    const parsed = Number(head)
    // Reject a future stamp: a clock-skewed or crafted name must not be able to
    // make a directory look immortal *or* skip the mtime fallback silently.
    if (Number.isFinite(parsed) && parsed <= Date.now()) return parsed
  }

  const info = await stat(dir)
  return info.mtimeMs
}

/**
 * Removes on-disk batch directories older than the cutoff, then any resume
 * directory left empty behind them.
 *
 * Only real directories are considered: `readdir` with `withFileTypes` reports
 * link status from `lstat`, so `isDirectory()` is already false for a symlink
 * and a link planted in EXPORT_STORAGE_DIR cannot steer `rm` outside the root.
 * The resolved-path check below is the belt to that suspenders.
 */
async function pruneExpiredDiskBatches(cutoff: Date): Promise<number> {
  const root = path.resolve(exportStorageDir())
  const cutoffMs = cutoff.getTime()
  let removed = 0

  let resumeDirs: string[]
  try {
    resumeDirs = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    // No storage directory yet (the common case on a blob-backed deploy) is not
    // a failure; anything else is worth a line.
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      log.warn("Failed to read export storage directory", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return 0
  }

  for (const resumeId of resumeDirs) {
    const resumeDir = path.resolve(root, resumeId)
    if (!resumeDir.startsWith(root + path.sep)) continue

    let batches: string[]
    try {
      batches = (await readdir(resumeDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch (error) {
      log.warn("Failed to read export directory for resume", {
        resumeId,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    for (const batch of batches) {
      const batchDir = path.resolve(resumeDir, batch)
      if (!batchDir.startsWith(resumeDir + path.sep)) continue

      try {
        if ((await batchTimestampMs(batchDir, batch)) >= cutoffMs) continue
        await rm(batchDir, { recursive: true, force: true })
        removed += 1
      } catch (error) {
        log.warn("Failed to remove expired export batch", {
          resumeId,
          batch,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Best-effort tidy-up. `rmdir` refuses a non-empty directory, which is
    // exactly the guard wanted here: a resume with surviving batches keeps them.
    try {
      await rmdir(resumeDir)
    } catch {
      // ENOTEMPTY (batches remain) is the expected outcome, not an error.
    }
  }

  return removed
}

/**
 * Retention sweep for generated resume exports, run by
 * `/api/cron/prune-exports`.
 *
 * Files are pruned by *age*, not by joining `ResumeExport`: the plain
 * "Download PDF" path (`export-pdf.ts`) deliberately writes files without a row,
 * so a DB-driven sweep would leave those behind forever.
 *
 * Order matters. The row delete runs first and is allowed to throw, so a
 * database failure aborts the run before any bytes are gone and the next run
 * retries cleanly. File deletion is then best-effort per item — a storage
 * outage must not stop the rest of the sweep, and anything missed is simply
 * older on the next pass.
 */
export async function pruneExpiredExports(
  retentionDays: number = exportRetentionDays()
): Promise<ExportPruneResult> {
  const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY)

  const { count: rows } = await prisma.resumeExport.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })

  let blobs = 0
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      blobs = await pruneExpiredBlobs(cutoff)
    } catch (error) {
      log.warn("Failed to prune expired export blobs", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Runs even with a blob token configured, so a deployment that switched
  // backends still ages out what the other one wrote.
  const batches = await pruneExpiredDiskBatches(cutoff)

  log.info("Pruned expired exports", { retentionDays, rows, blobs, batches })

  return { retentionDays, cutoff: cutoff.toISOString(), rows, blobs, batches }
}
