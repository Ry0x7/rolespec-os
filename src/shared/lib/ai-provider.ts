import { getOpenAIModel, getLMStudioModel, getOllamaModel } from "./ai-providers/openai"
import { getAnthropicModel } from "./ai-providers/anthropic"
import { getDeepSeekModel } from "./ai-providers/deepseek"
import { getGoogleModel } from "./ai-providers/google"
import {
  AI_PROVIDER_META,
  DEFAULT_AI_PROVIDER,
  isAiProvider,
  isUserAiProvider,
  type AiProvider,
  type UserAiProvider,
} from "./ai-providers/constants"
import { resolveCodexModelId } from "./ai-providers/codex-paths"
import { resolveOpenCodeModelId } from "./ai-providers/opencode-models"
import { prisma } from "./prisma"
import { tryDecryptSecret } from "./secret-box"
import { logger } from "@/shared/lib/logger"

const log = logger("ai-provider")

/** How long a read of the AiSettings singleton is reused before re-querying. */
const CACHE_TTL_MS = 60_000

const SETTINGS_ID = "singleton"

interface AiSettingsValue {
  provider: string | null
  model: string | null
  temperature: number | null
  maxOutputTokens: number | null
  /**
   * Ciphertext as stored. Cached encrypted and decrypted at the point of use, so
   * a plaintext key is never held in the module cache for the whole TTL.
   */
  openaiApiKeyEnc: string | null
  anthropicApiKeyEnc: string | null
}

let cache: { value: AiSettingsValue | null; expiresAt: number } | null = null
let readErrorLogged = false

/** Drops the cached AiSettings row so the next resolve re-reads the DB. */
export function clearAiSettingsCache() {
  cache = null
  readErrorLogged = false
}

/**
 * Reads the AiSettings singleton through an in-memory TTL cache. Returns null
 * when there is no row — or when the read fails (missing table, DB down), so AI
 * calls keep working off the env config.
 */
async function readAiSettings(): Promise<AiSettingsValue | null> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.value

  try {
    const row = await prisma.aiSettings.findUnique({ where: { id: SETTINGS_ID } })
    const value: AiSettingsValue | null = row
      ? {
          provider: row.provider,
          model: row.model,
          temperature: row.temperature,
          maxOutputTokens: row.maxOutputTokens,
          openaiApiKeyEnc: row.openaiApiKeyEnc ?? null,
          anthropicApiKeyEnc: row.anthropicApiKeyEnc ?? null,
        }
      : null
    cache = { value, expiresAt: now + CACHE_TTL_MS }
    return value
  } catch (error) {
    if (!readErrorLogged) {
      readErrorLogged = true
      log.error("Could not read AiSettings; falling back to env config.", { error })
    }
    cache = { value: null, expiresAt: now + CACHE_TTL_MS }
    return null
  }
}

/**
 * True in a deployed serverless environment, where `localOnly` providers cannot
 * work: they either spawn a native subprocess (claude-code, codex-cli,
 * opencode-cli) or point at localhost (ollama, lmstudio). `VERCEL` is set on
 * every Vercel build and invocation, preview and production alike.
 */
function isServerlessDeploy(): boolean {
  return Boolean(process.env.VERCEL)
}

/**
 * Resolves the provider when the AiSettings row does not name one. An explicit
 * `AI_PROVIDER` always wins. With it unset, a present API key — stored in the DB
 * or in the environment — picks the matching serverless-safe provider before
 * falling back to `DEFAULT_AI_PROVIDER`, so a deploy that has credentials but
 * forgot the var works instead of silently selecting the local-only CLI provider.
 */
function envProvider(settings?: AiSettingsValue | null): AiProvider {
  const provider = process.env.AI_PROVIDER
  if (provider && isAiProvider(provider)) return provider

  if (process.env.OPENAI_API_KEY || settings?.openaiApiKeyEnc) return "openai"
  if (process.env.ANTHROPIC_API_KEY || settings?.anthropicApiKeyEnc) return "anthropic"
  if (process.env.DEEPSEEK_API_KEY) return "deepseek"
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google"

  return DEFAULT_AI_PROVIDER
}

/**
 * The API key the given provider should use: the admin-entered key stored on
 * AiSettings wins over the env var. Returns undefined when there is no stored
 * key (or it cannot be decrypted, e.g. after AUTH_SECRET was rotated), which
 * leaves the provider factory on its env fallback.
 */
