/**
 * Provider detection for first-run onboarding.
 *
 * Server-only: this module spawns the vendor CLIs and calls local servers. It is
 * deliberately separate from the connection test so detection can run on page
 * load (cheap, no AI quota) while the test stays an explicit user action.
 *
 * Safety rules:
 * - It never reads, copies or parses a credential file or token.
 * - CLI login state is taken from the vendor's own status command exit code.
 * - It only inspects whether an API key exists; the value never reaches here.
 * - Every command and HTTP call is bounded, so a broken setup cannot hang the
 *   onboarding page.
 */

import { execFile } from "node:child_process"
import os from "node:os"
import path from "node:path"
import {
  AI_PROVIDER_META,
  type AiProvider,
} from "@/shared/lib/ai-providers/constants"
import { resolveCodexModelId } from "@/shared/lib/ai-providers/codex-paths"
import { probeOpenCodeCli } from "@/shared/lib/ai-providers/opencode-models"

const COMMAND_TIMEOUT_MS = 2_500
const HTTP_TIMEOUT_MS = 2_000
const MAX_COMMAND_OUTPUT = 64 * 1024

export type ProviderSetupReason =
  | "ready"
  | "not-installed"
  | "not-signed-in"
  | "not-running"
  | "no-models"
  | "model-missing"
  | "no-key"
  | "unknown"

export interface ProviderDiagnostic {
  provider: AiProvider
  /** `ready` means the preflight passed; only the live test proves it works. */
  status: "ready" | "needs-setup" | "unavailable" | "unknown"
  reason: ProviderSetupReason
  /** Plain-language status, written for a non-technical user. */
  message: string
  /** Extra detail such as a model list. Never a credential. */
  detail?: string
  /** Local model names, when the provider exposes them. */
  models?: string[]
  /** The model id this install would use. */
  configuredModel: string
}

export interface ProviderDiagnosticOptions {
  /**
   * Providers with a decryptable stored key for this user. Callers compute this
   * from `getUserAiKeyStatus`, so this module never touches the database.
   */
  storedKeyProviders?: readonly string[]
  /** Providers whose credential environment variable is present. */
  envKeyProviders?: readonly string[]
}

interface CommandResult {
  ok: boolean
  stdout: string
  code: number | null
  notFound: boolean
}

/**
 * Adds the usual CLI install locations to PATH. An app launched from Explorer
 * on Windows inherits the login-shell PATH for the user, which does not always
 * include npm's global bin directory or the native installer's bin folder.
 */
function commandEnv(): NodeJS.ProcessEnv {
  const home = os.homedir()
  const extras = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
    path.join(home, ".local", "bin"),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Programs", "claude")
      : null,
  ].filter((entry): entry is string => Boolean(entry))

  return {
    ...process.env,
    NO_COLOR: "1",
    PATH: [...extras, process.env.PATH ?? ""].join(path.delimiter),
  }
}

/**
 * Runs a static command with a hard timeout. `shell` is only enabled on Windows,
 * where `codex` and `claude` are `.cmd` shims that `execFile` cannot execute
 * directly. Arguments are always literals supplied by this module.
 */
function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
        shell: process.platform === "win32",
        encoding: "utf8",
        maxBuffer: MAX_COMMAND_OUTPUT,
        env: commandEnv(),
      },
      (error, stdout) => {
        if (!error) {
          resolve({ ok: true, stdout: stdout ?? "", code: 0, notFound: false })
          return
        }
        const errno = error as NodeJS.ErrnoException & { code?: number | string }
        resolve({
          ok: false,
          stdout: stdout ?? "",
          code: typeof errno.code === "number" ? errno.code : null,
          notFound: errno.code === "ENOENT",
        })
      }
    )
  })
}

async function getJson(
  url: string
): Promise<{ ok: true; data: unknown } | { ok: false; reason: "unreachable" | "bad-response" }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      cache: "no-store",
    })
    if (!response.ok) return { ok: false, reason: "bad-response" }
    return { ok: true, data: await response.json() }
  } catch {
    return { ok: false, reason: "unreachable" }
  }
}

