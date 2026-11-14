"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/features/auth/config"
import { USER_AI_PROVIDERS } from "@/shared/lib/ai-providers/constants"
import { saveUserAiSettings } from "../services/user-ai-settings.service"
import { logger } from "@/shared/lib/logger"

const log = logger("settings/user-ai")

const MAX_MODEL_LENGTH = 200
const MAX_API_KEY_LENGTH = 500

/**
 * The submitted key is the only place plaintext exists on the server: it goes
 * straight into `saveUserAiSettings`, which encrypts it. It is never logged and
 * never returned.
 */
const schema = z.object({
  provider: z.enum(USER_AI_PROVIDERS),
  model: z.string().max(MAX_MODEL_LENGTH).optional(),
  apiKey: z.string().max(MAX_API_KEY_LENGTH).optional(),
  clearApiKey: z.boolean().optional(),
})

export async function updateUserAiSettings(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = schema.safeParse({
    provider: formData.get("provider") ?? "",
    model: formData.get("model") ?? undefined,
    apiKey: formData.get("apiKey") ?? undefined,
    clearApiKey: formData.get("clearApiKey") === "on",
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const submittedKey = parsed.data.apiKey?.trim() ?? ""
  // undefined keeps the stored key, null clears it, a string replaces it.
  const apiKey = submittedKey
    ? submittedKey
    : parsed.data.clearApiKey
      ? null
      : undefined

  try {
    await saveUserAiSettings(session.user.id, {
      provider: parsed.data.provider,
      model: parsed.data.model ?? null,
      apiKey,
    })
  } catch (err) {
    // The error object can carry the encrypt input in a stack frame on some
    // runtimes, so only a fixed string is logged here.
    log.error("Saving personal AI settings failed", {
      provider: parsed.data.provider,
      failed: err instanceof Error ? err.name : "unknown",
    })
    return { error: "Something went wrong. Please try again." }
  }

  revalidatePath("/settings/ai")
  return { success: true as const }
}
