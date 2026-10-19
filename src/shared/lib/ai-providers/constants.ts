/**
 * Provider metadata shared by the runtime resolver (`ai-provider.ts`) and the
 * admin UI. Kept free of `prisma`/node imports so client components can import it.
 */

export const AI_PROVIDERS = [
  "openai",
  "anthropic",
  "deepseek",
  "google",
  "ollama",
  "lmstudio",
  "claude-code",
  "codex-cli",
] as const

export type AiProvider = (typeof AI_PROVIDERS)[number]

export const DEFAULT_AI_PROVIDER: AiProvider = "claude-code"

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value)
}

export const USER_AI_PROVIDERS = AI_PROVIDERS

export type UserAiProvider = AiProvider

export function isUserAiProvider(value: string): value is UserAiProvider {
  return isAiProvider(value)
}

export interface AiProviderMeta {
  label: string
  /** Env var holding the model id, and the hardcoded fallback used when unset. */
  modelEnvVar: string
  defaultModel: string
  /** Credential env var checked for presence in the admin health row; null = none needed. */
  credentialEnvVar: string | null
  /**
   * True when the provider's key can also be stored (encrypted) in AiSettings
   * through the admin UI, instead of only in the environment.
   */
  supportsStoredKey?: boolean
  /**
   * Cheaper model used for `tier: "light"` calls, when the caller has not pinned
   * a model of their own. Absent for local providers, where the model in use is
   * whatever the machine has loaded and cost is not a factor.
   */
  cheapModel?: string
  /** True for providers that cannot run in a serverless deployment. */
  localOnly: boolean
}

export const AI_PROVIDER_META: Record<AiProvider, AiProviderMeta> = {
  openai: {
    label: "OpenAI",
    modelEnvVar: "OPENAI_MODEL",
    defaultModel: "gpt-4o",
    credentialEnvVar: "OPENAI_API_KEY",
    localOnly: false,
    supportsStoredKey: true,
    cheapModel: "gpt-4o-mini",
  },
  anthropic: {
    label: "Anthropic",
    modelEnvVar: "ANTHROPIC_MODEL",
    defaultModel: "claude-opus-4-8",
    credentialEnvVar: "ANTHROPIC_API_KEY",
    localOnly: false,
    supportsStoredKey: true,
    cheapModel: "claude-haiku-4-5-20251001",
  },
  deepseek: {
    label: "DeepSeek",
    modelEnvVar: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-chat",
    credentialEnvVar: "DEEPSEEK_API_KEY",
    localOnly: false,
    // Deployment-wide DeepSeek credentials are env-only: `storedApiKey()` has no
    // AiSettings column for them. (Personal BYO keys are unaffected.)
    supportsStoredKey: false,
    cheapModel: "deepseek-chat",
  },
  google: {
    label: "Google Gemini",
    modelEnvVar: "GOOGLE_MODEL",
    defaultModel: "gemini-2.5-flash",
    credentialEnvVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    localOnly: false,
    // Deployment-wide Google credentials are env-only: `storedApiKey()` has no
    // AiSettings column for them. (Personal BYO keys are unaffected.)
    supportsStoredKey: false,
    cheapModel: "gemini-2.5-flash-lite",
  },
  ollama: {
    label: "Ollama",
    modelEnvVar: "OLLAMA_MODEL",
    defaultModel: "qwen2.5vl:7b",
    credentialEnvVar: null,
    localOnly: true,
  },
  lmstudio: {
    label: "LM Studio",
    modelEnvVar: "LMSTUDIO_MODEL",
    defaultModel: "qwen3:8b",
    credentialEnvVar: null,
    localOnly: true,
  },
  "claude-code": {
    label: "Claude Code",
    modelEnvVar: "CLAUDE_CODE_MODEL",
    defaultModel: "sonnet",
    credentialEnvVar: "CLAUDE_CODE_OAUTH_TOKEN",
    localOnly: true,
  },
  // Auth is the ChatGPT OAuth session that `codex login` writes to
  // ~/.codex/auth.json, so there is no credential env var to check.
  // `defaultModel` is only a last resort: runtime resolution prefers
  // CODEX_CLI_MODEL, then the CLI's own `~/.codex/config.toml` model, because
  // ChatGPT-account model ids retire faster than RoleSpec releases.
  "codex-cli": {
    label: "ChatGPT (Codex CLI)",
    modelEnvVar: "CODEX_CLI_MODEL",
    defaultModel: "gpt-6.1-sol",
    credentialEnvVar: null,
    localOnly: true,
  },
}