/** Ollama's OpenAI-compatible base is `/v1`; its native tags API is at the root. */
export function ollamaRootUrl(): string {
  const raw = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434/v1"
  return raw.replace(/\/v1\/?$/, "").replace(/\/+$/, "")
}

export function lmStudioBaseUrl(): string {
  const raw = process.env.LMSTUDIO_BASE_URL?.trim() || "http://localhost:1234/v1"
  return raw.replace(/\/+$/, "")
}

function configuredModel(provider: AiProvider): string {
  const meta = AI_PROVIDER_META[provider]
  if (process.env[meta.modelEnvVar]?.trim()) return process.env[meta.modelEnvVar]!.trim()
  if (provider === "codex-cli") return resolveCodexModelId()
  return meta.defaultModel
}

/** Ollama reports names with tags (`qwen2.5vl:7b`); `latest` is implicit. */
function modelMatches(installed: string, wanted: string): boolean {
  const normalize = (value: string) =>
    value.trim().toLowerCase().replace(/:latest$/, "")
  return normalize(installed) === normalize(wanted)
}

async function detectCodexCli(): Promise<ProviderDiagnostic> {
  const provider: AiProvider = "codex-cli"
  const model = configuredModel(provider)
  const version = await runCommand("codex", ["--version"])
  if (!version.ok) {
    return {
      provider,
      status: "unavailable",
      reason: "not-installed",
      message: "Codex CLI was not found on this computer.",
      detail:
        "Install it from OpenAI's Codex CLI guide, then sign in with your ChatGPT account.",
      configuredModel: model,
    }
  }

  const status = await runCommand("codex", ["login", "status"])
  if (!status.ok) {
    return {
      provider,
      status: "needs-setup",
      reason: "not-signed-in",
      message: "Codex CLI is installed, but you are not signed in yet.",
      detail: "Sign in with your ChatGPT Plus or Pro account, then test again.",
      configuredModel: model,
    }
  }

  return {
    provider,
    status: "ready",
    reason: "ready",
    message: "Codex CLI is installed and signed in.",
    configuredModel: model,
  }
}

async function detectClaudeCode(): Promise<ProviderDiagnostic> {
  const provider: AiProvider = "claude-code"
  const model = configuredModel(provider)
  const version = await runCommand("claude", ["--version"])
  if (!version.ok) {
    return {
      provider,
      status: "unavailable",
      reason: "not-installed",
      message: "Claude Code was not found on this computer.",
      detail:
        "Install it from Anthropic's Claude Code guide, then sign in with your Claude account.",
      configuredModel: model,
    }
  }

  // A deployment can also provide a long-lived OAuth token instead of a CLI
  // login. It is checked for presence only; the value is never read or logged.
  const hasEnvToken = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim())
  if (!hasEnvToken) {
    const status = await runCommand("claude", ["auth", "status"])
    if (!status.ok) {
      return {
        provider,
        status: "needs-setup",
        reason: "not-signed-in",
        message: "Claude Code is installed, but you are not signed in yet.",
        detail: "Sign in with your Claude Pro or Team account, then test again.",
        configuredModel: model,
      }
    }
  }

  return {
    provider,
    status: "ready",
    reason: "ready",
    message: "Claude Code is installed and signed in.",
    configuredModel: model,
  }
}

