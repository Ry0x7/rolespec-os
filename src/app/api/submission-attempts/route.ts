import { NextResponse } from "next/server"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import {
  SubmissionError,
  listSubmissionAttempts,
  stageSubmissionAttempt,
} from "@/features/submissions/services/submission.service"
import {
  createSubmissionAttemptSchema,
  submissionAttemptStatusSchema,
} from "@/features/submissions/schemas/submission.schema"
import { SUBMISSION_WRITE_RATE_LIMIT } from "@/features/settings/constants/data"
import type { SubmissionAttemptStatus } from "@/generated/prisma/enums"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/submission-attempts")

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }

  const url = new URL(req.url)
  const rawStatus = url.searchParams.get("status")
  const status = rawStatus ? submissionAttemptStatusSchema.safeParse(rawStatus) : null
  if (status && !status.success) {
    return NextResponse.json(
      { error: "Unknown submission status filter.", code: "INVALID_INPUT" },
      { status: 400 }
    )
  }
  const limit = Number(url.searchParams.get("limit") ?? 20)
  const items = await listSubmissionAttempts(userId, {
    ...(url.searchParams.get("jobApplicationId")
      ? { jobApplicationId: url.searchParams.get("jobApplicationId")! }
      : {}),
    ...(status?.success ? { status: status.data as SubmissionAttemptStatus } : {}),
    limit: Number.isFinite(limit) ? limit : 20,
  })
  return NextResponse.json({ items })
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { error: "Cross-origin request refused", code: "FORBIDDEN" },
      { status: 403 }
    )
  }
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }
  if (
    !(await consumeRateLimit(
      RATE_LIMIT_BUCKETS.SUBMISSION_WRITE,
      userId,
      SUBMISSION_WRITE_RATE_LIMIT
    ))
  ) {
    return NextResponse.json(
      { error: "Too many submission updates. Try again shortly.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", code: "INVALID_BODY" },
      { status: 400 }
    )
  }
  const parsed = createSubmissionAttemptSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid submission request", code: "INVALID_INPUT" },
      { status: 400 }
    )
  }

  if (parsed.data.resumeId) {
    const resume = await prisma.resume.findFirst({
      where: { id: parsed.data.resumeId, userId, status: { not: "ARCHIVED" } },
      select: { id: true },
    })
    if (!resume) {
      return NextResponse.json(
        { error: "Resume not found.", code: "RESUME_NOT_FOUND" },
        { status: 404 }
      )
    }
  }

  try {
    const attempt = await stageSubmissionAttempt({
      userId,
      jobApplicationId: parsed.data.jobApplicationId,
      resumeId: parsed.data.resumeId,
      source: "MANUAL",
      evidence: parsed.data.evidence,
    })
    return NextResponse.json({ attempt }, { status: 201 })
  } catch (error) {
    if (error instanceof SubmissionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : 409 }
      )
    }
    log.error("Could not stage a submission", { err: error, userId })
    return NextResponse.json(
      { error: "Could not stage the submission.", code: "SUBMISSION_STAGE_FAILED" },
      { status: 500 }
    )
  }
}
