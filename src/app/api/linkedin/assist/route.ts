import { NextResponse } from "next/server"

import { auth } from "@/features/auth/config"
import {
  generateLinkedinSuggestions,
  type LinkedinAssistRatingContext,
} from "@/features/linkedin/services/linkedin-assist"
import { getLatestProfileRating } from "@/shared/lib/rating/rating.service"
import { readLinkedinPdfUpload } from "@/features/linkedin/services/linkedin-upload"
import {
  isLinkedinAssistRateLimited,
  persistLinkedinSuggestions,
} from "@/features/linkedin/services/linkedin.service"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { rateLimited } from "@/shared/lib/errors"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"
import { logger } from "@/shared/lib/logger"

const log = logger("linkedin")

/** Sliding window for the shared LinkedIn AI bucket (rating + assist). */
const LINKEDIN_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }

/**
 * PDF extract → rating lookup → a blocking `generateText` call. Nothing here
 * streams, so the whole latency has to fit inside the function timeout. 60s is
 * the ceiling on Vercel's Hobby plan without Fluid compute; with Fluid compute
 * enabled this can go to 300.
 */
export const maxDuration = 60

export async function POST(req: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    )
  }

  const userId = session.user.id

  // ── File validation, rate limit (max 5 per 10 min), then text extraction ──
  // Everything here happens before charging — a bad PDF costs the user nothing.
  const upload = await readLinkedinPdfUpload(req, {
    isLimited: () => isLinkedinAssistRateLimited(userId),
    error: "Too many suggestion runs. Please wait a few minutes and try again.",
  })

  if (!upload.ok) {
    return NextResponse.json(
      { error: upload.error, code: upload.code },
      { status: upload.status }
    )
  }

  // ── Shared LinkedIn AI cap: 10 calls per user per 10 minutes ─────────────
  // Sits alongside the artifact-row limit above and also covers /rating, so a
  // user cannot alternate between the two endpoints to double their spend.
  const linkedinAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.AI_LINKEDIN,
    userId,
    LINKEDIN_RATE_LIMIT
  )
  if (!linkedinAllowed) {
    const err = rateLimited(
      "Too many LinkedIn AI runs. Please wait a few minutes and try again."
    )
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status }
    )
  }

  // ── Latest audit, so the rewrite targets what the rating marked weak ─────
  // Best effort: a missing rating (or a failed lookup) just means no context.
  let ratingContext: LinkedinAssistRatingContext | undefined
  try {
    const rating = await getLatestProfileRating(userId, "LINKEDIN")
    if (rating) {
      ratingContext = {
        overallScore: rating.overallScore,
        // LINKEDIN ratings always persist the five-category score object.
        scores: rating.scores as LinkedinAssistRatingContext["scores"],
        issues: rating.issues,
      }
    }
  } catch (err) {
    log.error("loading the latest LinkedIn rating failed", { err })
  }

  // ── Generate the suggestions ─────────────────────────────────────────────
  let suggestions
  try {
    suggestions = await generateLinkedinSuggestions(
      upload.text,
      userId,
      ratingContext,
    )
  } catch (err) {
    log.error("LinkedIn Assist generation failed", { err })
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
      {
        error: "Generating suggestions failed. Please try again.",
        code: "ASSIST_FAILED",
      },
      { status: 500 }
    )
  }

  // ── Persist ──────────────────────────────────────────────────────────────
  let data
  try {
    data = await persistLinkedinSuggestions({ userId, suggestions })
  } catch (err) {
    log.error("persisting LinkedIn suggestions failed", { err })
    return NextResponse.json(
      {
        error: "Generating suggestions failed. Please try again.",
        code: "ASSIST_FAILED",
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ data }, { status: 201 })
}
