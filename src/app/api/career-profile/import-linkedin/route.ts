import { NextResponse } from "next/server"

import { auth } from "@/features/auth/config"
import {
  extractCareerFacts,
  persistCareerImport,
} from "@/features/career-profile/services/import-linkedin.service"
import { readLinkedinPdfUpload } from "@/features/linkedin/services/linkedin-upload"
import { CAREER_IMPORT_RATE_LIMIT } from "@/features/settings/constants/data"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("career-profile")

/**
 * PDF extract → a blocking `extractCareerFacts` model call. Same shape and same
 * reasoning as the 60s on the LinkedIn rating route.
 */
export const maxDuration = 60

export async function POST(req: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    )
  }

  const userId = session.user.id

  // ── File validation, rate limit (max 5 per 10 min), then text extraction ──
  // The limit is consumed inside the upload read, before the PDF is parsed, so
  // a throttled caller never pays for extraction and a bad PDF costs nothing.
  const upload = await readLinkedinPdfUpload(req, {
    isLimited: async () =>
      !(await consumeRateLimit(
        RATE_LIMIT_BUCKETS.CAREER_IMPORT,
        userId,
        CAREER_IMPORT_RATE_LIMIT
      )),
    error: "Too many imports. Please wait a few minutes and try again.",
  })

  if (!upload.ok) {
    return NextResponse.json(
      { error: upload.error, code: upload.code },
      { status: upload.status }
    )
  }

  // ── Extract ──────────────────────────────────────────────────────────────
  let extracted
  try {
    extracted = await extractCareerFacts(upload.text, userId)
  } catch (err) {
    log.error("LinkedIn career import extraction failed", { err })
    // "Add your API key…" is actionable and safe to show; anything else could
    // carry provider/infra detail, so it stays in the log above.
    if (err instanceof AiKeyRequiredError) {
      return NextResponse.json(
        { error: err.message, code: "AI_KEY_REQUIRED" },
        { status: 400 }
      )
    }
    if (err instanceof AiDailyLimitError) {
      return NextResponse.json(
        { error: err.message, code: "AI_DAILY_LIMIT" },
        { status: 429 }
      )
    }
    return NextResponse.json(
      { error: "Import failed. Please try again.", code: "IMPORT_FAILED" },
      { status: 500 }
    )
  }

  // ── Persist as candidates ────────────────────────────────────────────────
  try {
    const counts = await persistCareerImport(userId, extracted)
    // No `revalidatePath` here: no other route handler in this app invalidates
    // the router cache, and the caller refreshes with `router.refresh()`.
    return NextResponse.json({ data: counts }, { status: 200 })
  } catch (err) {
    log.error("persisting LinkedIn career import failed", { err })
    return NextResponse.json(
      { error: "Import failed. Please try again.", code: "IMPORT_FAILED" },
      { status: 500 }
    )
  }
}
