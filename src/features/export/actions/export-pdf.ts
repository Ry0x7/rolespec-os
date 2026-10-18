"use server"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { generatePdf } from "../services/generate-pdf"
import { storeAllTemplateExports } from "../services/store-export"
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
 */
export async function exportResumePdf(
  resumeId: string,
  options?: {
    groupAdditional?: boolean
    groupAdditionalTitle?: string
    /** Preview customization. PDF output honours it. */
    customization?: ResumeCustomization
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
  } catch (error) {
    log.error("Failed", { error })
    return { error: "Download failed. Please try again." }
  }
}
