import { NextResponse } from "next/server"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import { WORKFLOW_ADVANCE_RATE_LIMIT } from "@/features/workflows/constants/limits"
import { advanceWorkflowSchema } from "@/features/workflows/schemas/workflow.schema"
import { scheduleWorkflowTick } from "@/features/workflows/services/schedule"
import {
  WorkflowError,
  cancelWorkflow,
  completeManualStep,
  getWorkflow,
  pauseWorkflow,
  resumeWorkflow,
  retryWorkflow,
  startWorkflow,
} from "@/features/workflows/services/workflow.service"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/workflows/advance")

export const dynamic = "force-dynamic"

export async function POST(
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
  if (!(await consumeRateLimit(RATE_LIMIT_BUCKETS.WORKFLOW_ADVANCE, userId, WORKFLOW_ADVANCE_RATE_LIMIT))) {
    return NextResponse.json(
      { error: "Too many workflow actions. Please slow down.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body", code: "INVALID_BODY" }, { status: 400 })
  }
  const parsed = advanceWorkflowSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid workflow action",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  const { id } = await params
  const { action, stepName } = parsed.data

  try {
    if (action === "START") {
      const workflow = await startWorkflow(userId, id)
      if (workflow.mode === "AGENT_ASSISTED") await scheduleWorkflowTick()
      return NextResponse.json({ workflow }, { status: 202 })
    }
    if (action === "RESUME") {
      const workflow = await resumeWorkflow(userId, id)
      if (workflow.mode === "AGENT_ASSISTED") await scheduleWorkflowTick()
      return NextResponse.json({ workflow }, { status: 202 })
    }
    if (action === "RETRY") {
      const workflow = await retryWorkflow(userId, id)
      await scheduleWorkflowTick()
      return NextResponse.json({ workflow }, { status: 202 })
    }
    if (action === "PAUSE") {
      return NextResponse.json({ workflow: await pauseWorkflow(userId, id) })
    }
    if (action === "CANCEL") {
      return NextResponse.json({ workflow: await cancelWorkflow(userId, id) })
    }
    const workflow = await completeManualStep(userId, id, stepName!)
    return NextResponse.json({ workflow })
  } catch (error) {
    if (error instanceof WorkflowError) {
      const state = await getWorkflow(userId, id).then((run) => run?.state).catch(() => undefined)
      return NextResponse.json(
        { error: error.message, code: error.code, ...(state ? { state } : {}) },
        { status: error.code === "NOT_FOUND" ? 404 : 409 }
      )
    }
    log.error("Workflow action failed", { err: error, userId, workflowId: id, action })
    return NextResponse.json(
      { error: "Could not update the workflow. Please try again.", code: "WORKFLOW_ACTION_FAILED" },
      { status: 500 }
    )
  }
}
