import { NextResponse } from "next/server"

import { resolveApiUserId } from "@/features/auth/api-auth"
import { INTAKE_RUN_RATE_LIMIT } from "@/features/intake/constants/limits"
import { createIntakeRunSchema } from "@/features/intake/schemas/intake.schema"
import {
  createIntakeRun,
  getIntakeRun,
  listIntakeRuns,
} from "@/features/intake/services/intake-run.service"
import { scheduleIntakeRun } from "@/features/intake/services/schedule"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/intake")

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }
  const url = new URL(req.url)
  const limit = Number(url.searchParams.get("limit") ?? 10)
  const runs = await listIntakeRuns(userId, Number.isFinite(limit) ? limit : 10)
  return NextResponse.json({ runs })
}

/**
 * Creates one run with up to six source requests. The run starts after the
 * response is sent; the client follows `/api/intake/:id/stream`.
 */
export async function POST(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }

  if (!(await consumeRateLimit(RATE_LIMIT_BUCKETS.INTAKE_RUN, userId, INTAKE_RUN_RATE_LIMIT))) {
    return NextResponse.json(
      { error: "Too many intake runs. Please wait a few minutes.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body", code: "INVALID_BODY" }, { status: 400 })
  }

  const parsed = createIntakeRunSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid intake request",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  try {
    const runId = await createIntakeRun(
      userId,
      parsed.data.requests,
      parsed.data.idempotencyKey
    )
    const run = await getIntakeRun(userId, runId)
    await scheduleIntakeRun(runId)
    return NextResponse.json({ run }, { status: 202 })
  } catch (error) {
    log.error("Could not create intake run", { err: error })
    return NextResponse.json(
      { error: "Could not start intake. Please try again.", code: "INTAKE_FAILED" },
      { status: 500 }
    )
  }
}
