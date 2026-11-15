import { NextResponse } from "next/server"

import {
  extensionCorsHeaders,
  extensionOptions,
  extensionUserId,
  rateLimited,
  unauthorized,
} from "@/features/ats/lib/extension-http"
import { generatePdf } from "@/features/export/services/generate-pdf"
import { EXTENSION_RESUME_PDF_RATE_LIMIT } from "@/features/settings/constants/data"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

const log = logger("extension-resume-pdf")

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** A resume PDF is small; a larger render is a bug, not a document. */
const MAX_PDF_BYTES = 12 * 1024 * 1024

function safeFilename(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
  return `${base || "resume"}.pdf`
}

export async function OPTIONS(req: Request) {
  return extensionOptions(req, "GET, OPTIONS")
}

/**
 * `GET /api/extension/resumes/[id]/pdf` — the user-triggered attachment path.
 *
 * The extension only calls this after the user picks a resume and presses
 * "Attach". The bytes are returned to the side panel, which either fills the
 * page's file input with an explicit `File` or offers a download/manual-select
 * fallback. Nothing here writes to a job application or a preparation row.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const cors = extensionCorsHeaders(req.headers.get("origin"), "GET, OPTIONS")
  const userId = await extensionUserId(req)
  if (!userId) return unauthorized(cors)

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_RESUME_PDF,
    userId,
    EXTENSION_RESUME_PDF_RATE_LIMIT
  )
  if (!allowed) return rateLimited(cors)

  const { id } = await params
  const resume = await prisma.resume.findFirst({
    where: { id, userId, status: { not: "ARCHIVED" } },
    include: {
      sections: {
        include: { items: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      },
    },
  })
  if (!resume) {
    return NextResponse.json(
      { error: "Resume not found.", code: "NOT_FOUND" },
      { status: 404, headers: cors }
    )
  }

  try {
    const sections: Section[] = resume.sections.map((section) => ({
      id: section.id,
      resumeId: section.resumeId,
      type: section.type,
      title: section.title,
      order: section.order,
      visible: section.visible,
      items: section.items.map((item) => ({
        id: item.id,
        sectionId: item.sectionId,
        content: item.content as Record<string, unknown>,
        order: item.order,
      })),
    }))
    const buffer = await generatePdf({ template: resume.template, sections })
    if (buffer.byteLength > MAX_PDF_BYTES) {
      throw new Error("Rendered PDF exceeded the attachment size limit.")
    }

    const headers: Record<string, string> = {
      ...cors,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFilename(resume.title)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    }

    return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
  } catch (error) {
    log.error("Rendering a resume for extension attachment failed", {
      err: error,
      userId,
      resumeId: id,
    })
    return NextResponse.json(
      { error: "Could not render this resume.", code: "PDF_FAILED" },
      { status: 500, headers: cors }
    )
  }
}
