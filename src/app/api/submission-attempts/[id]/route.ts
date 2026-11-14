import { NextResponse } from "next/server"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import { confirmSubmissionAttemptSchema } from "@/features/submissions/schemas/submission.schema"
import {
  SubmissionError,
  confirmSubmissionAttempt,
  getSubmissionAttempt,
} from "@/features/submissions/services/submission.service"
import { SUBMISSION_WRITE_RATE_LIMIT } from "@/features/settings/constants/data"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/submission-attempts/[id]")

export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }

  const { id } = await params
  const attempt = await getSubmissionAttempt(userId, id)
  if (!attempt) {
    return NextResponse.json(
      { error: "Submission attempt not found.", code: "NOT_FOUND" },
      { status: 404 }
    )
  }
  return NextResponse.json(
    { attempt },
    { headers: { "Cache-Control": "private, no-store" } }
  )
}

/**
 * The only endpoint that confirms a generic staged application. It records the
 * user's own statement; it never submits, and it cannot be used to downgrade an
 * already-confirmed submission.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const parsed = confirmSubmissionAttemptSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid confirmation",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  const { id } = await params
  try {
    const result = await confirmSubmissionAttempt(userId, id, {
      submitted: parsed.data.submitted,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    })
    return NextResponse.json(
      { ...result, submitted: parsed.data.submitted },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    if (error instanceof SubmissionError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "INVALID_INPUT"
            ? 400
            : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    log.error("Could not confirm a submission", { err: error, userId, attemptId: id })
    return NextResponse.json(
      { error: "Could not confirm the submission.", code: "SUBMISSION_CONFIRM_FAILED" },
      { status: 500 }
    )
  }
}