async function storedApiKey(provider: AiProvider): Promise<string | undefined> {
  const settings = await readAiSettings()
  const ciphertext =
    provider === "openai"
      ? settings?.openaiApiKeyEnc
      : provider === "anthropic"
        ? settings?.anthropicApiKeyEnc
        : null
  return tryDecryptSecret(ciphertext) ?? undefined
}

/**
 * The model to use when nothing pins one. Codex follows its CLI configuration;
 * OpenCode honors OPENCODE_MODEL and otherwise falls back to its preferred free
 * model; every other provider uses its metadata default. The setup UIs replace
 * the OpenCode fallback with a model the installed CLI actually lists.
 */
function defaultModelFor(provider: AiProvider): string {
  if (provider === "codex-cli") return resolveCodexModelId()
  if (provider === "opencode-cli") return resolveOpenCodeModelId()
  return AI_PROVIDER_META[provider].defaultModel
}

function envModel(provider: AiProvider): string {
  const meta = AI_PROVIDER_META[provider]
  return process.env[meta.modelEnvVar] ?? defaultModelFor(provider)
}

export interface EffectiveAiConfig {
  provider: AiProvider
  model: string
  /** "db" when the AiSettings row supplies the provider and/or the model id. */
  source: "db" | "env"
  temperature: number | null
  maxOutputTokens: number | null
}

/**
 * Resolves what the next AI call will actually use. Base URLs are never sourced
 * from the DB. API keys can be (see `storedApiKey`), but are deliberately not
 * part of this return value — it is passed to the admin UI.
 *
 * `source` describes where the provider/model routing came from, not the key.
 */
export async function getEffectiveAiConfig(): Promise<EffectiveAiConfig> {
  const settings = await readAiSettings()

  const dbProvider =
    settings?.provider && isAiProvider(settings.provider) ? settings.provider : null
  const provider = dbProvider ?? envProvider(settings)
  const dbModel = settings?.model?.trim() ? settings.model.trim() : null

  return {
    provider,
    model: dbModel ?? envModel(provider),
    source: dbProvider || dbModel ? "db" : "env",
    temperature: settings?.temperature ?? null,
    maxOutputTokens: settings?.maxOutputTokens ?? null,
  }
}

/**
 * Thrown when a non-admin makes an AI call with no usable personal key. The
 * message is user-facing: every AI action surfaces `error.message` verbatim.
 */
export class AiKeyRequiredError extends Error {
  constructor(
    message = "Add your API key in Settings → AI to use AI features."
  ) {
    super(message)
    this.name = "AiKeyRequiredError"
  }
}

/**
 * Thrown when a caller has used up their rolling 24h AI request cap. Like
 * `AiKeyRequiredError` the message is user-facing and every AI entry point
 * surfaces it verbatim — without that a capped user would see "Something went
 * wrong" for up to a day with no way to tell why.
 */
export class AiDailyLimitError extends Error {
  constructor(message = "Daily AI request limit reached. Try again later.") {
    super(message)
    this.name = "AiDailyLimitError"
  }
}

/** What one call resolves to, including the key it must be made with. */
export interface ResolvedAiConfig {
  provider: AiProvider
  model: string
  /** "user" when a personal UserAiSettings row supplied provider/model/key. */
  source: "db" | "env" | "user"
  temperature: number | null
  maxOutputTokens: number | null
  /**
   * Decrypted key for this call. Undefined means "let the provider factory fall
   * back to the deployment key" — only ever the case on the admin path.
   */
  apiKey?: string
  /** Per-user override of the daily request cap; null = use the default. */
  dailyRequestLimit: number | null
  /** True when a model id was explicitly chosen, so the cheap tier must not override it. */
  modelPinned: boolean
}

interface UserAiContext {
  role: string
  aiDailyRequestLimit: number | null
  provider: string | null
  model: string | null
  /** Ciphertext as stored — never decrypted into the cache. */
  apiKeyEnc: string | null
}

/**
 * Per-user config cache. Same 60s TTL as the deployment settings cache, and the
 * same rule: only ciphertext is held, decryption happens at the point of use.
 */
