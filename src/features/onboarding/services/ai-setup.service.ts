/**
 * Server-side composition for first-run AI setup.
 *
 * Reads the user's saved (encrypted) configuration, then detects every provider
 * in parallel. Kept out of the server action module so the page and the actions
 * share exactly the same view of "what is configured".
 */

import {
  AI_PROVIDERS,
  AI_PROVIDER_META,
  type AiProvider,
} from "@/shared/lib/ai-providers/constants"
import { getUserAiKeyStatus } from "@/features/settings/services/user-ai-settings.service"
import {
  diagnoseProviders,
  type ProviderDiagnostic,
} from "../lib/provider-diagnostics"

export interface AiSetupSnapshot {
  /** The provider saved for this user, if any. */
  savedProvider: AiProvider | null
  model: string | null
  /** True when a decryptable key is stored for `savedProvider`. */
  hasSavedKey: boolean
  /** Last 4 characters for status copy; never the key. */
  last4?: string
  /** Per-provider detection. Every provider is present. */
  diagnostics: Record<AiProvider, ProviderDiagnostic>
}

function envKeyProviders(): AiProvider[] {
  return AI_PROVIDERS.filter((provider) => {
    const envVar = AI_PROVIDER_META[provider].credentialEnvVar
    return Boolean(envVar && process.env[envVar]?.trim())
  })
}

export async function getAiSetupSnapshot(userId: string): Promise<AiSetupSnapshot> {
  const status = await getUserAiKeyStatus(userId)
  const storedKeyProviders =
    status.configured && status.provider ? [status.provider] : []

  const diagnostics = await diagnoseProviders(AI_PROVIDERS, {
    storedKeyProviders,
    envKeyProviders: envKeyProviders(),
  })

  return {
    savedProvider: status.provider,
    model: status.model,
    hasSavedKey: status.configured,
    ...(status.last4 ? { last4: status.last4 } : {}),
    diagnostics,
  }
}
