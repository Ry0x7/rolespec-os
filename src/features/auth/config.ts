import { cache } from "react"
import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import bcrypt from "bcryptjs"
import { prisma } from "@/shared/lib/prisma"
import { signInSchema } from "./schemas"
import { authConfig } from "./config.edge"
import { syncTokenProfile } from "./jwt-profile"
import { extractClientIp } from "@/shared/lib/client-ip"
import {
  RATE_LIMIT_BUCKETS,
  clearAttempts,
  isRateLimited,
  recordAttempt,
} from "@/shared/lib/rate-limit"
import { SIGN_IN_IP_RATE_LIMIT, SIGN_IN_RATE_LIMIT } from "./rate-limits"

function hasProviderId(provider: unknown): provider is { id: string } {
  return (
    typeof provider === "object" &&
    provider !== null &&
    "id" in provider &&
    typeof (provider as { id?: unknown }).id === "string"
  )
}

/**
 * One attempt per rejected credential check, on both keys. Recording lives here
 * rather than in `signInAction` so the count is identical whichever entrypoint
 * was used, and so a valid password never burns an attempt.
 */
async function recordFailedSignIn(emailKey: string, ipKey: string): Promise<void> {
  await Promise.all([
    recordAttempt(RATE_LIMIT_BUCKETS.SIGN_IN, emailKey),
    recordAttempt(RATE_LIMIT_BUCKETS.SIGN_IN_IP, ipKey),
  ])
}

const {
  handlers,
  auth: uncachedAuth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    ...(authConfig.providers ?? []).filter(
      (provider) => !hasProviderId(provider) || provider.id !== "credentials"
    ),
    Credentials({
      async authorize(credentials, request) {
        const parsed = signInSchema.safeParse(credentials)
        if (!parsed.success) return null

        const { email, password } = parsed.data
        // Limit keys only — `email` is still used verbatim for the lookup, since
        // stored addresses are not normalized.
        const emailKey = email.toLowerCase()
        const ipKey = extractClientIp(request.headers)

        // This provider is reachable directly at POST /api/auth/callback/credentials,
        // which never touches `signInAction`. The limits therefore have to live
        // here as well, on the same buckets so both paths share one count.
        const [emailLimited, ipLimited] = await Promise.all([
          isRateLimited(RATE_LIMIT_BUCKETS.SIGN_IN, emailKey, SIGN_IN_RATE_LIMIT),
          isRateLimited(RATE_LIMIT_BUCKETS.SIGN_IN_IP, ipKey, SIGN_IN_IP_RATE_LIMIT),
        ])
        // Generic failure: the friendly "too many attempts" copy comes from the
        // action, and this path must not tell an attacker why it said no.
        if (emailLimited || ipLimited) return null

        const user = await prisma.user.findUnique({ where: { email } })
        if (!user || !user.password) {
          await recordFailedSignIn(emailKey, ipKey)
          return null
        }

        const valid = await bcrypt.compare(password, user.password)
        if (!valid) {
          await recordFailedSignIn(emailKey, ipKey)
          return null
        }

        // Suspended or disabled accounts are refused exactly like a bad
        // password: the login form must not confirm that the address exists,
        // let alone that it was moderated.
        if (user.status !== "ACTIVE") {
          await recordFailedSignIn(emailKey, ipKey)
          return null
        }

        await Promise.all([
          clearAttempts(RATE_LIMIT_BUCKETS.SIGN_IN, emailKey),
          clearAttempts(RATE_LIMIT_BUCKETS.SIGN_IN_IP, ipKey),
        ])

        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      // `null` here is deliberate: Auth.js clears the session cookies when the
      // jwt callback returns null, which is how a password change ends sessions
      // minted before it.
      return syncTokenProfile({ token, user, trigger })
    },
    async session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as string
      return session
    },
  },
  events: {
    async createUser({ user }) {
      await prisma.playerProfile.create({
        data: { userId: user.id! },
      })
    },
  },
})

export { handlers, signIn, signOut }

async function getOrCreateDefaultUser() {
  const existing = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
  })
  if (existing) return existing

  return prisma.user.create({
    data: {
      email: "owner@rolespec.local",
      name: "RoleSpec Owner",
      role: "ADMIN",
      status: "ACTIVE",
      profile: {
        create: {},
      },
    },
  })
}

/**
 * Per-request memoized session read. In this self-hosted single-user OS,
 * it returns the existing session if one exists, or automatically resolves
 * to the default local user session.
 */
export const auth = cache(async () => {
  const session = await uncachedAuth()
  if (session?.user?.id) return session

  try {
    const defaultUser = await getOrCreateDefaultUser()
    return {
      user: {
        id: defaultUser.id,
        email: defaultUser.email,
        name: defaultUser.name ?? "RoleSpec Owner",
        image: defaultUser.image,
        role: "ADMIN",
      },
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    }
  } catch {
    return session
  }
})
