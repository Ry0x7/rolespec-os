import { NextResponse } from "next/server"

import { verifyApiToken } from "@/features/settings/services/api-token"
import { prisma } from "@/shared/lib/prisma"

/**
 * `GET /api/extension/profile` — the safe facts behind the browser extension's
 * assisted ATS form filling.
 *
 * It returns contact and preference fields only: no resume text, no career
 * evidence, no job history, no AI keys or tokens. The extension uses these to
 * fill ordinary identity/contact inputs; work authorization, sponsorship, pay
 * and demographic questions always go to its review queue.
 *
 * Auth is the same personal bearer token as every `/api/extension/*` route, and
 * CORS is reflected to extension origins only.
 */

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "private, no-store",
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

  try {
    const [user, careerProfile, playerProfile] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      }),
      prisma.careerProfile.findUnique({
        where: { userId },
        select: {
          contactFullName: true,
          contactEmail: true,
          contactPhone: true,
          contactLocation: true,
          linkedinUrl: true,
          githubUrl: true,
          websiteUrl: true,
          workAuthorization: true,
          requiresSponsorship: true,
          salaryMin: true,
          salaryMax: true,
          salaryCurrency: true,
        },
      }),
      prisma.playerProfile.findUnique({
        where: { userId },
        select: { currentRole: true, targetRole: true },
      }),
    ])

    if (!user) {
      return NextResponse.json(
        { error: "Invalid or missing API token", code: "UNAUTHORIZED" },
        { status: 401, headers: cors }
      )
    }

    return NextResponse.json(
      {
        profile: {
          fullName: careerProfile?.contactFullName ?? user.name ?? null,
          email: careerProfile?.contactEmail ?? user.email ?? null,
          phone: careerProfile?.contactPhone ?? null,
          location: careerProfile?.contactLocation ?? null,
          linkedinUrl: careerProfile?.linkedinUrl ?? null,
          githubUrl: careerProfile?.githubUrl ?? null,
          websiteUrl: careerProfile?.websiteUrl ?? null,
          currentRole: playerProfile?.currentRole ?? null,
          targetRole: playerProfile?.targetRole ?? null,
          workAuthorization: careerProfile?.workAuthorization ?? null,
          requiresSponsorship: careerProfile?.requiresSponsorship ?? null,
          salaryMin: careerProfile?.salaryMin ?? null,
          salaryMax: careerProfile?.salaryMax ?? null,
          salaryCurrency: careerProfile?.salaryCurrency ?? null,
        },
      },
      { status: 200, headers: cors }
    )
  } catch {
    return NextResponse.json(
      { error: "Could not load your profile", code: "SERVER_ERROR" },
      { status: 500, headers: cors }
    )
  }
}
