import { NextResponse } from "next/server"

import { verifyApiToken } from "@/features/settings/services/api-token"

/**
 * CORS and bearer-token plumbing shared by the extension's ATS routes.
 *
 * The browser extension runs on `chrome-extension://` / `moz-extension://`, so it
 * has no session cookie. Every route here requires a personal `rspec_…` token and
 * reflects CORS only to extension origins — never `*`, never an arbitrary page.
 */
export function extensionCorsHeaders(
  origin: string | null,
  methods = "GET, POST, PATCH, DELETE, OPTIONS"
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Max-Age": "86400",
    // Preparation, answer and review payloads are owner data; never let a
    // shared cache retain them.
    "Cache-Control": "private, no-store",
    Vary: "Origin",
  }
  if (
    origin &&
    (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://"))
  ) {
    headers["Access-Control-Allow-Origin"] = origin
  }
  return headers
}

export function extensionOptions(req: Request, methods?: string): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: extensionCorsHeaders(req.headers.get("origin"), methods),
  })
}

/** Returns the token owner, or null. A malformed/absent token never falls back. */
export async function extensionUserId(req: Request): Promise<string | null> {
  const authorization = req.headers.get("authorization") ?? ""
  const rawToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : ""
  if (!rawToken) return null
  try {
    return await verifyApiToken(rawToken)
  } catch {
    return null
  }
}

export function unauthorized(cors: Record<string, string>): NextResponse {
  return NextResponse.json(
    { error: "Invalid or missing API token", code: "UNAUTHORIZED" },
    { status: 401, headers: cors }
  )
}

export function rateLimited(cors: Record<string, string>): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Try again later.", code: "RATE_LIMITED" },
    { status: 429, headers: cors }
  )
}