async function detectOpenCodeCli(): Promise<ProviderDiagnostic> {
  const provider: AiProvider = "opencode-cli"
  const model = configuredModel(provider)
  const probe = await probeOpenCodeCli()

  if (!probe.installed) {
    return {
      provider,
      status: "unavailable",
      reason: "not-installed",
      message: "The OpenCode CLI was not found on this computer.",
      detail:
        "Install OpenCode from opencode.ai, then run `opencode models` once to load its free models.",
      configuredModel: model,
    }
  }

  const free = probe.models.filter((entry) => entry.free)
  if (free.length === 0) {
    return {
      provider,
      status: "needs-setup",
      reason: "no-models",
      message: "OpenCode is installed, but it reports no free models.",
      detail: probe.error
        ? `${probe.error}. Run \`opencode models\` to refresh the catalog.`
        : "Run `opencode models` on this computer. If the list is empty, update the CLI or sign in with `opencode auth login`.",
      configuredModel: model,
    }
  }

  const ids = free.map((entry) => entry.id)
  if (model.trim() && !ids.includes(model.trim())) {
    return {
      provider,
      status: "needs-setup",
      reason: "model-missing",
      message: `OpenCode is installed, but "${model}" is not one of its free models.`,
      detail: `Available free models: ${ids.join(", ")}.`,
      models: ids,
      configuredModel: model,
    }
  }

  return {
    provider,
    status: "ready",
    reason: "ready",
    message: `OpenCode is installed with ${free.length} free model${free.length === 1 ? "" : "s"}.`,
    models: ids,
    configuredModel: model,
  }
}

async function detectOllama(): Promise<ProviderDiagnostic> {
  const provider: AiProvider = "ollama"
  const model = configuredModel(provider)
  const result = await getJson(`${ollamaRootUrl()}/api/tags`)

  if (!result.ok) {
    return {
      provider,
      status: "unavailable",
      reason: "not-running",
      message: "Ollama isn't running on this computer.",
      detail: "Open the Ollama app, wait for it to start, then test again.",
      configuredModel: model,
    }
  }

  const models = extractNames(result.data, "models", "name")
  if (models.length === 0) {
    return {
      provider,
      status: "needs-setup",
      reason: "no-models",
      message: "Ollama is running, but no local models are installed.",
      detail: "Download a model in Ollama, then test again.",
      configuredModel: model,
    }
  }

  if (!models.some((installed) => modelMatches(installed, model))) {
    return {
      provider,
      status: "needs-setup",
      reason: "model-missing",
      message: `Ollama is running, but the model "${model}" is not installed.`,
      detail: `Installed models: ${models.join(", ")}.`,
      models,
      configuredModel: model,
    }
  }

  return {
    provider,
    status: "ready",
    reason: "ready",
    message: `Ollama is running with ${models.length} model${models.length === 1 ? "" : "s"}.`,
    models,
    configuredModel: model,
  }
}

async function detectLmStudio(): Promise<ProviderDiagnostic> {
  const provider: AiProvider = "lmstudio"
  const model = configuredModel(provider)
  const result = await getJson(`${lmStudioBaseUrl()}/models`)

  if (!result.ok) {
    return {
      provider,
      status: "unavailable",
      reason: "not-running",
      message: "LM Studio's local server isn't running.",
      detail: "Open LM Studio, load a model, and start the local server, then test again.",
      configuredModel: model,
    }
  }

  const models = extractNames(result.data, "data", "id")
  if (models.length === 0) {
    return {
      provider,
      status: "needs-setup",
      reason: "no-models",
      message: "LM Studio's server is running, but no model is loaded.",
      detail: "Load a model in LM Studio, then test again.",
      configuredModel: model,
    }
  }

  if (!models.some((installed) => modelMatches(installed, model))) {
    return {
      provider,
      status: "needs-setup",
      reason: "model-missing",
      message: `LM Studio is running, but the model "${model}" is not loaded.`,
      detail: `Available models: ${models.join(", ")}.`,
      models,
      configuredModel: model,
    }
  }

  return {
    provider,
    status: "ready",
    reason: "ready",
    message: `LM Studio is running with ${models.length} model${models.length === 1 ? "" : "s"}.`,
    models,
    configuredModel: model,
  }
}

