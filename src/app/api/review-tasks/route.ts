import { NextResponse } from "next/server"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import {
  createReviewTaskSchema,
  reviewTaskKindSchema,
  reviewTaskStatusSchema,
} from "@/features/workflows/schemas/workflow.schema"
import {
  WorkflowError,
  createStandaloneReviewTask,
  listReviewTasks,
} from "@/features/workflows/services/workflow.service"
import type { ReviewTaskKind } from "@/generated/prisma/enums"
import { WEB_REVIEW_TASK_RATE_LIMIT } from "@/features/settings/constants/data"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/review-tasks")

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }
  if (
    !(await consumeRateLimit(
      RATE_LIMIT_BUCKETS.WEB_REVIEW_TASKS,
      userId,
      WEB_REVIEW_TASK_RATE_LIMIT
    ))
  ) {
    return NextResponse.json(
      { error: "Too many review-queue requests. Try again shortly.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }
  const url = new URL(req.url)
  const status = reviewTaskStatusSchema.safeParse(
    url.searchParams.get("status") ?? "OPEN"
  )
  const rawKind = url.searchParams.get("kind")
  const kind = rawKind ? reviewTaskKindSchema.safeParse(rawKind) : null
  if (!status.success || (kind && !kind.success)) {
    return NextResponse.json(
      { error: "Unknown review status or kind filter.", code: "INVALID_INPUT" },
      { status: 400 }
    )
  }
  const limit = Number(url.searchParams.get("limit") ?? 20)
  const items = await listReviewTasks(userId, {
    status: status.data,
    kind: kind?.data as ReviewTaskKind | undefined,
    limit: Number.isFinite(limit) ? limit : 20,
  })
  return NextResponse.json({ items })
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request refused", code: "FORBIDDEN" }, { status: 403 })
  }
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }
  if (
    !(await consumeRateLimit(
      RATE_LIMIT_BUCKETS.WEB_REVIEW_TASKS,
      userId,
      WEB_REVIEW_TASK_RATE_LIMIT
    ))
  ) {
    return NextResponse.json(
      { error: "Too many review-queue requests. Try again shortly.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body", code: "INVALID_BODY" }, { status: 400 })
  }
  const parsed = createReviewTaskSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid review task",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  try {
    const task = await createStandaloneReviewTask(userId, {
      jobApplicationId: parsed.data.jobApplicationId,
      kind: parsed.data.kind,
      question: parsed.data.question,
      reason: parsed.data.reason,
      category: parsed.data.category,
      fallback: parsed.data.fallback,
      suggestedValue: parsed.data.suggestedValue as never,
    })
    return NextResponse.json({ task }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkflowError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : 400 }
      )
    }
    log.error("Could not create review task", { err: error, userId })
    return NextResponse.json(
      { error: "Could not create the review task.", code: "REVIEW_TASK_FAILED" },
      { status: 500 }
    )
  }
}
