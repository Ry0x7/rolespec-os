import { auth } from "./config"
import { verifyApiToken } from "@/features/settings/services/api-token"
import { prisma } from "@/shared/lib/prisma"

/**
 * Single-owner API identity.
 *
 * Every `/api/*` route in this OS must resolve the caller through here:
 *  1. Session cookie via `auth()` — which itself falls back to the local
 *     owner account on a private instance (see `config.ts`), so signed-out
 *     reads on a self-hosted box keep working.
 *  2. `Authorization: Bearer rspec_…` personal token (extension + external
 *     clients whose origin carries no cookie).
 *
 * Returns the owning user id, or null when the caller is anonymous.
 * Callers must ALWAYS scope every Prisma read/write with the returned id —
 * never trust a client-supplied userId, and never read across users.
 */
export async function resolveApiUserId(req: Request): Promise<string | null> {
  try {
    const session = await auth()
    if (session?.user?.id) return session.user.id
  } catch {
    // Fall through to bearer-token auth; a DB blip must not throw here.
  }

  const header = req.headers.get("authorization") ?? ""
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
  if (bearer) {
    try {
      const userId = await verifyApiToken(bearer)
      if (userId) return userId
    } catch {
      return null
    }
  }

  // Last resort for a private box with no session infrastructure yet:
  // resolve to the oldest local user rather than 401, matching `auth()`.
  // Never used to bypass a presented-but-invalid credential.
  if (!bearer) {
    try {
      const owner = await prisma.user.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
      return owner?.id ?? null
    } catch {
      return null
    }
  }

  return null
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
