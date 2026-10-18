import { NextResponse } from "next/server"

import { loadCareerProfile } from "@/features/career-profile/services/career-profile.service"
import { buildBoardSearchGroups } from "@/features/discovery/services/board-search-groups.service"
import { EXTENSION_RESUMES_RATE_LIMIT } from "@/features/settings/constants/data"
import { verifyApiToken } from "@/features/settings/services/api-token"
import { logger } from "@/shared/lib/logger"
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_MESSAGE,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

/**
 * `GET /api/extension/search-links` — job-board search links for the extension.
 *
 * Same envelope as `GET /api/extension/resumes`: personal API token in an
 * `Authorization: Bearer rspec_…` header, CORS reflected to extension origins
 * only, and `/api/extension` whitelisted in `src/proxy.ts`.
 *
 * Read-only and AI-free: the links are built exactly as `/jobs/discover` builds
 * them, from the user's own Career Profile (active target roles, confirmed
 * capabilities, locations, work modes, level) — never from posting text.
 *
 * It shares the resumes picker's rate-limit bucket: both are cheap profile reads
 * the extension makes when its panel opens.
 */

const log = logger("extension-search-links")

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
  // checks them again before handing the body to the extension. The body is
  // per-user profile data, so nothing may cache it.
  const headers = { ...corsHeaders(req.headers.get("origin")), "Cache-Control": "no-store" }

  const authorization = req.headers.get("authorization") ?? ""
  const rawToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : ""

  const userId = rawToken ? await verifyApiToken(rawToken) : null
  if (!userId) {
    return NextResponse.json(
      { error: "Invalid or missing API token", code: "UNAUTHORIZED" },
      { status: 401, headers }
    )
  }

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_RESUMES,
    userId,
    EXTENSION_RESUMES_RATE_LIMIT
  )
  if (!allowed) {
    return NextResponse.json(
      { error: RATE_LIMIT_MESSAGE, code: "RATE_LIMITED" },
      { status: 429, headers }
    )
  }

  try {
    const profile = await loadCareerProfile(userId)

    const { groups, activeTargetRoleCount } = buildBoardSearchGroups(profile)

    return NextResponse.json({ groups, activeTargetRoleCount }, { status: 200, headers })
  } catch (err) {
    log.error("Building search links for the extension failed", { err, userId })

    return NextResponse.json(
      { error: "Could not load your search links", code: "SERVER_ERROR" },
      { status: 500, headers }
    )
  }
}
