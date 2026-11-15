import { NextResponse } from "next/server"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import { outreachTouchActionSchema } from "@/features/jobs/schemas/outreach-sequence.schema"
import {
  OutreachSequenceError,
  completeOutreachTouch,
} from "@/features/jobs/services/outreach-sequence.service"
import { OUTREACH_WRITE_RATE_LIMIT } from "@/features/settings/constants/data"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/outreach/touches/[id]")

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
      RATE_LIMIT_BUCKETS.OUTREACH_WRITE,
      userId,
      OUTREACH_WRITE_RATE_LIMIT
    ))
  ) {
    return NextResponse.json(
      { error: "Too many outreach writes. Try again shortly.", code: "RATE_LIMITED" },
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
  const parsed = outreachTouchActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid touch action",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  const { id } = await params
  try {
    const sequence = await completeOutreachTouch(userId, id, parsed.data.action)
    return NextResponse.json(
      { sequence },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    if (error instanceof OutreachSequenceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : 409 }
      )
    }
    log.error("Could not complete an outreach touch", { err: error, userId, touchId: id })
    return NextResponse.json(
      { error: "Could not update the outreach touch.", code: "OUTREACH_UPDATE_FAILED" },
      { status: 500 }
    )
  }
}
