import { NextResponse } from "next/server"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import {
  answerFromReviewTask,
  refreshAtsPreparationStatus,
} from "@/features/ats/services/ats-preparation.service"
import { resolveReviewTaskSchema } from "@/features/workflows/schemas/workflow.schema"
import { scheduleWorkflowTick } from "@/features/workflows/services/schedule"
import {
  WorkflowError,
  dismissReviewTask,
  getReviewTask,
  getReviewTaskRef,
  resolveReviewTask,
} from "@/features/workflows/services/workflow.service"
import { WEB_REVIEW_TASK_RATE_LIMIT } from "@/features/settings/constants/data"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/review-tasks")

export const dynamic = "force-dynamic"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const parsed = resolveReviewTaskSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid review action",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  const { id } = await params
  try {
    const task = await getReviewTaskRef(userId, id)
    if (!task) {
      return NextResponse.json(
        { error: "Review task not found.", code: "NOT_FOUND" },
        { status: 404 }
      )
    }

    let preparation = null
    if (task.atsPreparationId) {
      if (parsed.data.action === "RESOLVE") {
        preparation = await answerFromReviewTask(userId, id, {
          value: parsed.data.value,
          ...(parsed.data.scope ? { scope: parsed.data.scope } : {}),
        })
      }
    }

    const refreshed = await getReviewTaskRef(userId, id)
    const result =
      refreshed?.status === "OPEN"
        ? parsed.data.action === "RESOLVE"
          ? await resolveReviewTask(userId, id, parsed.data.value as never)
          : await dismissReviewTask(userId, id, parsed.data.reason)
        : {
            // The ATS branch resolved this task before the workflow service
            // saw it. Return the same full DTO shape, not a partial row.
            task: await getReviewTask(userId, id),
            run: null,
          }

    if (task.atsPreparationId) {
      preparation = await refreshAtsPreparationStatus(userId, task.atsPreparationId)
    }

    if (result.run?.state === "ASSISTED") await scheduleWorkflowTick()
    return NextResponse.json({ ...result, preparation })
  } catch (error) {
    if (error instanceof WorkflowError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : 409 }
      )
    }
    log.error("Review task action failed", { err: error, userId, reviewTaskId: id })
    return NextResponse.json(
      { error: "Could not update the review task.", code: "REVIEW_TASK_FAILED" },
      { status: 500 }
    )
  }
}