const USER_CACHE_TTL_MS = 60_000
const USER_CACHE_MAX_ENTRIES = 500
const userCache = new Map<string, { value: UserAiContext | null; expiresAt: number }>()

/** Drops one user's cached row (or all of them) so the next call re-reads the DB. */
export function clearUserAiSettingsCache(userId?: string) {
  if (userId) userCache.delete(userId)
  else userCache.clear()
}

async function readUserAiContext(userId: string): Promise<UserAiContext | null> {
  const now = Date.now()
  const cached = userCache.get(userId)
  if (cached && cached.expiresAt > now) return cached.value

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      aiDailyRequestLimit: true,
      aiSettings: { select: { provider: true, model: true, apiKeyEnc: true } },
    },
  })

  const value: UserAiContext | null = user
    ? {
        role: user.role,
        aiDailyRequestLimit: user.aiDailyRequestLimit,
        provider: user.aiSettings?.provider ?? null,
        model: user.aiSettings?.model ?? null,
        apiKeyEnc: user.aiSettings?.apiKeyEnc ?? null,
      }
    : null

  // Naive cap: the map is a cache, so dropping the oldest inserted entry once it
  // is full is enough to keep a long-lived server from growing without bound.
  if (userCache.size >= USER_CACHE_MAX_ENTRIES) {
    const oldest = userCache.keys().next()
    if (!oldest.done) userCache.delete(oldest.value)
  }
  userCache.set(userId, { value, expiresAt: now + USER_CACHE_TTL_MS })
  return value
}

/** The user's own provider/model/key, or null when they have no usable one. */
function personalConfig(ctx: UserAiContext): {
  provider: UserAiProvider
  model: string
  apiKey?: string
  modelPinned: boolean
} | null {
  const provider = ctx.provider
  if (!provider || !isUserAiProvider(provider)) return null
  const apiKey = tryDecryptSecret(ctx.apiKeyEnc) ?? undefined

  const model = ctx.model?.trim() ? ctx.model.trim() : null
  return {
    provider,
    model: model ?? defaultModelFor(provider),
    apiKey,
    modelPinned: model !== null,
  }
}

/**
 * Resolves the config for an AI call.
 * Uses the user's saved provider/model/key when configured, or falls back to
 * deployment/environment configuration.
 */
export async function getEffectiveAiConfigForUser(
  userId: string | null | undefined
): Promise<ResolvedAiConfig> {
  if (!userId) throw new AiKeyRequiredError()

  const [ctx, settings] = await Promise.all([
    readUserAiContext(userId),
    readAiSettings(),
  ])

  const temperature = settings?.temperature ?? null
  const maxOutputTokens = settings?.maxOutputTokens ?? null
  const dailyRequestLimit = ctx?.aiDailyRequestLimit ?? null

  if (ctx) {
    const personal = personalConfig(ctx)
    if (personal) {
      return {
        provider: personal.provider,
        model: personal.model,
        source: "user",
        temperature,
        maxOutputTokens,
        apiKey: personal.apiKey,
        dailyRequestLimit,
        modelPinned: personal.modelPinned,
      }
    }
  }

  const base = await getEffectiveAiConfig()
  const meta = AI_PROVIDER_META[base.provider]
  return {
    ...base,
    apiKey: undefined,
    dailyRequestLimit,
    modelPinned: Boolean(settings?.model?.trim() || process.env[meta.modelEnvVar]),
  }
}

/** The deployment-wide env var fallback each cloud provider reads, if any. */
function envApiKey(provider: AiProvider): string | undefined {
  const envVar = AI_PROVIDER_META[provider].credentialEnvVar
  return envVar ? process.env[envVar] : undefined
}

/**
 * Rejects a `localOnly` provider in a deployed environment, where it dies deep
 * inside the provider instead (a subprocess spawn, or a connection refused to
 * localhost). This is also the only guard on the /admin/ai override, which can
 * otherwise set the provider to a localOnly value in production.
 *
 * `AiKeyRequiredError`, not a plain `Error`: it is the one class every AI entry
 * point surfaces verbatim, and a plain `Error` reaches the user as "Something
 * went wrong. Please try again.", which names neither the cause nor the fix.
 */
