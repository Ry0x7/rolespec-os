import { NextResponse, type NextRequest } from "next/server"

const LEGACY_AUTH_PATHS = new Set([
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
])

/**
 * No authentication middleware: the single-owner guard runs in the server
 * components/actions where the database is reachable. This proxy only keeps old
 * bookmarked auth URLs from 404-ing and records where the request was headed so
 * the remote unlock page can send the owner back after a successful key entry.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (LEGACY_AUTH_PATHS.has(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", req.url))
  }

  const headers = new Headers(req.headers)
  headers.set("x-rolespec-path", `${pathname}${req.nextUrl.search}`)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ["/((?!_next|static|favicon.ico).*)"],
}
