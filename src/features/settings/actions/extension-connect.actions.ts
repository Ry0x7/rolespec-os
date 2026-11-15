"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { auth } from "@/features/auth/config"
import { logger } from "@/shared/lib/logger"
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_MESSAGE,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

import { API_TOKEN_CREATE_RATE_LIMIT, EXTENSION_TOKEN_NAME } from "../constants/data"
import {
  buildExtensionRedirect,
  parseExtensionConnectParams,
} from "../schemas/extension-connect.schema"
import { createApiToken, revokeApiTokensByName } from "../services/api-token"

/**
 * The consent step of the extension's `launchWebAuthFlow` handshake.
 *
 * Mints a personal API token and hands it back through the fragment of the
 * extension's own redirect URI, which Chrome intercepts instead of navigating to.
 * The fragment is deliberate: it never reaches a server log or a Referer header.
 *
 * Everything the page already validated is validated again here — the hidden
 * fields are client-editable, and this action is what actually creates the
 * credential.
 */

const log = logger("extension-connect")

type ConnectExtensionResult = { error: string }

export async function connectExtensionAction(formData: FormData): Promise<ConnectExtensionResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "You are not signed in." }
  const userId = session.user.id

  const parsed = parseExtensionConnectParams(
    formData.get("state"),
    formData.get("redirectUri")
  )
  if (!parsed.ok) return { error: parsed.error }

  const tokenAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.API_TOKEN_CREATE,
    userId,
    API_TOKEN_CREATE_RATE_LIMIT
  )
  if (!tokenAllowed) {
    return { error: RATE_LIMIT_MESSAGE }
  }

  let token: string
  try {
    // Retire the previous one first: a reconnect should not consume another slot
    // against MAX_ACTIVE_API_TOKENS, and the old token is about to be orphaned in
    // an extension that no longer holds it.
    await revokeApiTokensByName(userId, EXTENSION_TOKEN_NAME)
    const created = await createApiToken(userId, EXTENSION_TOKEN_NAME)
    token = created.token
  } catch (err) {
    log.error("Failed to mint the extension token", { err, userId })
    return { error: "Could not connect the extension. Please try again." }
  }

  revalidatePath("/settings")

  // Outside the try/catch: `redirect` signals by throwing, and swallowing that
  // would leave the user on a page that quietly did nothing.
  redirect(buildExtensionRedirect(parsed.redirectUri, token, parsed.state))
}
