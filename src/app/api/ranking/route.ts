import { NextResponse } from "next/server"

import { isSameOriginRequest, resolveApiUserId } from "@/features/auth/api-auth"
import { RANKING_RUN_RATE_LIMIT } from "@/features/ranking/constants/limits"
import { rankingRequestSchema } from "@/features/ranking/schemas/ranking.schema"
import { rankSavedJobs } from "@/features/ranking/services/job-ranking.service"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/ranking")

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * `POST /api/ranking`
 *
 * Ranks the caller's saved jobs. Deterministic by default; `rerank: true` adds
 * the optional, grounded LLM pass over the shortlist. The response always says
 * what was excluded and why, and a rerank failure is a warning rather than a
 * failed request.
 */
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

  if (!(await consumeRateLimit(RATE_LIMIT_BUCKETS.RANKING_RUN, userId, RANKING_RUN_RATE_LIMIT))) {
    return NextResponse.json(
      { error: "Too many ranking requests. Please wait a few minutes.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body", code: "INVALID_BODY" }, { status: 400 })
  }

  const parsed = rankingRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid ranking request",
        code: "INVALID_INPUT",
      },
      { status: 400 }
    )
  }

  try {
    const ranked = await rankSavedJobs({ userId, ...parsed.data })
    return NextResponse.json({
      ...ranked.result,
      reranked: ranked.reranked,
      warnings: ranked.warnings,
      poolSize: ranked.poolSize,
    })
  } catch (error) {
    log.error("Ranking failed", { err: error, userId })
    return NextResponse.json(
      { error: "Could not rank your saved jobs. Please try again.", code: "RANKING_FAILED" },
      { status: 500 }
    )
  }
}
