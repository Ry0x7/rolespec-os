import { NextResponse } from "next/server"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import { WORKFLOW_CREATE_RATE_LIMIT } from "@/features/workflows/constants/limits"
import {
  createWorkflowSchema,
  workflowKindSchema,
  workflowStateSchema,
} from "@/features/workflows/schemas/workflow.schema"
import {
  WorkflowError,
  createWorkflow,
  listWorkflows,
} from "@/features/workflows/services/workflow.service"
import type { WorkflowKind, WorkflowState } from "@/generated/prisma/enums"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/workflows")

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }

  const url = new URL(req.url)
  const rawState = url.searchParams.get("state")
  const rawKind = url.searchParams.get("kind")
  const state = rawState ? workflowStateSchema.safeParse(rawState) : null
  const kind = rawKind ? workflowKindSchema.safeParse(rawKind) : null
  if ((state && !state.success) || (kind && !kind.success)) {
    return NextResponse.json(
      { error: "Unknown workflow state or kind filter.", code: "INVALID_INPUT" },
      { status: 400 }
    )
  }
  const limit = Number(url.searchParams.get("limit") ?? 20)
  const items = await listWorkflows(userId, {
    state: state?.data as WorkflowState | undefined,
    kind: kind?.data as WorkflowKind | undefined,
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

  if (!(await consumeRateLimit(RATE_LIMIT_BUCKETS.WORKFLOW_CREATE, userId, WORKFLOW_CREATE_RATE_LIMIT))) {
    return NextResponse.json(
      { error: "Too many workflow runs. Please wait a few minutes.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body", code: "INVALID_BODY" }, { status: 400 })
  }
  const parsed = createWorkflowSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid workflow request",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  try {
    const workflow = await createWorkflow(userId, {
      jobApplicationId: parsed.data.jobApplicationId,
      mode: parsed.data.mode,
      kind: parsed.data.kind,
      idempotencyKey: parsed.data.idempotencyKey,
      runInput: parsed.data.input,
    })
    return NextResponse.json({ workflow }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkflowError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        {
          status:
            error.code === "NOT_FOUND"
              ? 404
              : error.code === "CONFLICT"
                ? 409
                : 400,
        }
      )
    }
    log.error("Could not create workflow", { err: error, userId })
    return NextResponse.json(
      { error: "Could not create the workflow. Please try again.", code: "WORKFLOW_CREATE_FAILED" },
      { status: 500 }
    )
  }
}
