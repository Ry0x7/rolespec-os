import { NextResponse } from "next/server"

import { resolveApiUserId } from "@/features/auth/api-auth"
import { INTAKE_CHAT_RATE_LIMIT } from "@/features/intake/constants/limits"
import { chatExtractionRequestSchema } from "@/features/intake/schemas/intake.schema"
import { extractChatFacts } from "@/features/intake/services/chat-extraction.service"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Preview only: returns proposed facts and the next useful question without
 * persisting anything. The client starts a real CHAT run once the user accepts
 * the transcript, so a discarded conversation leaves no rows.
 */
export async function POST(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }

  if (!(await consumeRateLimit(RATE_LIMIT_BUCKETS.INTAKE_CHAT, userId, INTAKE_CHAT_RATE_LIMIT))) {
    return NextResponse.json(
      { error: "Too many messages. Please wait a moment.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body", code: "INVALID_BODY" }, { status: 400 })
  }

  const parsed = chatExtractionRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid conversation",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  const result = await extractChatFacts({
    userId,
    transcript: parsed.data.transcript,
    missingFields: parsed.data.missingFields,
    useAi: parsed.data.useAi,
    source: "CHAT",
  })
  return NextResponse.json(result)
}
