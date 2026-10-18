import { NextResponse } from "next/server"
import { z } from "zod"

import { generateReplyEmailAI } from "@/features/jobs/services/reply-email.service"
import { loadResumeTextForUser } from "@/features/jobs/services/resume-text.service"
import { userFacingSignature } from "@/shared/lib/prompts/signature-visibility"
import { EXTENSION_EMAIL_REPLY_RATE_LIMIT } from "@/features/settings/constants/data"
import { verifyApiToken } from "@/features/settings/services/api-token"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { logger } from "@/shared/lib/logger"
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_MESSAGE,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

/**
 * `POST /api/extension/email-reply` — the browser extension's reply assist.
 *
 * Sibling of `POST /api/extension/cold-email`: same bearer-token envelope and
 * same extension-only CORS. The input is the email the user received after
 * applying; nothing is persisted.
 */

const log = logger("extension-email-reply")

/** Blocking `generateObject`, nothing streams — matches the outreach route. */
export const maxDuration = 60

/**
 * `receivedEmail` is the pasted (or scraped) message being answered. Job context
 * is optional: the extension may be sitting on a mail client with no idea which
 * application the thread belongs to.
 */
const extensionEmailReplySchema = z.object({
  receivedEmail: z.string().min(1, "The received email is required").max(8000),
  job: z
    .object({
      companyName: z.string().max(200).optional(),
      jobTitle: z.string().max(200).optional(),
      jobDescription: z.string().max(5000).optional(),
    })
    .optional(),
  resumeId: z.string().min(1).optional(),
  instructions: z.string().max(1000).optional(),
  // All four are optional on purpose: an already-installed extension build keeps
  // POSTing without them and must keep working.
  tone: z.enum(["professional", "warm", "direct"]).optional(),
  length: z.enum(["brief", "standard", "detailed"]).optional(),
  priorThread: z.string().max(6000).optional(),
  previousDraft: z.string().max(4000).optional(),
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

  const replyAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_EMAIL_REPLY,
    userId,
    EXTENSION_EMAIL_REPLY_RATE_LIMIT
  )
  if (!replyAllowed) {
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

  const parsed = extensionEmailReplySchema.safeParse(body)
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

  const { receivedEmail, job, resumeId, instructions, tone, length, priorThread, previousDraft } =
    parsed.data

  // ── Resume, before charging — a user with no resume pays nothing ─────────
  let loaded
  try {
    loaded = await loadResumeTextForUser(userId, resumeId)
  } catch (err) {
    log.error("Loading the resume failed", { err, userId })
    return NextResponse.json(
      { error: "Could not generate the reply", code: "SERVER_ERROR" },
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
    const { subject, body: emailBody, grounding, signature: rawSignature } = await generateReplyEmailAI({
      userId,
      surface: "extension",
      resumeText: loaded.resumeText,
      candidateName: loaded.candidateName,
      receivedEmail,
      job,
      instructions,
      tone,
      length,
      priorThread,
      previousDraft,
    })

    // Same filter as the cold-email route: `missing_name` never leaves the server.
    const signature = userFacingSignature(rawSignature)

    log.info("Generated reply email from extension", { userId })

    return NextResponse.json(
      // Same envelope rule as the cold-email route: the field appears only when
      // there is something for the user to check.
      {
        subject,
        body: emailBody,
        ...(grounding ? { grounding } : {}),
        ...(signature ? { signature } : {}),
      },
      { status: 200, headers: cors }
    )
  } catch (err) {
    log.error("Reply email generation failed", { err, userId })

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
      { error: "Could not generate the reply", code: "SERVER_ERROR" },
      { status: 500, headers: cors }
    )
  }
}
