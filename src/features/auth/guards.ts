import { redirect } from "next/navigation"
import { auth } from "./config"

/**
 * Server-side session guard. Redirects to `/sign-in` when there is no session.
 * Safe to call from server components and server actions.
 */
export async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")
  return session
}

export async function requireAdmin() {
  return requireUser()
}

export async function requireAdminElevated() {
  return requireUser()
}

export async function assertAdminElevated() {
  return requireUser()
}
