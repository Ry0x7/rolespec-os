import { prisma } from "@/shared/lib/prisma"
import { encryptSecret, secretLast4, tryDecryptSecret } from "@/shared/lib/secret-box"
import {
  USER_AI_PROVIDERS,
  isUserAiProvider,
  type UserAiProvider,
} from "@/shared/lib/ai-providers/constants"
import { clearUserAiSettingsCache } from "@/shared/lib/ai-provider"
import { defaultModelForProvider } from "@/shared/lib/ai-providers/defaults"
import { isAiStage, type AiStage } from "@/shared/lib/ai-stages"

export interface UserAiStageSettingView {
  stage: AiStage
  provider: UserAiProvider
  model: string | null
  configured: boolean
  last4?: string
  defaultModel: string
}

export interface SaveUserAiStageSettingInput {
  stage: AiStage
  provider: UserAiProvider
  model?: string | null
  /** `undefined` keeps the stored key, `null` clears it, a string replaces it. */
  apiKey?: string | null
}

export async function listUserAiStageSettings(
  userId: string
): Promise<UserAiStageSettingView[]> {
  const rows = await prisma.userAiStageSetting.findMany({
    where: { userId },
    orderBy: { stage: "asc" },
  })
  return rows
    .filter((row) => isAiStage(row.stage) && isUserAiProvider(row.provider))
    .map((row) => {
      const plaintext = tryDecryptSecret(row.apiKeyEnc)
      const provider = row.provider as UserAiProvider
      return {
        stage: row.stage as AiStage,
        provider,
        model: row.model?.trim() ? row.model.trim() : null,
        configured: plaintext !== null,
        ...(plaintext !== null ? { last4: secretLast4(plaintext) } : {}),
        defaultModel: defaultModelForProvider(provider),
      }
    })
}

export async function saveUserAiStageSetting(
  userId: string,
  input: SaveUserAiStageSettingInput
): Promise<UserAiStageSettingView> {
  if (!isAiStage(input.stage) || !isUserAiProvider(input.provider)) {
    throw new Error("Invalid stage or provider")
  }
  if (!USER_AI_PROVIDERS.includes(input.provider)) {
    throw new Error("Invalid provider")
  }

  const existing = await prisma.userAiStageSetting.findUnique({
    where: { userId_stage: { userId, stage: input.stage } },
  })
  const switchedProvider = !!existing && existing.provider !== input.provider
  const keyValue =
    input.apiKey === undefined
      ? switchedProvider
        ? { apiKeyEnc: null }
        : {}
      : { apiKeyEnc: input.apiKey === null ? null : encryptSecret(input.apiKey) }
  const model = input.model?.trim() ? input.model.trim() : null

  const row = await prisma.userAiStageSetting.upsert({
    where: { userId_stage: { userId, stage: input.stage } },
    create: {
      userId,
      stage: input.stage,
      provider: input.provider,
      model,
      ...keyValue,
    },
    update: { provider: input.provider, model, ...keyValue },
  })

  clearUserAiSettingsCache(userId)
  return stageView(row)
}

export async function clearUserAiStageSetting(
  userId: string,
  stage: AiStage
): Promise<boolean> {
  const result = await prisma.userAiStageSetting.deleteMany({
    where: { userId, stage },
  })
  clearUserAiSettingsCache(userId)
  return result.count > 0
}

function stageView(row: {
  stage: string
  provider: string
  model: string | null
  apiKeyEnc: string | null
}): UserAiStageSettingView {
  const provider = row.provider as UserAiProvider
  const plaintext = tryDecryptSecret(row.apiKeyEnc)
  return {
    stage: row.stage as AiStage,
    provider,
    model: row.model?.trim() ? row.model.trim() : null,
    configured: plaintext !== null,
    ...(plaintext !== null ? { last4: secretLast4(plaintext) } : {}),
    defaultModel: defaultModelForProvider(provider),
  }
}
