"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { rateLimited } from "@/shared/lib/errors"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"
import {
  serializeResumeForCoverLetter,
  generateCoverLetterAI,
  improveCoverLetterAI,
} from "../services/cover-letter.service"
import { resolveCandidateName } from "../services/resume-text.service"
import type { Section } from "@/features/resume/hooks/use-resume-store"

/** Sliding window for the per-user cover-letter improve rate limit. */
const IMPROVE_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }

const MAX_COVER_LETTER_LENGTH = 20_000
const MAX_INSTRUCTION_LENGTH = 1000

// The editor sends the textarea's current value, which may hold unsaved edits,
// so the content still comes from the caller — validated and capped here rather
// than read back from the DB.
const improveInputSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1).max(MAX_COVER_LETTER_LENGTH),
  instruction: z.string().min(1).max(MAX_INSTRUCTION_LENGTH),
})

/**
 * `redirect: false` is for callers that stay on the page they are on — the Job
 * Detail drawer — and need the new id back to link to it. The default keeps the
 * standalone `/jobs/cover-letter/new` behaviour: navigate straight to the editor.
 */
export async function generateCoverLetter(
  formData: FormData,
  options?: { redirect?: boolean },
) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const schema = z.object({
    resumeId: z.string().min(1),
    jobDescription: z.string().optional(),
    jobApplicationId: z.string().optional(),
  })
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: "Invalid input" }
  const { resumeId, jobApplicationId } = parsed.data

  let newId: string
  try {
    // The form omits the textarea when the linked job already stores a usable
    // description — fall back to that. A submitted description always wins.
    const submitted = parsed.data.jobDescription ?? ""
    let jobDescription = submitted.trim().length >= 20 ? submitted : ""
    // A linked job is ownership-checked even when we do not need its text, so a
    // foreign id can never be persisted on the caller's cover letter.
    if (jobApplicationId) {
      const application = await prisma.jobApplication.findUnique({
        where: { id: jobApplicationId, userId: session.user.id },
        select: { job: { select: { description: true } } },
      })
      if (!application) return { error: "Job application not found" }
      if (!jobDescription) {
        const stored = application.job.description?.trim() ?? ""
        if (stored.length >= 20) jobDescription = stored
      }
    }
    if (!jobDescription) return { error: "Job description is required." }

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

    const resumeText = serializeResumeForCoverLetter(sections)
    // This action builds its own `sections` rather than going through
    // `loadResumeTextForUser`, so the name has to be resolved here too — the
    // serializer deliberately never emits the contact block.
    const candidateName = await resolveCandidateName(session.user.id, sections)
    const result = await generateCoverLetterAI(
      resumeText,
      jobDescription,
      session.user.id,
      candidateName,
    )

    const { coverLetter, grounding, ...suggestions } = result
    const newCoverLetter = await prisma.coverLetter.create({
      data: {
        userId: session.user.id,
        resumeId,
        jobApplicationId: jobApplicationId ?? null,
        jobDescription,
        content: coverLetter,
        // The grounding warning rides in the same Json column as the rest of the
        // suggestions: this action redirects, so anything not persisted here
        // would be lost before the page that has to show it renders.
        suggestions: {
          ...suggestions,
          ...(grounding
            ? {
                grounding: {
                  claimed: grounding.claimed.map((c) => ({ ...c })),
                  // Only written when the split found something quiet, so a
                  // letter with nothing to report keeps the old Json shape.
                  ...(grounding.namedAsGap?.length
                    ? { namedAsGap: grounding.namedAsGap.map((c) => ({ ...c })) }
                    : {}),
                },
              }
            : {}),
        },
      },
      select: { id: true },
    })

    newId = newCoverLetter.id
  } catch (err) {
    // The key and daily-limit messages are actionable and safe to show; anything
    // else could carry provider/infra detail, so it stays generic.
    if (err instanceof AiKeyRequiredError || err instanceof AiDailyLimitError) {
      return { error: err.message }
    }
    return { error: "Something went wrong. Please try again." }
  }
  // The letter is already persisted either way; only the navigation differs.
  if (options?.redirect === false) return { id: newId }
  redirect(`/jobs/cover-letter/${newId}`)
}

export async function updateCoverLetterContent(id: string, content: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const existing = await prisma.coverLetter.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!existing) return { error: "Not found" }

    await prisma.coverLetter.update({ where: { id }, data: { content } })
    revalidatePath(`/jobs/cover-letter/${id}`)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function improveCoverLetter(
  id: string,
  content: string,
  instruction: string,
) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const userId = session.user.id

  const parsed = improveInputSchema.safeParse({ id, content, instruction })
  if (!parsed.success) return { error: "Invalid input" }

  try {
    const existing = await prisma.coverLetter.findUnique({
      where: { id, userId },
      select: { id: true },
    })
    if (!existing) return { error: "Not found" }

    // ── Rate limit: max 10 improve runs per user per 10 minutes ────────────
    // Improving is free, so there is no artifact row to count — the shared
    // rate_limit_attempts table carries the window instead.
    const improveAllowed = await consumeRateLimit(
      RATE_LIMIT_BUCKETS.COVER_LETTER_IMPROVE,
      userId,
      IMPROVE_RATE_LIMIT
    )
    if (!improveAllowed) {
      const err = rateLimited("Too many AI rewrites. Please wait a few minutes and try again.")
      return { error: err.message }
    }

    const improved = await improveCoverLetterAI(
      parsed.data.content,
      parsed.data.instruction,
      userId,
    )
    return { success: true as const, improved }
  } catch (err) {
    if (err instanceof AiKeyRequiredError || err instanceof AiDailyLimitError) {
      return { error: err.message }
    }
    return { error: "Something went wrong. Please try again." }
  }
}

export async function deleteCoverLetter(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const existing = await prisma.coverLetter.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!existing) return { error: "Not found" }

    await prisma.coverLetter.delete({ where: { id } })
    revalidatePath("/jobs/cover-letter")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}
