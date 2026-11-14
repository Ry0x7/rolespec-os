import { NextResponse } from "next/server"

import {
  extensionCorsHeaders,
  extensionOptions,
  extensionUserId,
  rateLimited,
  unauthorized,
} from "@/features/ats/lib/extension-http"
import { createAtsPreparationSchema } from "@/features/ats/schemas/ats.schema"
import {
  AtsError,
  createAtsPreparation,
  listAtsPreparations,
  recordAtsResults,
} from "@/features/ats/services/ats-preparation.service"
import { EXTENSION_ATS_PREPARE_RATE_LIMIT } from "@/features/settings/constants/data"
import { logger } from "@/shared/lib/logger"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

const log = logger("extension-ats-preparations")

export const dynamic = "force-dynamic"

export async function OPTIONS(req: Request) {
  return extensionOptions(req)
}

export async function GET(req: Request) {
  const cors = extensionCorsHeaders(req.headers.get("origin"))
  const userId = await extensionUserId(req)
  if (!userId) return unauthorized(cors)

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_ATS_PREPARE,
    userId,
    EXTENSION_ATS_PREPARE_RATE_LIMIT
  )
  if (!allowed) return rateLimited(cors)

  const url = new URL(req.url)
  const jobApplicationId = url.searchParams.get("jobApplicationId") ?? undefined
  const limit = Number(url.searchParams.get("limit") ?? 20)

  try {
    const preparations = await listAtsPreparations(userId, {
      ...(jobApplicationId ? { jobApplicationId } : {}),
      limit: Number.isFinite(limit) ? limit : 20,
    })
    return NextResponse.json({ preparations }, { headers: cors })
  } catch (error) {
    log.error("Listing ATS preparations failed", { err: error, userId })
    return NextResponse.json(
      { error: "Could not load ATS preparations.", code: "SERVER_ERROR" },
      { status: 500, headers: cors }
    )
  }
}

export async function POST(req: Request) {
  const cors = extensionCorsHeaders(req.headers.get("origin"))
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

  const parsed = createAtsPreparationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid ATS preparation",
        code: "VALIDATION",
      },
      { status: 400, headers: cors }
    )
  }

  try {
    const result = await createAtsPreparation(userId, parsed.data)
    const preparation =
      parsed.data.results && parsed.data.results.length > 0
        ? await recordAtsResults(
            userId,
            result.preparation.id,
            parsed.data.results
          )
        : result.preparation

    log.info("ATS preparation saved", {
      userId,
      preparationId: preparation.id,
      vendor: preparation.vendor,
      created: result.created,
      fields: preparation.fieldsDetected,
      blocked: preparation.fieldsBlocked,
    })

    return NextResponse.json(
      {
        preparation,
        approvedAnswers: result.approvedAnswers,
        created: result.created,
      },
      { status: result.created ? 201 : 200, headers: cors }
    )
  } catch (error) {
    if (error instanceof AtsError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        {
          status:
            error.code === "NOT_FOUND" ||
            error.code === "APPLICATION_NOT_FOUND" ||
            error.code === "RESUME_NOT_FOUND"
              ? 404
              : error.code === "CONFLICT"
                ? 409
                : 400,
          headers: cors,
        }
      )
    }
    log.error("Creating ATS preparation failed", { err: error, userId })
    return NextResponse.json(
      { error: "Could not prepare this application.", code: "SERVER_ERROR" },
      { status: 500, headers: cors }
    )
  }
}
