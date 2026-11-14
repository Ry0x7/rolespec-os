"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { auth } from "@/features/auth/config"
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_MESSAGE,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

import {
  API_TOKEN_CREATE_RATE_LIMIT,
  API_TOKEN_EXPIRY_CHOICES,
  MAX_ACTIVE_API_TOKENS,
  type ApiTokenExpiryChoice,
} from "../constants/data"
import {
  countActiveApiTokens,
  createApiToken,
  revokeAllApiTokens,
  revokeApiToken,
  rotateApiToken,
} from "../services/api-token"

/**
 * Settings actions behind the "API access" section. The raw token crosses the
 * wire exactly once, in the return value of {@link createApiTokenAction} — it is
 * never stored in plaintext and never re-readable, so the client has to show it
 * straight away.
 */

const nameSchema = z
  .string()
  .trim()
  .min(1, "Give the token a name")
  .max(60, "Name must be 60 characters or fewer")

/**
 * The client picks a key, not a date. Anything else — including a date string a
 * tampered form might send — is rejected before a token exists.
 */
const expirySchema = z.enum(
  Object.keys(API_TOKEN_EXPIRY_CHOICES) as [ApiTokenExpiryChoice, ...ApiTokenExpiryChoice[]]
)

const DAY_MS = 24 * 60 * 60 * 1000

/** Turns the chosen key into an absolute expiry, computed here and nowhere else. */
function expiryFromChoice(choice: ApiTokenExpiryChoice): Date | null {
  const days = API_TOKEN_EXPIRY_CHOICES[choice].days
  return days === null ? null : new Date(Date.now() + days * DAY_MS)
}

export type CreateApiTokenResult = { token: string; name: string } | { error: string }

export async function createApiTokenAction(formData: FormData): Promise<CreateApiTokenResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "You are not signed in." }
  const userId = session.user.id

  const parsed = nameSchema.safeParse(formData.get("name") ?? "")
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid name" }
  }

  // An absent field is the old behaviour, "never". A present but unknown value is
  // a tampered form, and is refused rather than quietly downgraded.
  const rawExpiry = formData.get("expiry")
  let expiryChoice: ApiTokenExpiryChoice = "never"
  if (rawExpiry !== null && rawExpiry !== "") {
    const parsedExpiry = expirySchema.safeParse(rawExpiry)
    if (!parsedExpiry.success) return { error: "Choose a valid expiry." }
    expiryChoice = parsedExpiry.data
  }

  const tokenAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.API_TOKEN_CREATE,
    userId,
    API_TOKEN_CREATE_RATE_LIMIT
  )
  if (!tokenAllowed) {
    return { error: RATE_LIMIT_MESSAGE }
  }

  // Cap on live credentials, not on tokens ever created — revoking one frees a
  // slot immediately.
  if ((await countActiveApiTokens(userId)) >= MAX_ACTIVE_API_TOKENS) {
    return {
      error: `You already have ${MAX_ACTIVE_API_TOKENS} active tokens. Revoke one before creating another.`,
    }
  }

  try {
    const { token, summary } = await createApiToken(
      userId,
      parsed.data,
      expiryFromChoice(expiryChoice)
    )
    revalidatePath("/settings")
    return { token, name: summary.name }
  } catch {
    return { error: "Could not create the token. Please try again." }
  }
}

export type RevokeApiTokenResult = { ok: true } | { error: string }

export async function revokeApiTokenAction(tokenId: string): Promise<RevokeApiTokenResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "You are not signed in." }

  if (typeof tokenId !== "string" || tokenId.length === 0) {
    return { error: "Could not read which token to revoke." }
  }

  try {
    const revoked = await revokeApiToken(session.user.id, tokenId)
    if (!revoked) return { error: "That token no longer exists." }
    revalidatePath("/settings")
    return { ok: true }
  } catch {
    return { error: "Could not revoke the token. Please try again." }
  }
}

export type RotateApiTokenResult = { token: string; name: string } | { error: string }

/**
 * Replaces an existing token with a fresh one. Shares the create bucket: a
 * rotation mints a credential, so it costs the same budget.
 */
export async function rotateApiTokenAction(tokenId: string): Promise<RotateApiTokenResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "You are not signed in." }
  const userId = session.user.id

  if (typeof tokenId !== "string" || tokenId.length === 0) {
    return { error: "Could not read which token to rotate." }
  }

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.API_TOKEN_CREATE,
    userId,
    API_TOKEN_CREATE_RATE_LIMIT
  )
  if (!allowed) return { error: RATE_LIMIT_MESSAGE }

  try {
    const rotated = await rotateApiToken(userId, tokenId)
    if (!rotated) return { error: "That token no longer exists." }
    revalidatePath("/settings")
    return { token: rotated.token, name: rotated.summary.name }
  } catch {
    return { error: "Could not rotate the token. Please try again." }
  }
}

export type RevokeAllApiTokensResult = { ok: true; count: number } | { error: string }

/** Retires every live token at once, for when the user suspects one has leaked. */
export async function revokeAllApiTokensAction(): Promise<RevokeAllApiTokensResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "You are not signed in." }

  try {
    const count = await revokeAllApiTokens(session.user.id)
    revalidatePath("/settings")
    return { ok: true, count }
  } catch {
    return { error: "Could not revoke your tokens. Please try again." }
  }
}
