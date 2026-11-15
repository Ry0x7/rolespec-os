import { NextResponse } from "next/server"
import { z } from "zod"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import { AI_STAGE_SETTINGS_WRITE_RATE_LIMIT } from "@/features/settings/constants/data"
import {
  clearUserAiStageSetting,
  listUserAiStageSettings,
  saveUserAiStageSetting,
} from "@/features/settings/services/user-ai-stage-settings.service"
import { AI_STAGE_VALUES, isAiStage } from "@/shared/lib/ai-stages"
import { USER_AI_PROVIDERS } from "@/shared/lib/ai-providers/constants"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/settings/ai-stages")

export const dynamic = "force-dynamic"

const saveSchema = z.object({
  stage: z.enum(AI_STAGE_VALUES),
  provider: z.enum(USER_AI_PROVIDERS),
  model: z.string().trim().max(200).optional(),
  apiKey: z.string().max(500).optional(),
  clearApiKey: z.boolean().optional(),
})

async function guard(req: Request) {
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
      RATE_LIMIT_BUCKETS.AI_STAGE_SETTINGS_WRITE,
      userId,
      AI_STAGE_SETTINGS_WRITE_RATE_LIMIT
    ))
  ) {
    return NextResponse.json(
      { error: "Too many AI settings changes. Try again shortly.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }
  return { userId }
}

export async function GET(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }
  const items = await listUserAiStageSettings(userId)
  return NextResponse.json(
    { items, availableStages: AI_STAGE_VALUES },
    { headers: { "Cache-Control": "private, no-store" } }
  )
}

export async function PUT(req: Request) {
  const guardResult = await guard(req)
  if (guardResult instanceof NextResponse) return guardResult
  const { userId } = guardResult

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", code: "INVALID_BODY" },
      { status: 400 }
    )
  }
  const parsed = saveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid stage setting",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  const submittedKey = parsed.data.apiKey?.trim() ?? ""
  const apiKey =
    submittedKey.length > 0
      ? submittedKey
      : parsed.data.clearApiKey
        ? null
        : undefined

  try {
    const item = await saveUserAiStageSetting(userId, {
      stage: parsed.data.stage,
      provider: parsed.data.provider,
      model: parsed.data.model ?? null,
      apiKey,
    })
    return NextResponse.json(
      { item },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    // Never log the submitted key, even indirectly through an error object.
    log.error("Saving a per-stage AI setting failed", {
      userId,
      stage: parsed.data.stage,
      provider: parsed.data.provider,
      failed: error instanceof Error ? error.name : "unknown",
    })
    return NextResponse.json(
      { error: "Could not save the stage setting.", code: "AI_STAGE_SAVE_FAILED" },
      { status: 500 }
    )
  }
}

export async function DELETE(req: Request) {
  const guardResult = await guard(req)
  if (guardResult instanceof NextResponse) return guardResult
  const { userId } = guardResult

  const stage = new URL(req.url).searchParams.get("stage")
  if (!stage || !isAiStage(stage)) {
    return NextResponse.json(
      { error: "Unknown or missing stage.", code: "INVALID_INPUT" },
      { status: 400 }
    )
  }
  const removed = await clearUserAiStageSetting(userId, stage)
  if (!removed) {
    return NextResponse.json(
      { error: "Stage setting not found.", code: "NOT_FOUND" },
      { status: 404 }
    )
  }
  return NextResponse.json({ removed: true })
}
