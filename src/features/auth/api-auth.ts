import { auth } from "./config"
import { verifyApiToken } from "@/features/settings/services/api-token"
import { prisma } from "@/shared/lib/prisma"

/**
 * Browser same-origin check for cookie-authenticated mutations.
 *
 * Server Actions get this from Next.js; route handlers do not. A request with
 * no `Origin` (curl, a server job) is allowed through, but a browser sends one
 * on every non-GET request, and a forged value cannot be produced by a web page
 * for another site. `Origin: null` is refused because sandboxed frames use it.
 */
export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin")
  if (!origin) return true
  if (origin === "null") return false

  let originHost: string
  try {
    originHost = new URL(origin).host.toLowerCase()
  } catch {
    return false
  }

  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase()

  return !!host && originHost === host
}

/**
 * Single-owner API identity.
 *
 * Every `/api/*` route in this OS must resolve the caller through here:
 *  1. Owner access via `auth()` — passwordless on a private deployment, or a
 *     signed unlock cookie on a public one (see `session.ts`).
 *  2. `Authorization: Bearer rspec_…` personal token (extension + external
 *     clients whose origin carries no cookie). A token works even when the
 *     browser session is locked, which is what keeps the extension paired.
 *
 * Returns the owning user id, or null when the caller is anonymous. A presented
 * but invalid token never falls back to an unauthenticated owner.
 * Callers must ALWAYS scope every Prisma read/write with the returned id —
 * never trust a client-supplied userId, and never read across users.
 */
export async function resolveApiUserId(req: Request): Promise<string | null> {
  try {
    const session = await auth()
    if (session?.user?.id) {
      // A cross-site POST would otherwise ride the owner cookie (or, in local
      // mode, the passwordless session) into a state-changing handler.
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())
      if (mutating && !isSameOriginRequest(req)) return null
      return session.user.id
    }
  } catch {
    // Fall through to bearer-token auth; a DB blip must not throw here.
  }

  const header = req.headers.get("authorization") ?? ""
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
  if (!bearer) return null

  try {
    return await verifyApiToken(bearer)
  } catch {
    return null
  }
}

/** Best-effort activity log — feed writes must never fail the user action. */
export async function logActivityEvent(input: {
  userId: string
  type: string
  title: string
  body?: string | null
  metadata?: Record<string, unknown> | null
}): Promise<void> {
  try {
    await prisma.activityEvent.create({
      data: {
        userId: input.userId,
        type: input.type.slice(0, 80),
        title: input.title.slice(0, 300),
        body: input.body?.slice(0, 4000) ?? null,
        metadata: (input.metadata ?? undefined) as never,
      },
    })
  } catch {
    // Feed is narrative only; the underlying write already succeeded.
  }
}
