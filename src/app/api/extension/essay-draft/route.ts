import { NextResponse } from "next/server"
import { z } from "zod"

import {
  extensionCorsHeaders,
  extensionOptions,
  extensionUserId,
  rateLimited,
  unauthorized,
} from "@/features/ats/lib/extension-http"
import { classifyAtsField } from "@/features/ats/lib/field-classifier"
import { loadCareerProfile } from "@/features/career-profile/services/career-profile.service"
import { generateEssayDraft } from "@/features/jobs/services/essay-draft.service"
import { serializeSections } from "@/features/resume/lib/serialize-sections"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import { EXTENSION_ESSAY_DRAFT_RATE_LIMIT } from "@/features/settings/constants/data"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

const log = logger("extension-essay-draft")

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const essayDraftRequestSchema = z
  .object({
    question: z.string().min(5).max(4000),
    /** The extension's current preparation, when the question came from it. */
    preparationId: z.string().min(1).max(64).optional(),
    jobApplicationId: z.string().min(1).max(64).optional(),
    /** Explicit resume choice; otherwise the preparation/application resume. */
    resumeId: z.string().min(1).max(64).optional(),
    maxWords: z.number().int().min(50).max(500).optional(),
    instructions: z.string().max(1000).optional(),
    /** The scanned field type/tag, so a textarea is not mistaken for a select. */
    fieldType: z.string().max(40).optional(),
    tagName: z.string().max(20).optional(),
  })
  .strict()

function profileEvidence(profile: Awaited<ReturnType<typeof loadCareerProfile>>): string {
  const lines: string[] = []
  if (profile.careerGoals) lines.push(`Career goals: ${profile.careerGoals}`)

  const capabilities = profile.capabilities
    .filter((capability) => capability.confirmed)
    .map((capability) => capability.name)
  if (capabilities.length > 0) {
    lines.push(`Confirmed skills: ${capabilities.join(", ")}`)
  }

  for (const evidence of profile.evidence) {
    if (evidence.status !== "CONFIRMED") continue
    lines.push(
      [
        `${evidence.kind}: ${evidence.title}`,
        evidence.organization ? `Organization: ${evidence.organization}` : null,
        evidence.details ?? null,
        evidence.outcome ? `Outcome: ${evidence.outcome}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
  }

  return lines.join("\n\n")
}

function resumeText(sections: Section[]): string {
  return serializeSections(sections)
}

export async function OPTIONS(req: Request) {
  return extensionOptions(req, "POST, OPTIONS")
}

/**
 * `POST /api/extension/essay-draft`
 *
 * Drafts the answer to one non-sensitive free-text question from confirmed
 * profile/resume facts. It returns the draft and its grounding warnings for
 * human review; it never writes the answer to a preparation or a form.
 */
export async function POST(req: Request) {
  const cors = extensionCorsHeaders(req.headers.get("origin"), "POST, OPTIONS")
  const userId = await extensionUserId(req)
  if (!userId) return unauthorized(cors)

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_ESSAY_DRAFT,
    userId,
    EXTENSION_ESSAY_DRAFT_RATE_LIMIT
  )
  if (!allowed) return rateLimited(cors)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON", code: "VALIDATION" },
      { status: 400, headers: cors }
    )
  }

  const parsed = essayDraftRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid essay question",
        code: "VALIDATION",
      },
      { status: 400, headers: cors }
    )
  }

  const classification = classifyAtsField({
    fieldId: "essay",
    label: parsed.data.question,
    ...(parsed.data.fieldType ? { type: parsed.data.fieldType } : { type: "textarea" }),
    ...(parsed.data.tagName ? { tagName: parsed.data.tagName } : {}),
  })
  if (classification.category !== "essay") {
    return NextResponse.json(
      {
        error:
          "Only free-text essay questions can be drafted. Sensitive questions must be answered by you.",
        code: "NOT_AN_ESSAY",
      },
      { status: 400, headers: cors }
    )
  }

  let preparation:
    | {
        id: string
        jobApplicationId: string | null
        jobTitle: string | null
        companyName: string | null
        resumeId: string | null
      }
    | null = null
  if (parsed.data.preparationId) {
    preparation = await prisma.atsPreparation.findFirst({
      where: { id: parsed.data.preparationId, userId },
      select: {
        id: true,
        jobApplicationId: true,
        jobTitle: true,
        companyName: true,
        resumeId: true,
      },
    })
    if (!preparation) {
      return NextResponse.json(
        { error: "Preparation not found.", code: "NOT_FOUND" },
        { status: 404, headers: cors }
      )
    }
  }

  const jobApplicationId =
    parsed.data.jobApplicationId ?? preparation?.jobApplicationId ?? null
  let application:
    | {
        resumeId: string | null
        job: {
          title: string
          companyName: string
          description: string | null
        }
      }
    | null = null
  if (jobApplicationId) {
    application = await prisma.jobApplication.findFirst({
      where: { id: jobApplicationId, userId },
      select: {
        resumeId: true,
        job: {
          select: { title: true, companyName: true, description: true },
        },
      },
    })
    if (!application) {
      return NextResponse.json(
        { error: "Application not found.", code: "NOT_FOUND" },
        { status: 404, headers: cors }
      )
    }
  }

  const resumeId =
    parsed.data.resumeId ?? preparation?.resumeId ?? application?.resumeId ?? null
  let resumeFacts = ""
  if (resumeId) {
    const resume = await prisma.resume.findFirst({
      where: { id: resumeId, userId, status: { not: "ARCHIVED" } },
      include: {
        sections: {
          include: { items: { orderBy: { order: "asc" } } },
          orderBy: { order: "asc" },
        },
      },
    })
    if (!resume) {
      return NextResponse.json(
        { error: "Resume not found.", code: "RESUME_NOT_FOUND" },
        { status: 404, headers: cors }
      )
    }
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
    resumeFacts = resumeText(sections)
  }

  try {
    const profile = await loadCareerProfile(userId)
    const evidenceText = [resumeFacts, profileEvidence(profile)]
      .filter(Boolean)
      .join("\n\n")
    const result = await generateEssayDraft({
      userId,
      question: parsed.data.question,
      evidenceText,
      candidateName: profile.contactFullName,
      jobTitle: application?.job.title ?? preparation?.jobTitle ?? null,
      companyName: application?.job.companyName ?? preparation?.companyName ?? null,
      jobDescription: application?.job.description ?? null,
      instructions: parsed.data.instructions ?? null,
      maxWords: parsed.data.maxWords,
    })
    return NextResponse.json(result, { headers: cors })
  } catch (error) {
    if (error instanceof AiKeyRequiredError) {
      return NextResponse.json(
        { error: error.message, code: "AI_KEY_REQUIRED" },
        { status: 400, headers: cors }
      )
    }
    if (error instanceof AiDailyLimitError) {
      return NextResponse.json(
        { error: error.message, code: "AI_DAILY_LIMIT" },
        { status: 429, headers: cors }
      )
    }
    log.error("Essay draft failed", { err: error, userId })
    return NextResponse.json(
      { error: "Could not draft this answer.", code: "ESSAY_DRAFT_FAILED" },
      { status: 500, headers: cors }
    )
  }
}
