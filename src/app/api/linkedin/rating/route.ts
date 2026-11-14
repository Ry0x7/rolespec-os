import { NextResponse } from "next/server"

import { isSameOriginRequest } from "@/features/auth/api-auth"
import { auth } from "@/features/auth/config"
import { analyzeLinkedIn } from "@/features/linkedin/services/rate-linkedin"
import { readLinkedinPdfUpload } from "@/features/linkedin/services/linkedin-upload"
import { serializeSections } from "@/features/resume/lib/serialize-sections"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import {
  isProfileRatingRateLimited,
  persistProfileRating,
} from "@/shared/lib/rating/rating.service"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { rateLimited } from "@/shared/lib/errors"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

const log = logger("linkedin")

/** Sliding window for the shared LinkedIn AI bucket (rating + assist). */
const LINKEDIN_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }

export const maxDuration = 60

/**
 * `POST /api/linkedin/rating`
 *
 * Reads the user's own "Save profile as PDF" export, optionally attaches one of
 * their resumes as context, and persists a grounded rating. The route never
 * scores a URL and never signs in to LinkedIn: the user supplies the file.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    )
  }

  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 })
  }

  const userId = session.user.id

  const upload = await readLinkedinPdfUpload(req, {
    isLimited: () => isProfileRatingRateLimited(userId, "LINKEDIN"),
    error: "Too many LinkedIn ratings. Please wait a few minutes and try again.",
  })
  if (!upload.ok) {
    return NextResponse.json(
      { error: upload.error, code: upload.code },
      { status: upload.status }
    )
  }

  const linkedinAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.AI_LINKEDIN,
    userId,
    LINKEDIN_RATE_LIMIT
  )
  if (!linkedinAllowed) {
    const err = rateLimited(
      "Too many LinkedIn AI runs. Please wait a few minutes and try again."
    )
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status }
    )
  }

  let resumeText: string | undefined
  if (upload.resumeId) {
    const resume = await prisma.resume.findFirst({
      where: { id: upload.resumeId, userId, status: { not: "ARCHIVED" } },
      include: {
        sections: {
          include: { items: { orderBy: { order: "asc" } } },
          orderBy: { order: "asc" },
        },
      },
    })
    if (!resume) {
      return NextResponse.json(
        { error: "That resume could not be found.", code: "INVALID_RESUME" },
        { status: 404 }
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
    resumeText = serializeSections(sections)
  }

  let rating
  try {
    rating = await analyzeLinkedIn(
      upload.text,
      userId,
      resumeText ? { resumeText } : undefined
    )
  } catch (err) {
    log.error("LinkedIn rating failed", { err })
    if (err instanceof AiKeyRequiredError) {
      return NextResponse.json(
        { error: err.message, code: "AI_KEY_REQUIRED" },
        { status: 400 }
      )
    }
    if (err instanceof AiDailyLimitError) {
      return NextResponse.json(
        { error: err.message, code: "AI_DAILY_LIMIT" },
        { status: 429 }
      )
    }
    return NextResponse.json(
      { error: "The rating failed. Please try again.", code: "RATING_FAILED" },
      { status: 500 }
    )
  }

  try {
    const data = await persistProfileRating({
      userId,
      kind: "LINKEDIN",
      result: rating,
    })
    return NextResponse.json(
      { data, contextUsed: { resume: Boolean(resumeText) } },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (err) {
    log.error("Persisting the LinkedIn rating failed", { err })
    return NextResponse.json(
      { error: "The rating failed. Please try again.", code: "RATING_FAILED" },
      { status: 500 }
    )
  }
}
