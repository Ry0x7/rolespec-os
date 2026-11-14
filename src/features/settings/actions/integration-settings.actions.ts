"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { auth } from "@/features/auth/config"
import { clearFirecrawlCache } from "@/features/discovery/services/firecrawl.client"
import { logger } from "@/shared/lib/logger"
import { saveFirecrawlSettings } from "../services/integration-settings.service"

const log = logger("settings/integrations")

const MAX_API_KEY_LENGTH = 500
const MAX_BASE_URL_LENGTH = 300

const schema = z.object({
  apiKey: z.string().max(MAX_API_KEY_LENGTH).optional(),
  baseUrl: z.string().max(MAX_BASE_URL_LENGTH).optional(),
  clearApiKey: z.boolean().optional(),
})

export type SaveFirecrawlResult = { success: true } | { error: string }

/**
 * Saves the Firecrawl connection from the Settings screen. The key goes straight
 * into the encrypted integration row; it is never logged, returned, or written
 * to an environment file. The content caches are dropped so the next discovery
 * or research request uses the new credentials immediately.
 */
export async function saveFirecrawlConnection(
  formData: FormData
): Promise<SaveFirecrawlResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Sign in to change this setting." }

  const parsed = schema.safeParse({
    apiKey: formData.get("apiKey") ?? undefined,
    baseUrl: formData.get("baseUrl") ?? undefined,
    clearApiKey: formData.get("clearApiKey") === "on",
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the values and try again." }
  }

  const submittedKey = parsed.data.apiKey?.trim() ?? ""
  const apiKey = submittedKey
    ? submittedKey
    : parsed.data.clearApiKey
      ? null
      : undefined

  try {
    await saveFirecrawlSettings({
      ...(apiKey !== undefined ? { apiKey } : {}),
      baseUrl: parsed.data.baseUrl?.trim() || null,
    })
    clearFirecrawlCache()
    revalidatePath("/settings/ai")
    revalidatePath("/jobs/discover")
    return { success: true }
  } catch (error) {
    log.error("Saving the Firecrawl connection failed", {
      failed: error instanceof Error ? error.name : "unknown",
      reason: error instanceof Error ? error.message : "unknown",
      hasKey: Boolean(submittedKey),
    })
    const message =
      error instanceof Error &&
      (error.message.includes("AUTH_SECRET") ||
        error.message.includes("ENCRYPTION_KEY"))
        ? "This installation cannot encrypt saved keys yet. Restart RoleSpec once so it can create its local encryption key, then try again."
        : error instanceof Error
          ? error.message
          : "Could not save the connection. Please try again."
    return { error: message }
  }
}
