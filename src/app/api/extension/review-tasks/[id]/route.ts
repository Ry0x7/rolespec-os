import { NextResponse } from "next/server"

import {
  extensionCorsHeaders,
  extensionOptions,
  extensionUserId,
  rateLimited,
  unauthorized,
} from "@/features/ats/lib/extension-http"
import { extensionReviewActionSchema } from "@/features/ats/schemas/ats.schema"
import {
  AtsError,
  answerFromReviewTask,
  attachAtsResume,
  refreshAtsPreparationStatus,
} from "@/features/ats/services/ats-preparation.service"
import { EXTENSION_ATS_REVIEW_RATE_LIMIT } from "@/features/settings/constants/data"
import { scheduleWorkflowTick } from "@/features/workflows/services/schedule"
import {
  WorkflowError,
  dismissReviewTask,
  resolveReviewTask,
} from "@/features/workflows/services/workflow.service"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

const log = logger("extension-review-task")

export const dynamic = "force-dynamic"

export async function OPTIONS(req: Request) {
  return extensionOptions(req, "PATCH, OPTIONS")
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const cors = extensionCorsHeaders(req.headers.get("origin"), "PATCH, OPTIONS")
  const userId = await extensionUserId(req)
  if (!userId) return unauthorized(cors)

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_ATS_REVIEW,
    userId,
    EXTENSION_ATS_REVIEW_RATE_LIMIT
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
  const parsed = extensionReviewActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid review action",
        code: "VALIDATION",
      },
      { status: 400, headers: cors }
    )
  }

  const { id } = await params
  const task = await prisma.reviewTask.findFirst({
    where: { id, userId },
    select: {
      id: true,
      kind: true,
      question: true,
      atsPreparationId: true,
      status: true,
    },
  })
  if (!task) {
    return NextResponse.json(
      { error: "Review task not found.", code: "NOT_FOUND" },
      { status: 404, headers: cors }
    )
  }
  if (task.status !== "OPEN") {
    return NextResponse.json(
      { error: "That review task is no longer open.", code: "TASK_NOT_OPEN" },
      { status: 409, headers: cors }
    )
  }

  try {
    if (parsed.data.action === "ATTACH_RESUME") {
      if (!task.atsPreparationId) {
        return NextResponse.json(
          {
            error: "This review task is not attached to an ATS preparation.",
            code: "VALIDATION",
          },
          { status: 400, headers: cors }
        )
      }
      const preparation = await attachAtsResume(
        userId,
        task.atsPreparationId,
        parsed.data.resumeId
      )
      const updated = await prisma.reviewTask.findFirst({
        where: { id, userId },
        select: { id: true, status: true, kind: true, question: true },
      })
      return NextResponse.json(
        { task: updated, preparation, answerRecorded: false },
        { headers: cors }
      )
    }

    if (parsed.data.action === "DISMISS") {
      const result = await dismissReviewTask(userId, id, parsed.data.reason)
      const preparation = task.atsPreparationId
        ? await refreshAtsPreparationStatus(userId, task.atsPreparationId)
        : null
      return NextResponse.json({ ...result, preparation }, { headers: cors })
    }

    let preparation = null
    let answerRecorded = false
    if (task.atsPreparationId) {
      preparation = await answerFromReviewTask(userId, id, {
        value: parsed.data.value,
        ...(parsed.data.scope ? { scope: parsed.data.scope } : {}),
      })
      const refreshed = await prisma.reviewTask.findFirst({
        where: { id, userId },
        select: { status: true },
      })
      answerRecorded = refreshed?.status === "RESOLVED"
    }

    // A task whose question did not match an ATS plan entry still resolves
    // through the ordinary workflow path; a blocked field never blocks the queue.
    const result = answerRecorded
      ? {
          task: await prisma.reviewTask.findFirst({
            where: { id, userId },
            select: {
              id: true,
              status: true,
              kind: true,
              question: true,
              answer: true,
              resolvedAt: true,
            },
          }),
          run: null,
        }
      : await resolveReviewTask(userId, id, parsed.data.value as never)

    if (result.run?.state === "ASSISTED") await scheduleWorkflowTick()
    if (task.atsPreparationId && !answerRecorded) {
      preparation = await refreshAtsPreparationStatus(userId, task.atsPreparationId)
    }

    return NextResponse.json(
      { ...result, preparation, answerRecorded },
      { headers: cors }
    )
  } catch (error) {
    if (error instanceof WorkflowError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : 409, headers: cors }
      )
    }
    if (error instanceof AtsError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        {
          status:
            error.code === "NOT_FOUND" || error.code === "RESUME_NOT_FOUND"
              ? 404
              : error.code === "CONFLICT" || error.code === "TERMINAL"
                ? 409
                : 400,
          headers: cors,
        }
      )
    }
    log.error("Review task action failed", { err: error, userId, reviewTaskId: id })
    return NextResponse.json(
      { error: "Could not update the review task.", code: "SERVER_ERROR" },
      { status: 500, headers: cors }
    )
  }
}
