"use server"

import bcrypt from "bcryptjs"
import { headers } from "next/headers"
import { signIn, signOut } from "./config"
import { safeCallbackUrl } from "./callback-url"
import { signInSchema, signUpSchema } from "./schemas"
import { isInviteCodeValid } from "./invite-code"
import { prisma } from "@/shared/lib/prisma"
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_MESSAGE,
  clearAttempts,
  consumeRateLimit,
  isRateLimited,
} from "@/shared/lib/rate-limit"
import { SIGN_IN_RATE_LIMIT } from "./rate-limits"

const SIGN_UP_RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 }

/**
 * `signIn` reports success by throwing a Next.js redirect. Anything that wraps it
 * in a try/catch has to let that through untouched or login silently breaks.
 */
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  )
}

/**
 * Best-effort client IP from the proxy headers. Returns null when no forwarding
 * header is present (e.g. a direct local request) — callers must not fabricate one.
 */
async function clientIp(): Promise<string | null> {
  try {
    const h = await headers()
    const forwardedFor = h.get("x-forwarded-for")
    if (forwardedFor) {
      const first = forwardedFor.split(",")[0]?.trim()
      if (first) return first
    }
    return h.get("x-real-ip")?.trim() || null
  } catch {
    return null
  }
}

export async function registerAction(formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = signUpSchema.safeParse(raw)

  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() }
  }

  const { name, email, password, inviteCode } = parsed.data

  // Signup limit. The email is attacker-chosen, so it is a weak key against
  // enumeration of the "Email already registered" response — the IP is the real
  // signal. When no forwarding header exists we fall back to the email, which
  // only slows a naive script down.
  const ip = await clientIp()
  const signUpKey = ip ?? email.toLowerCase()
  const signUpAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.SIGN_UP,
    signUpKey,
    SIGN_UP_RATE_LIMIT
  )
  if (!signUpAllowed) {
    return { error: RATE_LIMIT_MESSAGE }
  }

  // Closed-beta gate. Checked after the attempt is recorded so guessing codes
  // costs the same signup allowance as guessing anything else — the client-side
  // field is UX only, this is the enforcement.
  if (!isInviteCodeValid(inviteCode)) {
    return { error: "Invalid invite code." }
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return { error: "Email already registered" }
  }

  const hashedPassword = await bcrypt.hash(password, 12)

  const user = await prisma.user.create({
    data: { name, email, password: hashedPassword },
  })

  // The adapter's createUser event does not fire for credentials signup,
  // so the player profile is created explicitly here.
  await prisma.playerProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  })

  await signIn("credentials", { email, password, redirectTo: "/onboarding" })
}

export async function signInAction(formData: FormData) {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: "Invalid email or password" }
  }

  const { email, password } = parsed.data
  // Limit key only — `signIn` still gets the address as typed, since stored
  // emails are not normalized and a lowercased lookup could miss the row.
  const limitKey = email.toLowerCase()

  if (await isRateLimited(RATE_LIMIT_BUCKETS.SIGN_IN, limitKey, SIGN_IN_RATE_LIMIT)) {
    return { error: RATE_LIMIT_MESSAGE }
  }

  // No `recordAttempt` here: the Credentials provider's `authorize` records the
  // failure on the same bucket, so counting it in both places would halve the
  // real allowance. This layer exists for the friendly message.

  // Where the visitor was headed before the proxy bounced them here. Narrowed to
  // a same-origin path — the field is client-editable, so an unchecked value
  // would turn the sign-in form into an open redirect.
  const redirectTo = safeCallbackUrl(formData.get("callbackUrl"))

  try {
    await signIn("credentials", { email, password, redirectTo })
  } catch (err) {
    // A redirect means the credentials were valid: drop this email's attempts so
    // an honest user is not punished for earlier typos, then let the redirect fly.
    if (isRedirectError(err)) {
      await clearAttempts(RATE_LIMIT_BUCKETS.SIGN_IN, limitKey)
    }
    throw err
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" })
}

export async function oAuthSignIn(provider: "google" | "github", callbackUrl?: string) {
  await signIn(provider, { redirectTo: safeCallbackUrl(callbackUrl) })
}
