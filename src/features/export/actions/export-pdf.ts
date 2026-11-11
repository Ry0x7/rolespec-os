"use server"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { generatePdf } from "../services/generate-pdf"
import { storeAllTemplateExports } from "../services/store-export"
import {
  SINGLE_PAGE_WARNING,
  countPdfPages,
  singlePageCustomizations,
} from "../services/single-page"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import { parseCustomization, type ResumeCustomization } from "@/features/resume/types/customization"
import { logger } from "@/shared/lib/logger"

const log = logger("export-pdf")

/**
 * Renders the resume's saved content to a PDF with no AI involved.
 *
 * `generateResume` is the AI-optimized export: it rewrites the content through
 * `optimizeResume` first, so a user without a usable AI key can never reach a
 * file. This is the plain path — same auth/ownership rules, same template and
 * customization handling, same storage (Vercel Blob, or local disk via
 * /api/exports) — it just skips the optimize pass. No AI call happens, so no
 * AiUsageEvent row is recorded.
 *
 * Deliberately does NOT write a `ResumeExport` row: that row is what hydrates
 * `lastExport` on reload, and it is expected to carry all four templates from a
 * Generate run. A plain download renders one template and must not displace it.
 *
 * `singlePage` opts into the ATS-friendly one-page layout: the same template is
 * re-rendered with progressively tighter presentation settings until the real
 * PDF is one page. It never edits content and never swaps templates. If even
 * the tightest layout spills, the last render is returned with a warning rather
 * than failing the download.
 */
export async function exportResumePdf(
  resumeId: string,
  options?: {
    groupAdditional?: boolean
    groupAdditionalTitle?: string
    /** Preview customization. PDF output honours it. */
    customization?: ResumeCustomization
    /** Try the tightest supported layouts until the PDF fits on one page. */
    singlePage?: boolean
  }
) {
  const session = await auth()
  if (!session?.user) return { error: "Unauthorized" }

  // Archived (soft-deleted) resumes are treated as gone, same as a foreign id.
  const resume = await prisma.resume.findUnique({
    where: { id: resumeId, userId: session.user.id, status: { not: "ARCHIVED" } },
    include: {
      sections: {
        include: { items: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      },
    },
  })
  if (!resume) return { error: "Resume not found" }

  try {
    const sections: Section[] = resume.sections.map((s) => ({
      id: s.id,
      resumeId: s.resumeId,
      type: s.type,
      title: s.title,
      order: s.order,
      visible: s.visible,
      items: s.items.map((i) => ({
        id: i.id,
        sectionId: i.sectionId,
        content: i.content as Record<string, unknown>,
        order: i.order,
      })),
    }))

    const template = resume.template
    // Client input crosses a server-action boundary, so narrow it before use.
    const customization = options?.customization
      ? parseCustomization(options.customization)
      : undefined

    if (!options?.singlePage) {
      const pdfBuffer = await generatePdf({
        template,
        sections,
        groupAdditional: options?.groupAdditional,
        groupAdditionalTitle: options?.groupAdditionalTitle,
        customization,
      })

      const urls = await storeAllTemplateExports(resumeId, [{ template, pdfBuffer }])
      const pdfUrl = urls[template]?.pdfUrl
      if (!pdfUrl) return { error: "Download failed. Please try again." }

      return { success: true as const, pdfUrl, template }
    }

    let chosenBuffer: Buffer | null = null
    let chosenPageCount: number | null = null
    let layoutAttempts = 0

    for (const candidate of singlePageCustomizations(customization)) {
      layoutAttempts += 1
      const pdfBuffer = await generatePdf({
        template,
        sections,
        groupAdditional: options.groupAdditional,
        groupAdditionalTitle: options.groupAdditionalTitle,
        customization: candidate,
      })
      chosenBuffer = pdfBuffer
      chosenPageCount = await countPdfPages(pdfBuffer)
      if (chosenPageCount !== null && chosenPageCount <= 1) break
    }

    if (!chosenBuffer) return { error: "Download failed. Please try again." }

    const urls = await storeAllTemplateExports(resumeId, [
      { template, pdfBuffer: chosenBuffer },
    ])
    const pdfUrl = urls[template]?.pdfUrl
    if (!pdfUrl) return { error: "Download failed. Please try again." }

    const singlePageSatisfied = chosenPageCount !== null && chosenPageCount <= 1
    return {
      success: true as const,
      pdfUrl,
      template,
      pageCount: chosenPageCount,
      singlePageSatisfied,
      layoutAttempts,
      ...(singlePageSatisfied ? {} : { warning: SINGLE_PAGE_WARNING }),
    }
  } catch (error) {
    log.error("Failed", { error })
    return { error: "Download failed. Please try again." }
  }
}
