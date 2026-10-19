"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/features/auth/config"
import {
  USER_AI_PROVIDERS,
  type AiProvider,
} from "@/shared/lib/ai-providers/constants"
import {
  getUserAiKeyStatus,
  saveUserAiSettings,
} from "@/features/settings/services/user-ai-settings.service"
import { logger } from "@/shared/lib/logger"
import {
  classifyProviderError,
  testProviderConnection,
  type AiConnectionTestFailure,
  type AiConnectionTestResult,
} from "../lib/ai-connection-test"
import { diagnoseProvider } from "../lib/provider-diagnostics"

const log = logger("onboarding/ai-setup")

const configureSchema = z.object({
  provider: z.enum(USER_AI_PROVIDERS),
  model: z.string().trim().max(200).optional(),
  /**
   * The only place plaintext exists. It is handed straight to
   * `saveUserAiSettings`, which encrypts it; it is never logged or returned.
   */
  apiKey: z.string().trim().max(500).optional(),
})

export interface ConfigureAiResult {
  /** What the live test concluded. */
  test: AiConnectionTestResult
  /**
   * False when the choice could not be persisted. The test failure then
   * describes the unsaved state, so the UI never claims the choice was saved.
   */
  saved: boolean
  /** Set only when saving itself failed, with no usable test result. */
  saveError?: string
}

function failure(
  provider: AiProvider | null,
  code: AiConnectionTestFailure["code"],
  title: string,
  message: string,
  guidance: string[]
): AiConnectionTestFailure {
  return { ok: false, code, title, message, guidance, provider }
}

/**
 * Saves the chosen provider/model/key (key encrypted by the existing service),
 * then runs a real generation against it.
 *
 * Saving first is intentional: the test must exercise exactly what the app will
 * use, including the resolver's provider/model selection. A failed test leaves
 * the provider selected and the key encrypted, so the user can replace the key
 * and retry instead of starting over.
 */
export async function configureAndTestAiProvider(
  input: unknown
): Promise<ConfigureAiResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return {
      saved: false,
      test: failure(
        null,
        "UNKNOWN",
        "Your session expired.",
        "Reload RoleSpec and try again.",
        []
      ),
    }
  }

  const parsed = configureSchema.safeParse(input)
  if (!parsed.success) {
    return {
      saved: false,
      test: failure(
        null,
        "UNKNOWN",
        "That AI setup could not be read.",
        parsed.error.issues[0]?.message ?? "Check the selected provider and try again.",
        []
      ),
    }
  }

  const { provider, model, apiKey } = parsed.data
  const key = apiKey?.trim() ? apiKey.trim() : undefined

  try {
    await saveUserAiSettings(session.user.id, {
      provider,
      model: model?.trim() ? model.trim() : null,
      apiKey: key ?? undefined,
    })
  } catch (error) {
    // Never log the error object: the encrypt input could appear in a stack
    // frame on some runtimes. A fixed summary is enough to diagnose.
    log.error("Saving AI setup failed", {
      provider,
      failed: error instanceof Error ? error.name : "unknown",
    })
    return {
      saved: false,
      saveError:
        "RoleSpec couldn't save the AI setting securely on this computer. Check the server logs and try again.",
      test: failure(
        provider,
        "UNKNOWN",
        "The AI setting could not be saved.",
        "Nothing was sent to the provider.",
        ["Check the RoleSpec logs, then try again."]
      ),
    }
  }

  const status = await getUserAiKeyStatus(session.user.id)
  const diagnostic = await diagnoseProvider(provider, {
    storedKeyProviders: status.configured && status.provider ? [status.provider] : [],
    envKeyProviders: status.envConfigured ? [provider] : [],
  })
  const test = await testProviderConnection(diagnostic, session.user.id)

  revalidatePath("/onboarding")
  revalidatePath("/settings/ai")
  return { test, saved: true }
}

/**
 * Re-tests the saved configuration without changing it. Used by the "Test
 * connection" step so the user can retry after starting Ollama or signing in.
 */
export async function testSavedAiProvider(): Promise<AiConnectionTestResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return failure(
      null,
      "UNKNOWN",
      "Your session expired.",
      "Reload RoleSpec and try again.",
      []
    )
  }

  const status = await getUserAiKeyStatus(session.user.id)
  if (!status.provider) {
    return failure(
      null,
      "KEY_MISSING",
      "Choose an AI option first.",
      "No AI provider has been saved yet, so there is nothing to test.",
      ["Go back and choose how AI should work."]
    )
  }

  try {
    const diagnostic = await diagnoseProvider(status.provider, {
      storedKeyProviders: status.configured ? [status.provider] : [],
      envKeyProviders: status.envConfigured ? [status.provider] : [],
    })
    return await testProviderConnection(diagnostic, session.user.id)
  } catch (error) {
    log.error("AI connection test failed unexpectedly", {
      provider: status.provider,
      failed: error instanceof Error ? error.name : "unknown",
    })
    return classifyProviderError(status.provider, error)
  }
}
