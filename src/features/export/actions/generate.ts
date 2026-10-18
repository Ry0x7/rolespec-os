"use server"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { optimizeResume, type OptimizeATSIssue } from "../services/optimize-resume"
import { generatePdf } from "../services/generate-pdf"
import { storeAllTemplateExports } from "../services/store-export"
import type { Prisma } from "@/generated/prisma/client"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import { parseCustomization, type ResumeCustomization } from "@/features/resume/types/customization"
import { logger } from "@/shared/lib/logger"

const log = logger("generate")

export async function generateResume(
  resumeId: string,
  options?: {
    groupAdditional?: boolean
    groupAdditionalTitle?: string
    /** Preview customization. PDF output honours it. */
    customization?: ResumeCustomization
  }
) {
  // 1. Auth check
  const session = await auth()
  if (!session?.user) return { error: "Unauthorized" }

  // 2. Fetch resume with sections and items
  //    Archived (soft-deleted) resumes are treated as gone, same as a foreign id.
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

  // 2b. Latest ATS analysis (if any) — feeds missing keywords + issues into the
  //    optimization so it does not paraphrase away ATS-tuned wording.
  //    Non-critical: a failure here just means an ATS-blind optimization.
  const latestAnalysis = await prisma.aTSAnalysis
    .findFirst({
      where: { resumeId, userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { issues: true, suggestions: true },
    })
    .catch(() => null)

  // `suggestions` is stored either as a bare array (legacy) or as
  // `{ items, missingKeywords }` — see src/app/(app)/resumes/[id]/page.tsx.
  const storedSuggestions = latestAnalysis?.suggestions as unknown as
    | unknown[]
    | { items?: unknown[]; missingKeywords?: string[] }
    | null
    | undefined
  const missingKeywords =
    storedSuggestions && !Array.isArray(storedSuggestions)
      ? storedSuggestions.missingKeywords ?? []
      : []
  const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 2 }
  const atsIssues = Array.isArray(latestAnalysis?.issues)
    ? [...(latestAnalysis.issues as unknown as OptimizeATSIssue[])].sort(
        (a, b) => (severityRank[a?.severity] ?? 3) - (severityRank[b?.severity] ?? 3)
      )
    : []

  try {
    // 3. Transform DB sections to Section format for generation
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

    // 5. Full AI optimization (uses export's simpler Section type internally)
    const optimization = await optimizeResume(
      sections.map((s) => ({
        id: s.id,
        type: s.type,
        title: s.title,
        order: s.order,
        visible: s.visible,
        items: s.items.map((i) => ({ id: i.id, content: i.content, order: i.order })),
      })),
      {
        userId: session.user.id,
        targetRole: resume.targetRole,
        targetCompany: resume.targetCompany,
        missingKeywords,
        atsIssues,
      }
    )

    // 6. Build full Section[] with resumeId/sectionId for PDF generation
    const optimizedFull: Section[] = sections.map((original) => {
      const opt = optimization.sections.find((o) => o.id === original.id)
      if (!opt) return original
      return {
        ...original,
        items: original.items.map((item) => {
          const optItem = opt.items.find((oi) => oi.id === item.id)
          if (!optItem) return item
          return { ...item, content: optItem.content as Record<string, unknown> }
        }),
      }
    })

    // 7. Save optimized content back to DB.
    //
    // Batched rather than looped. The interactive form of `$transaction` awaited
    // one `update` per item in sequence, so a résumé with 30 items cost 30
    // sequential round trips to Neon — all of it inside the same 60s budget that
    // still has one AI pass and eight document renders to pay for. The array form
    // pipelines every statement in a single request, and Prisma keeps them in one
    // transaction, so atomicity is unchanged. Same pattern as
    // `resume/actions/sections.ts` already uses for reordering.
    await prisma.$transaction([
      ...optimizedFull.flatMap((section) =>
        section.items.map((item) =>
          prisma.resumeSectionItem.update({
            where: { id: item.id },
            data: { content: item.content as object },
          })
        )
      ),
      prisma.resume.update({
        where: { id: resumeId },
        data: { version: { increment: 1 } },
      }),
    ])

    // 8. Generate a PDF for ALL 4 templates in parallel
    const templates = ["MINIMAL", "MODERN", "HARVARD", "CORPORATE"]
    // Client input crosses a server-action boundary, so narrow it before use.
    const customization = options?.customization
      ? parseCustomization(options.customization)
      : undefined
    const templateBuffers = await Promise.all(
      templates.map(async (template) => ({
        template,
        pdfBuffer: await generatePdf({
            template,
            sections: optimizedFull,
            groupAdditional: options?.groupAdditional,
            groupAdditionalTitle: options?.groupAdditionalTitle,
            customization,
          }),
      }))
    )

    // 9. Store all exports (Vercel Blob, or local disk without a blob token)
    const allUrls = await storeAllTemplateExports(resumeId, templateBuffers)

    // 10. Persist export record (store all template URLs as JSON)
    await prisma.resumeExport.create({
      data: {
        resumeId,
        userId: session.user.id,
        version: resume.version + 1,
        templateUrls: allUrls as unknown as Prisma.InputJsonValue,
      },
    })

    // The optimized sections were persisted in step 7 but the open editor's
    // store still holds the pre-optimization content; returning them lets the
    // client hydrate so the on-screen preview matches the files just exported.
    // `optimized: false` means the AI pass failed soft and the files carry the
    // untouched content — the client says so rather than claiming a full run.
    return {
      success: true,
      templateUrls: allUrls,
      sections: optimizedFull,
      optimized: optimization.optimized,
      optimizeFallbackReason: optimization.reason,
    }
  } catch (error) {
    log.error("Failed", { error })
    // The optimize pass is an AI call: a missing personal key or a spent daily
    // cap is actionable and must not read as a broken export.
    if (error instanceof AiKeyRequiredError || error instanceof AiDailyLimitError) {
      return { error: error.message }
    }
    return { error: "Generation failed. Please try again." }
  }
}
