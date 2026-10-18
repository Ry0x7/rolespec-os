"use server"

import bcrypt from "bcryptjs"
import { z } from "zod"

import { prisma } from "@/shared/lib/prisma"
import { siteConfig } from "@/config/site"
import { sendEmail } from "@/shared/lib/email"
import { passwordResetEmail } from "@/shared/lib/email/templates"
import { extractClientIp } from "@/shared/lib/client-ip"
import { headers } from "next/headers"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

import {
  PASSWORD_RESET_REQUEST_IP_RATE_LIMIT,
  PASSWORD_RESET_REQUEST_RATE_LIMIT,
} from "./rate-limits"
import {
  PASSWORD_RESET_TTL_MINUTES,
  consumePasswordResetToken,
  createPasswordResetToken,
} from "./password-reset"
import { revokeUserSessions } from "./session-revocation"
import { signUpSchema } from "./schemas"
import { logger } from "@/shared/lib/logger"

const log = logger("password-reset")

const requestSchema = z.object({ email: z.string().email() })

/** Reuses the sign-up password rules so reset cannot set a weaker password. */
const resetSchema = z.object({
  token: z.string().min(16).max(200),
  password: signUpSchema.shape.password,
})

/**
 * The single response this action ever gives. Returning the same thing whether or
 * not the address has an account is what stops this endpoint being a user
 * enumeration oracle — the sign-in form is careful about that, and a reset form
 * that says "no such user" would undo it.
 */
const GENERIC_RESULT = {
  ok: true as const,
  message:
    "If that address has an account, a reset link is on its way. Check your inbox, including spam.",
}

export type RequestPasswordResetResult =
  | typeof GENERIC_RESULT
  | { ok: false; message: string }

export async function requestPasswordResetAction(
  formData: FormData
): Promise<RequestPasswordResetResult> {
  const parsed = requestSchema.safeParse({ email: formData.get("email") })
  // Even a malformed address gets the generic reply: "that isn't a valid email"
  // is fine to say, but saying it only for non-accounts would leak.
  if (!parsed.success) return GENERIC_RESULT

  const email = parsed.data.email
  const emailKey = email.toLowerCase()
  const ipKey = extractClientIp(await headers())

  // Two windows, as on sign-in: per-address to stop mailbox flooding, per-IP to
  // stop someone walking a list of addresses. A throttled caller still gets the
  // generic reply — telling them they are rate limited confirms they hit a real
  // endpoint and invites them to slow down rather than stop.
  // Sequential, not parallel: each call consumes a slot as it checks. When the
  // email window allows but the IP window refuses, the email slot has already
  // been spent — accepted skew, it only ever tightens the limit.
  const emailAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.PASSWORD_RESET_REQUEST,
    emailKey,
    PASSWORD_RESET_REQUEST_RATE_LIMIT
  )
  if (!emailAllowed) return GENERIC_RESULT

  const ipAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.PASSWORD_RESET_REQUEST_IP,
    ipKey,
    PASSWORD_RESET_REQUEST_IP_RATE_LIMIT
  )
  if (!ipAllowed) return GENERIC_RESULT

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, password: true },
  })

  // No account, or an OAuth-only account (no password to reset): do nothing, say
  // the same thing. Sending a reset link to an OAuth-only account would mint a
  // password that then bypasses the provider they signed up with.
  if (!user || !user.password) return GENERIC_RESULT

  const rawToken = await createPasswordResetToken(user.id)
  const resetUrl = `${siteConfig.url}/reset-password?token=${encodeURIComponent(rawToken)}`

  const sent = await sendEmail(
    passwordResetEmail(user.email, resetUrl, PASSWORD_RESET_TTL_MINUTES)
  )

  // A send failure is logged by `sendEmail` and deliberately not surfaced: the
  // caller cannot act on it, and the difference between "sent" and "failed" is
  // again an enumeration signal. The token simply expires unused.
  if (!sent.ok) {
    log.error("could not deliver reset link", { userId: user.id })
  }

  return GENERIC_RESULT
}

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; message: string; expired?: boolean }

export async function resetPasswordAction(formData: FormData): Promise<ResetPasswordResult> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  })

  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.find((issue) => issue.path[0] === "password")
    return {
      ok: false,
      message: passwordIssue?.message ?? "That reset link is not valid.",
    }
  }

  // Burned here, before the password is written: a link cannot be replayed even
  // if the update below fails.
  const consumed = await consumePasswordResetToken(parsed.data.token)
  if (!consumed.ok) {
    return consumed.reason === "expired"
      ? {
          ok: false,
          expired: true,
          message: "That reset link has expired. Request a new one.",
        }
      : { ok: false, message: "That reset link is not valid or has already been used." }
  }

  const hashed = await bcrypt.hash(parsed.data.password, 12)

  await prisma.user.update({
    where: { id: consumed.userId },
    // `passwordChangedAt` is what invalidates sessions minted before the reset —
    // see `syncTokenProfile`. Without it, an attacker holding a stolen session
    // cookie keeps it after the owner recovers the account.
    data: { password: hashed, passwordChangedAt: new Date() },
  })

  // Belt and braces alongside `passwordChangedAt`: bumps `sessionVersion` so every
  // existing session is refused on its next refresh.
  await revokeUserSessions(consumed.userId)

  return { ok: true }
}
