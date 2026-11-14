import { NextResponse } from "next/server"

import {
  extensionCorsHeaders,
  extensionOptions,
  extensionUserId,
  rateLimited,
  unauthorized,
} from "@/features/ats/lib/extension-http"
import { reviewTaskKindSchema, reviewTaskStatusSchema } from "@/features/workflows/schemas/workflow.schema"
import { listReviewTasks } from "@/features/workflows/services/workflow.service"
import { EXTENSION_ATS_REVIEW_RATE_LIMIT } from "@/features/settings/constants/data"
import { logger } from "@/shared/lib/logger"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"
import type { ReviewTaskKind } from "@/generated/prisma/enums"

const log = logger("extension-review-tasks")

export const dynamic = "force-dynamic"

export async function OPTIONS(req: Request) {
  return extensionOptions(req, "GET, OPTIONS")
}

export async function GET(req: Request) {
  const cors = extensionCorsHeaders(req.headers.get("origin"), "GET, OPTIONS")
  const userId = await extensionUserId(req)
  if (!userId) return unauthorized(cors)

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_ATS_REVIEW,
    userId,
    EXTENSION_ATS_REVIEW_RATE_LIMIT
  )
  if (!allowed) return rateLimited(cors)

  const url = new URL(req.url)
  const status = reviewTaskStatusSchema.safeParse(
    url.searchParams.get("status") ?? "OPEN"
  )
  const rawKind = url.searchParams.get("kind")
  const kind = rawKind ? reviewTaskKindSchema.safeParse(rawKind) : null
  if (!status.success || (kind && !kind.success)) {
    return NextResponse.json(
      { error: "Unknown review status or kind filter.", code: "VALIDATION" },
      { status: 400, headers: cors }
    )
  }
  const limit = Number(url.searchParams.get("limit") ?? 50)

  try {
    const items = await listReviewTasks(userId, {
      status: status.data,
      ...(kind?.success ? { kind: kind.data as ReviewTaskKind } : {}),
      limit: Number.isFinite(limit) ? limit : 50,
    })
    return NextResponse.json({ items }, { headers: cors })
  } catch (error) {
    log.error("Listing review tasks for the extension failed", { err: error, userId })
    return NextResponse.json(
      { error: "Could not load the review queue.", code: "SERVER_ERROR" },
      { status: 500, headers: cors }
    )
  }
}
