import { NextResponse } from "next/server"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import { outreachSequenceActionSchema } from "@/features/jobs/schemas/outreach-sequence.schema"
import {
  OutreachSequenceError,
  activateOutreachSequence,
  cancelOutreachSequence,
  getOutreachSequence,
} from "@/features/jobs/services/outreach-sequence.service"
import { OUTREACH_WRITE_RATE_LIMIT } from "@/features/settings/constants/data"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/outreach/sequences/[id]")

export const dynamic = "force-dynamic"

function errorResponse(error: unknown, userId: string, id: string) {
  if (error instanceof OutreachSequenceError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400 }
    )
  }
  log.error("Could not update an outreach sequence", { err: error, userId, sequenceId: id })
  return NextResponse.json(
    { error: "Could not update the outreach sequence.", code: "OUTREACH_UPDATE_FAILED" },
    { status: 500 }
  )
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }
  const { id } = await params
  const sequence = await getOutreachSequence(userId, id)
  if (!sequence) {
    return NextResponse.json(
      { error: "Outreach sequence not found.", code: "NOT_FOUND" },
      { status: 404 }
    )
  }
  return NextResponse.json(
    { sequence },
    { headers: { "Cache-Control": "private, no-store" } }
  )
}

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
  const parsed = outreachSequenceActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid outreach action",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  const { id } = await params
  try {
    const sequence =
      parsed.data.action === "ACTIVATE"
        ? await activateOutreachSequence(userId, id)
        : await cancelOutreachSequence(userId, id)
    return NextResponse.json(
      { sequence },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error, userId, id)
  }
}
