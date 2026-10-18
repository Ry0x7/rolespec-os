import { prisma } from "@/shared/lib/prisma"
import { encryptSecret, secretLast4, tryDecryptSecret } from "@/shared/lib/secret-box"
import {
  AI_PROVIDER_META,
  USER_AI_PROVIDERS,
  isUserAiProvider,
  type UserAiProvider,
} from "@/shared/lib/ai-providers/constants"
import { clearUserAiSettingsCache } from "@/shared/lib/ai-provider"

export { USER_AI_PROVIDERS }
export type { UserAiProvider }

/** What the client is allowed to know about a stored key. Never the key itself. */
export interface UserAiKeyStatus {
  provider: UserAiProvider | null
  model: string | null
  configured: boolean
  envConfigured?: boolean
  /** Last 4 characters, for "sk-…a1b2" display. Absent when nothing is stored. */
  last4?: string
  /** The model the provider would use when `model` is unset. */
  defaultModel: string | null
}

/** The caller's own AI row, or null when they have never saved one. */
export async function getUserAiSettings(userId: string) {
  return prisma.userAiSettings.findUnique({ where: { userId } })
}

/**
 * Provider, model and key presence for the settings UI.
 */
export async function getUserAiKeyStatus(userId: string): Promise<UserAiKeyStatus> {
  const row = await getUserAiSettings(userId)
  const provider =
    row?.provider && isUserAiProvider(row.provider) ? row.provider : null
  const plaintext = tryDecryptSecret(row?.apiKeyEnc ?? null)
  const meta = provider ? AI_PROVIDER_META[provider] : null
  const envConfigured = meta?.credentialEnvVar
    ? Boolean(process.env[meta.credentialEnvVar])
    : false

  return {
    provider,
    model: row?.model?.trim() ? row.model.trim() : null,
    configured: plaintext !== null,
    envConfigured,
    ...(plaintext !== null ? { last4: secretLast4(plaintext) } : {}),
    defaultModel: provider ? AI_PROVIDER_META[provider].defaultModel : null,
  }
}

export interface SaveUserAiSettingsInput {
  provider: UserAiProvider
  /** Empty/absent means "use the provider default". */
  model?: string | null
  /**
   * `undefined` keeps the stored key (unless `provider` changed, which clears
   * it), `null` clears it, a string replaces it.
   */
  apiKey?: string | null
}

/**
 * Upserts the caller's provider/model and, when asked, their API key. The key is
 * encrypted here — plaintext never reaches Prisma — and the runtime cache for
 * this user is dropped so the next AI call sees the change immediately.
 */
export async function saveUserAiSettings(
  userId: string,
  input: SaveUserAiSettingsInput
) {
  const model = input.model?.trim() ? input.model.trim() : null
  const existing = await getUserAiSettings(userId)
  // Switching provider without supplying a new key drops the old one: an OpenAI
  // key must never be sent to api.deepseek.com. The account then reads as
  // not-configured for the new provider, which is the honest state.
  const switchedProvider = !!existing && existing.provider !== input.provider
  const keyValue =
    input.apiKey === undefined
      ? switchedProvider
        ? { apiKeyEnc: null }
        : {}
      : { apiKeyEnc: input.apiKey === null ? null : encryptSecret(input.apiKey) }

  const values = { provider: input.provider, model, ...keyValue }
  const row = await prisma.userAiSettings.upsert({
    where: { userId },
    create: { userId, ...values },
    update: values,
  })

  clearUserAiSettingsCache(userId)
  return row
}
