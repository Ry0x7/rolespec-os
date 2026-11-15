import { NextResponse } from "next/server"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import { closeFollowUpTaskSchema } from "@/features/jobs/schemas/follow-up-task.schema"
import {
  FollowUpTaskError,
  completeFollowUpTask,
} from "@/features/jobs/services/follow-up-task.service"
import { FOLLOW_UP_WRITE_RATE_LIMIT } from "@/features/settings/constants/data"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/follow-ups/[id]")

export const dynamic = "force-dynamic"

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
      RATE_LIMIT_BUCKETS.FOLLOW_UP_WRITE,
      userId,
      FOLLOW_UP_WRITE_RATE_LIMIT
    ))
  ) {
    return NextResponse.json(
      { error: "Too many follow-up updates. Try again shortly.", code: "RATE_LIMITED" },
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
  const parsed = closeFollowUpTaskSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid follow-up action",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  const { id } = await params
  try {
    const task = await completeFollowUpTask(
      userId,
      id,
      parsed.data.action === "DONE" ? "DONE" : "DISMISSED"
    )
    if (!task) {
      return NextResponse.json(
        { error: "Follow-up task not found.", code: "NOT_FOUND" },
        { status: 404 }
      )
    }
    return NextResponse.json(
      { task },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    if (error instanceof FollowUpTaskError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : 409 }
      )
    }
    log.error("Could not close a follow-up task", { err: error, userId, taskId: id })
    return NextResponse.json(
      { error: "Could not update the follow-up.", code: "FOLLOW_UP_UPDATE_FAILED" },
      { status: 500 }
    )
  }
}