function assertProviderRunnable(provider: AiProvider, source: "db" | "env" | "user") {
  if (!AI_PROVIDER_META[provider].localOnly || !isServerlessDeploy()) return
  const origin =
    source === "db"
      ? "the AiSettings row written by /admin/ai"
      : "the AI_PROVIDER environment variable"
  throw new AiKeyRequiredError(
    `AI provider "${provider}" is local-development only and cannot run in a ` +
      `deployed environment. It was selected by ${origin}. Set it to "openai" ` +
      `or "anthropic" (with the matching API key) instead.`
  )
}

/**
 * Fails a misconfigured call deterministically, before any quota is reserved and
 * before a provider request is made. On top of the localOnly check it catches a
 * cloud provider with no key anywhere: the provider factories pass `undefined`
 * straight to the SDK, so that failure otherwise only arrives at request time,
 * as an opaque "Something went wrong" with a quota slot already spent.
 *
 * Local CLI providers are deliberately exempt from the key check: locally they
 * authenticate through a CLI session, not an env var.
 */
export async function assertAiConfigUsable(config: {
  provider: AiProvider
  source?: "db" | "env" | "user"
  apiKey?: string
}): Promise<void> {
  const { provider } = config
  const source = config.source ?? "env"
  const meta = AI_PROVIDER_META[provider]

  assertProviderRunnable(provider, source)
  if (meta.localOnly) return

  if (config.apiKey?.trim()) return
  if (!meta.credentialEnvVar) return

  const stored = meta.supportsStoredKey ? await storedApiKey(provider) : undefined
  if (stored?.trim() || envApiKey(provider)?.trim()) return

  if (source === "user") throw new AiKeyRequiredError()
  throw new AiKeyRequiredError(
    `AI provider "${provider}" has no API key. Set ${meta.credentialEnvVar} for this deployment, or pick a provider that has one.`
  )
}

/**
 * Builds the SDK model. Called with no argument it uses the deployment config;
 * `override` is what `ai-generate` passes so a per-user provider/model/key is
 * honoured without a second settings read.
 */
export async function getAIModel(override?: {
  provider: AiProvider
  model: string
  source?: "db" | "env" | "user"
  apiKey?: string
}) {
  const resolved = override ?? (await getEffectiveAiConfig())
  const { provider, model } = resolved
  const explicitKey = override?.apiKey

  // `ai-generate` has already run the fuller `assertAiConfigUsable` before
  // reserving quota; this repeat keeps the guard on a direct caller. The key
  // check stays out of here: this function is a factory, and building a model
  // object for an unconfigured provider is harmless until it is used.
  assertProviderRunnable(provider, resolved.source ?? "env")

  switch (provider) {
    case "openai":
      return getOpenAIModel(model, explicitKey ?? (await storedApiKey("openai")))
    case "ollama":
      return getOllamaModel(model)
    case "anthropic":
      return getAnthropicModel(model, explicitKey ?? (await storedApiKey("anthropic")))
    case "deepseek":
      // No deployment-wide stored key column for DeepSeek: it is either the
      // caller's own key or DEEPSEEK_API_KEY.
      return getDeepSeekModel(model, explicitKey)
    case "google":
      // No deployment-wide stored key column for Google: it is either the
      // caller's own key or GOOGLE_GENERATIVE_AI_API_KEY.
      return getGoogleModel(model, explicitKey)
    case "lmstudio":
      return getLMStudioModel(model)
    case "claude-code": {
      // Imported lazily so @anthropic-ai/claude-agent-sdk and its eight
      // per-platform binary packages are not traced into every serverless
      // function that touches AI (250MB unzipped function limit).
      const { getClaudeCodeModel } = await import("./ai-providers/claude-code")
      return getClaudeCodeModel(model)
    }
    case "codex-cli": {
      // Lazy for the same reason as claude-code: ai-sdk-provider-codex-cli
      // optionally bundles the @openai/codex binary, and the package is
      // ESM-only, so it must not be pulled into every AI-touching module.
      const { getCodexCliModel } = await import("./ai-providers/codex-cli")
      return getCodexCliModel(model)
    }
    case "opencode-cli": {
      // Lazy so the child_process/CLI plumbing is only loaded when this
      // provider is actually selected.
      const { getOpenCodeCliModel } = await import("./ai-providers/opencode-cli")
      return getOpenCodeCliModel(model)
    }
  }
}
