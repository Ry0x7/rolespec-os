import { NextResponse } from "next/server"

import {
  extensionCorsHeaders,
  extensionOptions,
  extensionUserId,
  rateLimited,
  unauthorized,
} from "@/features/ats/lib/extension-http"
import {
  approveAtsAnswerSchema,
  revokeAtsAnswerSchema,
} from "@/features/ats/schemas/ats.schema"
import {
  AtsError,
  approveAtsAnswer,
  listAtsAnswers,
  revokeAtsAnswer,
} from "@/features/ats/services/ats-preparation.service"
import { EXTENSION_ATS_ANSWERS_RATE_LIMIT } from "@/features/settings/constants/data"
import { logger } from "@/shared/lib/logger"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

const log = logger("extension-ats-answers")

export const dynamic = "force-dynamic"

function cors(req: Request): Record<string, string> {
  return extensionCorsHeaders(req.headers.get("origin"))
}

function failure(
  error: unknown,
  headers: Record<string, string>,
  userId: string
): NextResponse {
  if (error instanceof AtsError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) },
      {
        status:
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "CONFLICT"
              ? 409
              : 400,
        headers,
      }
    )
  }
  log.error("ATS answer action failed", { err: error, userId })
  return NextResponse.json(
    { error: "Could not update the approved answer.", code: "SERVER_ERROR" },
    { status: 500, headers }
  )
}

export async function OPTIONS(req: Request) {
  return extensionOptions(req)
}

export async function GET(req: Request) {
  const headers = cors(req)
  const userId = await extensionUserId(req)
  if (!userId) return unauthorized(headers)

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_ATS_ANSWERS,
    userId,
    EXTENSION_ATS_ANSWERS_RATE_LIMIT
  )
  if (!allowed) return rateLimited(headers)

  const url = new URL(req.url)
  const preparationId = url.searchParams.get("preparationId") ?? undefined
  const questionKey = url.searchParams.get("questionKey") ?? undefined
  try {
    const answers = await listAtsAnswers(userId, {
      ...(preparationId ? { preparationId } : {}),
      ...(questionKey ? { questionKey } : {}),
    })
    return NextResponse.json({ answers }, { headers })
  } catch (error) {
    return failure(error, headers, userId)
  }
}

export async function POST(req: Request) {
  const headers = cors(req)
  const userId = await extensionUserId(req)
  if (!userId) return unauthorized(headers)

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_ATS_ANSWERS,
    userId,
    EXTENSION_ATS_ANSWERS_RATE_LIMIT
  )
  if (!allowed) return rateLimited(headers)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON", code: "VALIDATION" },
      { status: 400, headers }
    )
  }
  const parsed = approveAtsAnswerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid approved answer",
        code: "VALIDATION",
      },
      { status: 400, headers }
    )
  }

  try {
    const result = await approveAtsAnswer(userId, parsed.data)
    return NextResponse.json(result, { status: 201, headers })
  } catch (error) {
    return failure(error, headers, userId)
  }
}

export async function DELETE(req: Request) {
  const headers = cors(req)
  const userId = await extensionUserId(req)
  if (!userId) return unauthorized(headers)

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_ATS_ANSWERS,
    userId,
    EXTENSION_ATS_ANSWERS_RATE_LIMIT
  )
  if (!allowed) return rateLimited(headers)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON", code: "VALIDATION" },
      { status: 400, headers }
    )
  }
  const parsed = revokeAtsAnswerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "An answer id is required",
        code: "VALIDATION",
      },
      { status: 400, headers }
    )
  }

  try {
    const result = await revokeAtsAnswer(userId, parsed.data.id)
    return NextResponse.json(result, { headers })
  } catch (error) {
    return failure(error, headers, userId)
  }
}
