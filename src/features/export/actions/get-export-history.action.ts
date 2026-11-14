"use server"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { sanitizeTemplateUrls, type TemplateExportUrls } from "../services/store-export"

export interface ExportHistoryEntry {
  id: string
  version: number
  createdAt: string
  templates: Record<string, TemplateExportUrls>
}

export interface ExportHistoryResult {
  data?: ExportHistoryEntry[]
  error?: string
}

/**
 * Export history for one resume: every `Generate` run that stored a
 * `ResumeExport` row, newest first, with legacy absolute-blob URLs stripped.
 *
 * Plain "Download PDF" runs deliberately write no row (see `export-pdf.ts`),
 * so they never appear here — this is the history of full template batches,
 * and each entry's URLs download through the authenticated `/api/exports`
 * route. Ownership is checked on both the resume and the rows.
 */
export async function getExportHistory(
  resumeId: string
): Promise<ExportHistoryResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  if (!resumeId) return { error: "Resume not found" }

  const resume = await prisma.resume.findUnique({
    where: { id: resumeId, userId: session.user.id, status: { not: "ARCHIVED" } },
    select: { id: true },
  })
  if (!resume) return { error: "Resume not found" }

  const rows = await prisma.resumeExport.findMany({
    where: { resumeId, userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, version: true, createdAt: true, templateUrls: true },
  })

  const data: ExportHistoryEntry[] = []
  for (const row of rows) {
    const templates = sanitizeTemplateUrls(row.templateUrls)
    // Rows whose URLs no longer validate (legacy absolute-blob rows, or a
    // retention sweep that removed the files) carry nothing downloadable.
    if (!templates) continue
    data.push({
      id: row.id,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      templates,
    })
  }

  return { data }
}
