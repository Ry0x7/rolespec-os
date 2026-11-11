import { NextResponse } from "next/server"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import { createOutreachSequenceSchema } from "@/features/jobs/schemas/outreach-sequence.schema"
import {
  OutreachSequenceError,
  createOutreachSequence,
  listOutreachSequences,
} from "@/features/jobs/services/outreach-sequence.service"
import { OUTREACH_WRITE_RATE_LIMIT } from "@/features/settings/constants/data"
import type { OutreachSequenceStatus } from "@/generated/prisma/enums"
import { parseCalendarDate } from "@/shared/lib/dates"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/outreach/sequences")

export const dynamic = "force-dynamic"

const STATUSES: readonly OutreachSequenceStatus[] = [
  "DRAFT",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
]

export async function GET(req: Request) {
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
      { error: "Too many outreach requests. Try again shortly.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  const url = new URL(req.url)
  const rawStatus = url.searchParams.get("status")
  if (rawStatus && !STATUSES.includes(rawStatus as OutreachSequenceStatus)) {
    return NextResponse.json(
      { error: "Unknown outreach status filter.", code: "INVALID_INPUT" },
      { status: 400 }
    )
  }
  const rawLimit = Number(url.searchParams.get("limit") ?? 30)
  const sequences = await listOutreachSequences(userId, {
    ...(rawStatus ? { status: rawStatus as OutreachSequenceStatus } : {}),
    limit: Number.isFinite(rawLimit) ? rawLimit : 30,
  })

  return NextResponse.json(
    { sequences },
    { headers: { "Cache-Control": "private, no-store" } }
  )
}

export async function POST(req: Request) {
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
  const parsed = createOutreachSequenceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid outreach sequence",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  try {
    const sequence = await createOutreachSequence(userId, {
      name: parsed.data.name,
      ...(parsed.data.startOn
        ? { startOn: parseCalendarDate(parsed.data.startOn)! }
        : {}),
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      ...(parsed.data.contactId ? { contactId: parsed.data.contactId } : {}),
      ...(parsed.data.contact ? { contact: parsed.data.contact } : {}),
    })
    return NextResponse.json(
      { sequence },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    if (error instanceof OutreachSequenceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400 }
      )
    }
    log.error("Could not create an outreach sequence", { err: error, userId })
    return NextResponse.json(
      { error: "Could not create the outreach sequence.", code: "OUTREACH_CREATE_FAILED" },
      { status: 500 }
    )
  }
}