function extractNames(
  data: unknown,
  listKey: string,
  nameKey: string
): string[] {
  if (typeof data !== "object" || data === null) return []
  const list = (data as Record<string, unknown>)[listKey]
  if (!Array.isArray(list)) return []
  return list
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null
      const value = (entry as Record<string, unknown>)[nameKey]
      return typeof value === "string" ? value : null
    })
    .filter((value): value is string => Boolean(value))
}

function detectApiProvider(
  provider: AiProvider,
  options: ProviderDiagnosticOptions
): ProviderDiagnostic {
  const meta = AI_PROVIDER_META[provider]
  const model = configuredModel(provider)
  const hasStored = options.storedKeyProviders?.includes(provider) ?? false
  const hasEnv = options.envKeyProviders?.includes(provider) ?? false

  if (hasStored || hasEnv) {
    return {
      provider,
      status: "ready",
      reason: "ready",
      message: `A ${meta.label} API key is available.`,
      configuredModel: model,
    }
  }

  return {
    provider,
    status: "needs-setup",
    reason: "no-key",
    message: `No ${meta.label} API key has been added yet.`,
    detail: "Paste a key below. It is encrypted before it is stored.",
    configuredModel: model,
  }
}

/** Detects one provider. Never cached: callers may need a fresh result. */
export async function diagnoseProvider(
  provider: AiProvider,
  options: ProviderDiagnosticOptions = {}
): Promise<ProviderDiagnostic> {
  const meta = AI_PROVIDER_META[provider]

  if (!meta.localOnly) return detectApiProvider(provider, options)

  switch (provider) {
    case "codex-cli":
      return detectCodexCli()
    case "claude-code":
      return detectClaudeCode()
    case "opencode-cli":
      return detectOpenCodeCli()
    case "ollama":
      return detectOllama()
    case "lmstudio":
      return detectLmStudio()
    default:
      return {
        provider,
        status: "unknown",
        reason: "unknown",
        message: "RoleSpec could not check this provider.",
        configuredModel: configuredModel(provider),
      }
  }
}

/**
 * Short-lived cache for the page-level snapshot. Detection spawns CLIs, and
 * `router.refresh()` after the resume step would otherwise repeat that work for
 * an unchanged configuration. Actions use `diagnoseProvider` directly and are
 * never served from here.
 */
const SNAPSHOT_CACHE_TTL_MS = 30_000
let snapshotCache:
  | { key: string; expiresAt: number; value: Record<AiProvider, ProviderDiagnostic> }
  | null = null

export function clearProviderDiagnosticsCache(): void {
  snapshotCache = null
}

/** Detects a set of providers in parallel; failures stay isolated per provider. */
export async function diagnoseProviders(
  providers: readonly AiProvider[],
  options: ProviderDiagnosticOptions = {}
): Promise<Record<AiProvider, ProviderDiagnostic>> {
  const cacheKey = JSON.stringify({
    providers: [...providers].sort(),
    stored: [...(options.storedKeyProviders ?? [])].sort(),
    env: [...(options.envKeyProviders ?? [])].sort(),
    ollama: ollamaRootUrl(),
    lmstudio: lmStudioBaseUrl(),
  })
  const now = Date.now()
  if (snapshotCache && snapshotCache.expiresAt > now && snapshotCache.key === cacheKey) {
    return snapshotCache.value
  }

  const diagnostics = await Promise.all(
    providers.map(async (provider) => {
      try {
        return await diagnoseProvider(provider, options)
      } catch {
        return {
          provider,
          status: "unknown" as const,
          reason: "unknown" as const,
          message: "RoleSpec could not check this provider.",
          configuredModel: configuredModel(provider),
        }
      }
    })
  )

  const value = Object.fromEntries(
    diagnostics.map((diagnostic) => [diagnostic.provider, diagnostic])
  ) as Record<AiProvider, ProviderDiagnostic>

  snapshotCache = { key: cacheKey, value, expiresAt: now + SNAPSHOT_CACHE_TTL_MS }
  return value
}
