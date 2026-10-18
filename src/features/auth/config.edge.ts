import type { NextAuthConfig } from "next-auth"
import GitHub from "next-auth/providers/github"
import Credentials from "next-auth/providers/credentials"

export const authConfig: NextAuthConfig = {
  // Self-hosted / dev behind known hosts: derive the base URL from the request
  // host instead of relying on the NODE_ENV-dependent default.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  providers: [
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [
          GitHub({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          }),
        ]
      : []),
    Credentials({
      async authorize() {
        return null
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id!
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = "ADMIN"
      return session
    },
    // No `authorized` callback here: it only ever runs when `auth` is used as
    // Next.js middleware, and this app routes through `src/proxy.ts` instead.
    // `src/proxy.ts` is the single source of truth for the route policy.
  },
}
