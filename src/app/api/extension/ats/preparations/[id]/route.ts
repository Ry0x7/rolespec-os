import { NextResponse } from "next/server"

import {
  extensionCorsHeaders,
  extensionOptions,
  extensionUserId,
  rateLimited,
  unauthorized,
} from "@/features/ats/lib/extension-http"
import { updateAtsPreparationSchema } from "@/features/ats/schemas/ats.schema"
import {
  AtsError,
  abandonAtsPreparation,
  attachAtsResume,
  confirmAtsSubmission,
  getAtsPreparation,
  recordAtsResults,
} from "@/features/ats/services/ats-preparation.service"
import { EXTENSION_ATS_PREPARE_RATE_LIMIT } from "@/features/settings/constants/data"
import { logger } from "@/shared/lib/logger"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

const log = logger("extension-ats-preparation")

export const dynamic = "force-dynamic"

function errorResponse(
  error: unknown,
  cors: Record<string, string>,
  userId: string,
  id: string
): NextResponse {
  if (error instanceof AtsError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      {
        status:
          error.code === "NOT_FOUND" ||
          error.code === "RESUME_NOT_FOUND" ||
          error.code === "APPLICATION_NOT_FOUND"
            ? 404
            : error.code === "CONFLICT"
              ? 409
              : error.code === "TERMINAL"
                ? 409
                : 400,
        headers: cors,
      }
    )
  }
  log.error("ATS preparation action failed", { err: error, userId, preparationId: id })
  return NextResponse.json(
    { error: "Could not update this application preparation.", code: "SERVER_ERROR" },
    { status: 500, headers: cors }
  )
}

export async function OPTIONS(req: Request) {
  return extensionOptions(req, "GET, PATCH, OPTIONS")
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const cors = extensionCorsHeaders(req.headers.get("origin"), "GET, PATCH, OPTIONS")
  const userId = await extensionUserId(req)
  if (!userId) return unauthorized(cors)

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_ATS_PREPARE,
    userId,
    EXTENSION_ATS_PREPARE_RATE_LIMIT
  )
  if (!allowed) return rateLimited(cors)

  const { id } = await params
  try {
    return NextResponse.json(
      { preparation: await getAtsPreparation(userId, id) },
      { headers: cors }
    )
  } catch (error) {
    return errorResponse(error, cors, userId, id)
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const cors = extensionCorsHeaders(req.headers.get("origin"), "GET, PATCH, OPTIONS")
  const userId = await extensionUserId(req)
  if (!userId) return unauthorized(cors)

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_ATS_PREPARE,
    userId,
    EXTENSION_ATS_PREPARE_RATE_LIMIT
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

  const parsed = updateAtsPreparationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid ATS preparation action",
        code: "VALIDATION",
      },
      { status: 400, headers: cors }
    )
  }

  const { id } = await params
  try {
    switch (parsed.data.action) {
      case "RECORD_RESULTS": {
        const preparation = await recordAtsResults(userId, id, parsed.data.results)
        return NextResponse.json({ preparation }, { headers: cors })
      }
      case "ATTACH_RESUME": {
        const preparation = await attachAtsResume(userId, id, parsed.data.resumeId)
        return NextResponse.json({ preparation }, { headers: cors })
      }
      case "CONFIRM_SUBMISSION": {
        const result = await confirmAtsSubmission(userId, id, {
          submitted: parsed.data.submitted,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
        })
        return NextResponse.json(result, { headers: cors })
      }
      case "ABANDON": {
        const preparation = await abandonAtsPreparation(userId, id)
        return NextResponse.json({ preparation }, { headers: cors })
      }
    }
  } catch (error) {
    return errorResponse(error, cors, userId, id)
  }
}
