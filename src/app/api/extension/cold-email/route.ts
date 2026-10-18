import { NextResponse } from "next/server"
import { z } from "zod"

import { generateOutreachEmailAI } from "@/features/jobs/services/outreach-email.service"
import { loadResumeTextForUser } from "@/features/jobs/services/resume-text.service"
import { userFacingSignature } from "@/shared/lib/prompts/signature-visibility"
import { EXTENSION_COLD_EMAIL_RATE_LIMIT } from "@/features/settings/constants/data"
import { verifyApiToken } from "@/features/settings/services/api-token"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { logger } from "@/shared/lib/logger"
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_MESSAGE,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

/**
 * `POST /api/extension/cold-email` — the browser extension's outreach generator.
 *
 * Same envelope as `POST /api/extension/jobs`: personal API token in an
 * `Authorization: Bearer rspec_…` header (the extension's origin carries no
 * session cookie), CORS reflected to extension origins only, and `/api/extension`
 * whitelisted in `src/proxy.ts`.
 *
 * Unlike the jobs route this one calls the model. Nothing is persisted — the
 * draft is returned to the extension and forgotten.
 */

const log = logger("extension-cold-email")

/**
 * Blocking `generateObject`, nothing streams. 60s is the ceiling on Vercel's
 * Hobby plan without Fluid compute, matching the LinkedIn routes.
 */
export const maxDuration = 60

/**
 * The person the extension scraped off a profile page. Only `name` is required —
 * a profile can be sparse, and a thin prompt is better than a rejected request.
 */
const extensionColdEmailSchema = z.object({
  person: z.object({
    name: z.string().min(1, "Name is required").max(200),
    headline: z.string().max(300).optional(),
    company: z.string().max(200).optional(),
    about: z.string().max(5000).optional(),
    profileUrl: z.string().url("Must be a valid URL").max(500).optional(),
  }),
  /**
   * Optional and defaulted, so a client built before the LinkedIn message types
   * existed keeps getting a cold email.
   */
  messageType: z.enum(["cold_email", "connection_note", "linkedin_dm"]).default("cold_email"),
  /** Optional for the same reason: an older build sends no tone and gets the default. */
  tone: z.enum(["professional", "warm", "direct"]).optional(),
  resumeId: z.string().min(1).optional(),
  instructions: z.string().max(1000).optional(),
})

/**
 * CORS is granted to extension origins only. A page on the open web must not be
 * able to read a response from this endpoint, so `Access-Control-Allow-Origin` is
 * reflected only for `chrome-extension://` and `moz-extension://` — never `*`,
 * and never an arbitrary reflected origin.
 */
function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export async function POST(req: Request) {
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

  const coldEmailAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_COLD_EMAIL,
    userId,
    EXTENSION_COLD_EMAIL_RATE_LIMIT
  )
  if (!coldEmailAllowed) {
    return NextResponse.json(
      { error: RATE_LIMIT_MESSAGE, code: "RATE_LIMITED" },
      { status: 429, headers: cors }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON", code: "VALIDATION" },
      { status: 400, headers: cors }
    )
  }

  const parsed = extensionColdEmailSchema.safeParse(body)
  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    const message =
      Object.entries(flattened.fieldErrors)
        .map(([field, errors]) => `${field}: ${errors?.[0]}`)
        .join("; ") ||
      flattened.formErrors[0] ||
      "Invalid input"

    return NextResponse.json({ error: message, code: "VALIDATION" }, { status: 400, headers: cors })
  }

  const { person, messageType, tone, resumeId, instructions } = parsed.data

  // ── Resume, before charging — a user with no resume pays nothing ─────────
  let loaded
  try {
    loaded = await loadResumeTextForUser(userId, resumeId)
  } catch (err) {
    log.error("Loading the resume failed", { err, userId })
    return NextResponse.json(
      { error: "Could not generate the email", code: "SERVER_ERROR" },
      { status: 500, headers: cors }
    )
  }

  if (!loaded.ok) {
    // A 400 rather than a 404: the extension surfaces `error` verbatim, so the
    // copy has to tell the user what to do next.
    return NextResponse.json(
      {
        error:
          loaded.reason === "RESUME_NOT_FOUND"
            ? "No resume found for that id. Open RoleSpec and pick a different resume."
            : "No resume found. Create a resume in RoleSpec first.",
        code: "VALIDATION",
      },
      { status: 400, headers: cors }
    )
  }

  try {
    const { subject, body: emailBody, grounding, signature: rawSignature } = await generateOutreachEmailAI({
      userId,
      resumeText: loaded.resumeText,
      candidateName: loaded.candidateName,
      person,
      messageType,
      tone,
      instructions,
    })

    // `missing_name` is a style finding the services log and nobody is shown; the
    // one filter lives in `signature-visibility.ts`.
    const signature = userFacingSignature(rawSignature)

    log.info("Generated outreach email from extension", { userId, messageType })

    return NextResponse.json(
      // `grounding` is present only when the draft mentions something the resume
      // does not back, so an older extension build simply never sees the field.
      {
        subject,
        body: emailBody,
        ...(grounding ? { grounding } : {}),
        ...(signature ? { signature } : {}),
      },
      { status: 200, headers: cors }
    )
  } catch (err) {
    log.error("Outreach email generation failed", { err, userId })

    // "Add your API key…" is actionable and safe to show; anything else could
    // carry provider/infra detail, so it stays in the log above.
    if (err instanceof AiKeyRequiredError) {
      return NextResponse.json(
        { error: err.message, code: "AI_KEY_REQUIRED" },
        { status: 400, headers: cors }
      )
    }
    if (err instanceof AiDailyLimitError) {
      return NextResponse.json(
        { error: err.message, code: "AI_DAILY_LIMIT" },
        { status: 429, headers: cors }
      )
    }

    return NextResponse.json(
      { error: "Could not generate the email", code: "SERVER_ERROR" },
      { status: 500, headers: cors }
    )
  }
}
