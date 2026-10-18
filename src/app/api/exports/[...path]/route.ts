import { readFile } from "node:fs/promises"
import path from "node:path"

import { get } from "@vercel/blob"
import { NextResponse } from "next/server"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { exportStorageDir } from "@/features/export/services/store-export"
import { logger } from "@/shared/lib/logger"

/**
 * The single download path for resume exports, whichever backend holds the
 * bytes: private Vercel Blob objects when BLOB_READ_WRITE_TOKEN is set,
 * local-disk files under EXPORT_STORAGE_DIR otherwise (self-hosted / Docker,
 * see store-export.ts). Neither is reachable without going through here.
 *
 * Authorization, not obscurity: the caller must be signed in AND own the resume
 * the export belongs to. The random filename only means a leaked URL cannot be
 * derived from a resume id.
 */

const log = logger("export/download")

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
}

// Matches the segments store-export.ts generates (cuid / timestamp-hex /
// template-base64url.ext). Anything else — path traversal, encoded slashes,
// dotfiles — is a 404. base64url can produce `-` and `_`; `.` appears only in
// the file extension.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/
const SAFE_FILENAME = /^[A-Za-z0-9_-]+\.pdf$/

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { path: segments } = await params
  if (segments.length !== 3) return notFound()

  const [resumeId, batch, filename] = segments
  if (!SAFE_SEGMENT.test(resumeId) || !SAFE_SEGMENT.test(batch) || !SAFE_FILENAME.test(filename)) {
    return notFound()
  }

  // Ownership check — 404 (not 403) so the route does not confirm to other
  // users that a given resume id exists. Archived resumes keep their past
  // exports downloadable, matching blob URLs which never expire either.
  const resume = await prisma.resume.findUnique({
    where: { id: resumeId, userId: session.user.id },
    select: { id: true },
  })
  if (!resume) return notFound()

  // Blob first when the store is configured. A `null` means the object is not
  // there, which is expected on a deployment that used to write to disk — fall
  // through to the disk read rather than 404ing on the older exports.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await get(`exports/${resumeId}/${batch}/${filename}`, { access: "private" })
      if (blob?.statusCode === 200) {
        return new NextResponse(blob.stream, { headers: downloadHeaders(filename) })
      }
    } catch (error) {
      // A store outage should not be reported as "this export never existed",
      // but it also should not fail the request while a disk copy may exist.
      log.warn("Blob export read failed, falling back to disk", {
        resumeId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const storageRoot = path.resolve(exportStorageDir())
  const filePath = path.resolve(storageRoot, resumeId, batch, filename)
  if (!filePath.startsWith(storageRoot + path.sep)) return notFound()

  let file: Buffer
  try {
    file = await readFile(filePath)
  } catch {
    return notFound()
  }

  return new NextResponse(new Uint8Array(file), { headers: downloadHeaders(filename) })
}

/** Shared by both backends so a blob download and a disk one are identical. */
function downloadHeaders(filename: string): Record<string, string> {
  const ext = path.extname(filename)
  return {
    "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    // PDFs open in the browser tab (links use target="_blank"); anything else
    // gets a download hint with a stable, readable name.
    "Content-Disposition": ext === ".pdf" ? "inline" : `attachment; filename="${filename}"`,
    // Filenames are content-addressed-ish (random suffix per generation), so
    // the bytes behind a URL never change.
    "Cache-Control": "private, max-age=31536000, immutable",
  }
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}
