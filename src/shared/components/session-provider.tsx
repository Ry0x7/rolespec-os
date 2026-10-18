"use client"

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react"
import type { Session } from "next-auth"

/**
 * `session` is the server-resolved session handed down by the layout. Passing it
 * seeds the client cache so `useSession()` does not fetch /api/auth/session on
 * first paint (which made the header avatar pop in late).
 */
export function SessionProvider({
  children,
  session,
}: {
  children: React.ReactNode
  session?: Session | null
}) {
  return (
    <NextAuthSessionProvider session={session}>{children}</NextAuthSessionProvider>
  )
}
