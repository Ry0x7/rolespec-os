import { NextResponse } from "next/server"
import { z } from "zod"

import { WorkType } from "@/generated/prisma/enums"
import { readQualificationProfileRow } from "@/features/discovery/services/qualification-profile.service"
import {
  qualifyCandidate,
  toQualificationProfile,
} from "@/features/discovery/services/qualify.service"
import { EXTENSION_QUALIFY_RATE_LIMIT } from "@/features/settings/constants/data"
import { verifyApiToken } from "@/features/settings/services/api-token"
import { logger } from "@/shared/lib/logger"
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_MESSAGE,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

/**
 * `POST /api/extension/qualify` — the batch behind the extension's fit badges.
 *
 * Same envelope as `POST /api/extension/jobs`: personal API token in an
 * `Authorization: Bearer rspec_…` header (the extension's origin carries no
 * session cookie), CORS reflected to extension origins only, and `/api/extension`
 * whitelisted in `src/proxy.ts`.
 *
 * Evaluate-only and AI-free: it runs the same deterministic qualification pass
 * the job clip runs, against the same profile slice, and writes nothing — no
 * Job, no JobApplication, no usage event. Posting text is only ever the posting
 * side of the pass; the user's capabilities come from their Career Profile alone.
 */

const log = logger("extension-qualify")

/** One page of listings; a board with more sends another batch. */
const POSTING_LIMIT = 40

const qualifyPostingSchema = z.object({
  key: z.string().min(1).max(512),
  title: z.string().min(1).max(300),
  url: z
    .string()
    .min(1)
    .max(2048)
    .url({ protocol: /^https?$/, message: "Must be a valid http(s) URL" })
    .optional(),
  companyName: z.string().max(300).optional(),
  location: z.string().max(300).optional(),
  workType: z.nativeEnum(WorkType).nullable().optional(),
  description: z.string().max(20000).optional(),
})

const qualifyBodySchema = z.object({
  postings: z.array(qualifyPostingSchema).min(1).max(POSTING_LIMIT),
})

interface QualifyResultWire {
  key: string
  verdict: string
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | null
  marketFit: string | null
  confirmedCount: number
  matched: string[]
}

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

  const qualifyAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_QUALIFY,
    userId,
    EXTENSION_QUALIFY_RATE_LIMIT
  )
  if (!qualifyAllowed) {
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

  const parsed = qualifyBodySchema.safeParse(body)
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

  try {
    // The same narrow read the clip, the discovery save and the job re-check
    // use, so a badge and the panel's verdict on save are taken against the same
    // slice. It never creates the row: no profile means nothing to qualify against.
    const profileRow = await readQualificationProfileRow(userId)
    if (!profileRow) {
      return NextResponse.json(
        { profileComplete: false, results: [] },
        { status: 200, headers: cors }
      )
    }

    const profile = toQualificationProfile(profileRow)

    const results: QualifyResultWire[] = parsed.data.postings.map((posting) => {
      // Built exactly like the clip's posting. The link feeds the market-fit
      // fallback and the risk heuristics, so it is passed the same way.
      const assessed = qualifyCandidate(
        {
          title: posting.title,
          companyName: posting.companyName ?? "",
          url: posting.url ?? "",
          ...(posting.location && { location: posting.location }),
          ...(posting.workType && { workType: posting.workType }),
          ...(posting.description && { description: posting.description }),
        },
        profile
      )

      return {
        key: posting.key,
        verdict: assessed.verdict,
        riskLevel: assessed.risk.level ?? null,
        marketFit: assessed.marketFit.fit ?? null,
        confirmedCount: assessed.match.confirmedCount,
        matched: assessed.match.matched ?? [],
      }
    })

    return NextResponse.json({ profileComplete: true, results }, { status: 200, headers: cors })
  } catch (err) {
    log.error("Qualifying postings for the extension failed", { err, userId })

    return NextResponse.json(
      { error: "Could not check these postings", code: "SERVER_ERROR" },
      { status: 500, headers: cors }
    )
  }
}
