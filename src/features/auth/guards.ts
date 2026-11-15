import { redirect } from "next/navigation"

import { auth, currentRequestPath, safeReturnPath } from "./config"

/**
 * Server-side owner guard. On a private deployment the session is always the
 * local owner; on a public key-gated deployment an unauthenticated request is
 * sent to `/unlock` with its destination preserved for after the unlock.
 */
export async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) {
    const next = await currentRequestPath()
    redirect(`/unlock?next=${encodeURIComponent(safeReturnPath(next))}`)
  }
  return session
}

/**
 * There is one owner, so every authenticated request is the administrator.
 * Kept for the actions and pages written against the old multi-user API.
 */
export async function requireAdmin() {
  return requireUser()
}

export async function requireAdminElevated() {
  return requireUser()
}

export async function assertAdminElevated() {
  return requireUser()
}
