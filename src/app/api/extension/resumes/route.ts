import { NextResponse } from "next/server"

import { EXTENSION_RESUMES_RATE_LIMIT } from "@/features/settings/constants/data"
import { verifyApiToken } from "@/features/settings/services/api-token"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_MESSAGE,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

/**
 * `GET /api/extension/resumes` — the list behind the extension's resume picker.
 *
 * Same envelope as `POST /api/extension/jobs`: personal API token in an
 * `Authorization: Bearer rspec_…` header (the extension's origin carries no
 * session cookie), CORS reflected to extension origins only, and `/api/extension`
 * whitelisted in `src/proxy.ts`.
 *
 * Read-only and AI-free: it returns the same non-archived resumes the app pages
 * show, newest first, so the extension can name the resume it generates from.
 */

const log = logger("extension-resumes")

/** Enough to fill a picker; a user with more than this scrolls in the app. */
const RESUME_LIMIT = 50

/**
 * CORS is granted to extension origins only. A page on the open web must not be
 * able to read a response from this endpoint, so `Access-Control-Allow-Origin` is
 * reflected only for `chrome-extension://` and `moz-extension://` — never `*`,
 * and never an arbitrary reflected origin.
 */
function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    // The allowed origin varies per request, so caches must not share a response.
    Vary: "Origin",
  }

  if (origin && (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://"))) {
    headers["Access-Control-Allow-Origin"] = origin
  }

  return headers
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  })
}

export async function GET(req: Request) {
  // The preflight headers have to be on the real response too — the browser
  // checks them again before handing the body to the extension.
  const cors = corsHeaders(req.headers.get("origin"))

  const authorization = req.headers.get("authorization") ?? ""
  const rawToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : ""

  const userId = rawToken ? await verifyApiToken(rawToken) : null
  if (!userId) {
    return NextResponse.json(
      { error: "Invalid or missing API token", code: "UNAUTHORIZED" },
      { status: 401, headers: cors }
    )
  }

  const resumesAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_RESUMES,
    userId,
    EXTENSION_RESUMES_RATE_LIMIT
  )
  if (!resumesAllowed) {
    return NextResponse.json(
      { error: RATE_LIMIT_MESSAGE, code: "RATE_LIMITED" },
      { status: 429, headers: cors }
    )
  }

  try {
    const resumes = await prisma.resume.findMany({
      where: { userId, status: { not: "ARCHIVED" } },
      select: { id: true, title: true, atsScore: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: RESUME_LIMIT,
    })

    return NextResponse.json({ resumes }, { status: 200, headers: cors })
  } catch (err) {
    log.error("Listing resumes for the extension failed", { err, userId })

    return NextResponse.json(
      { error: "Could not load your resumes", code: "SERVER_ERROR" },
      { status: 500, headers: cors }
    )
  }
}
