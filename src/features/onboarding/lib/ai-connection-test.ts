/**
 * Turns a provider setup state / thrown provider error into guidance a
 * non-technical user can act on.
 *
 * The connection test itself runs through `testAiConnection()` in
 * `src/shared/lib/ai-generate.ts`, so it uses the same resolver, encryption
 * path, quota reservation and usage accounting as every feature call. This
 * module is the translation layer only.
 */

import {
  AiDailyLimitError,
  AiKeyRequiredError,
} from "@/shared/lib/ai-provider"
import { AI_PROVIDER_META, type AiProvider } from "@/shared/lib/ai-providers/constants"
import { testAiConnection } from "@/shared/lib/ai-generate"
import { aiSetupGuideFor } from "../constants/ai-setup"
import type { ProviderDiagnostic } from "./provider-diagnostics"

/** Live test bound. Local models can be slow to load on first use. */
export const CONNECTION_TEST_TIMEOUT_MS = 60_000

export type AiConnectionFailureCode =
  | "NOT_INSTALLED"
  | "NOT_SIGNED_IN"
  | "LOCAL_NOT_RUNNING"
  | "NO_LOCAL_MODEL"
  | "MODEL_NOT_FOUND"
  | "KEY_MISSING"
  | "KEY_REJECTED"
  | "RATE_LIMITED"
  | "BILLING"
  | "DAILY_LIMIT"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "UNKNOWN"

export interface AiConnectionTestFailure {
  ok: false
  code: AiConnectionFailureCode
  /** Short heading, e.g. "Codex CLI is not installed." */
  title: string
  /** One or two sentences of explanation. */
  message: string
  /** Ordered next steps in normal language. */
  guidance: string[]
  /** Null when the failure happened before a provider was known. */
  provider: AiProvider | null
  /** Official command, when the fix is one. */
  command?: string
  docsUrl?: string
  keyUrl?: string
  /** Sanitized provider output for support, never a credential. */
  detail?: string
}

export interface AiConnectionTestSuccess {
  ok: true
  provider: AiProvider
  providerLabel: string
  model: string
  latencyMs: number
  message: string
}

export type AiConnectionTestResult =
  | AiConnectionTestSuccess
  | AiConnectionTestFailure

/** Human name used in onboarding copy. */
export function providerDisplayName(provider: AiProvider): string {
  switch (provider) {
    case "codex-cli":
      return "ChatGPT via Codex CLI"
    case "claude-code":
      return "Claude via Claude Code"
    default:
      return AI_PROVIDER_META[provider].label
  }
}

function guideLinks(provider: AiProvider) {
  const guide = aiSetupGuideFor(provider)
  return {
    ...(guide?.command ? { command: guide.command } : {}),
    ...(guide?.docsUrl ? { docsUrl: guide.docsUrl } : {}),
    ...(guide?.keyUrl ? { keyUrl: guide.keyUrl } : {}),
  }
}

function guideSteps(provider: AiProvider): string[] {
  return aiSetupGuideFor(provider)?.steps ?? ["Check the setup and try again."]
}

/** Preflight failure derived from detection, without spending an AI call. */
export function connectionFailureForDiagnostic(
  diagnostic: ProviderDiagnostic
): AiConnectionTestFailure {
  const provider = diagnostic.provider
  const name = providerDisplayName(provider)
  const links = guideLinks(provider)

  switch (diagnostic.reason) {
    case "not-installed":
      return {
        ok: false,
        code: "NOT_INSTALLED",
        title: `${name} is not installed.`,
        message:
          "RoleSpec found the option but could not find the program it needs on this computer.",
        guidance: guideSteps(provider),
        provider,
        ...links,
      }
    case "not-signed-in":
      return {
        ok: false,
        code: "NOT_SIGNED_IN",
        title: `You're not signed in to ${name} yet.`,
        message:
          "The program is installed, but it needs your own account sign-in before RoleSpec can use it.",
        guidance: guideSteps(provider),
        provider,
        ...links,
      }
    case "not-running":
      return {
        ok: false,
        code: "LOCAL_NOT_RUNNING",
        title: `${name} isn't running.`,
        message:
          "RoleSpec could not reach the local AI server. It must be running on this computer.",
        guidance: guideSteps(provider),
        provider,
        ...links,
      }
    case "no-models":
      return {
        ok: false,
        code: "NO_LOCAL_MODEL",
        title: `No local model is available in ${name}.`,
        message:
          "The local server is running, but there is no model downloaded for it to use.",
        guidance: [
          ...guideSteps(provider),
          "Model downloads can be several gigabytes. RoleSpec will not download one for you.",
        ],
        provider,
        ...links,
      }
    case "model-missing":
      return {
        ok: false,
        code: "MODEL_NOT_FOUND",
        title: `The model "${diagnostic.configuredModel}" isn't available.`,
        message: `RoleSpec is configured to use that model, but ${name} does not have it.`,
        guidance: [
          ...guideSteps(provider),
          `Or choose an installed model: ${diagnostic.models?.join(", ") || "none reported"}.`,
        ],
        provider,
        ...links,
      }
    case "no-key":
      return {
        ok: false,
        code: "KEY_MISSING",
        title: `Add your ${name} API key.`,
        message:
          "AI features need a key from the provider. The key is encrypted before it is stored on this computer.",
        guidance: [
          "Create an API key on the provider's website.",
          "Paste it into the key field and test again.",
        ],
        provider,
        ...links,
      }
    default:
      return {
        ok: false,
        code: "UNKNOWN",
        title: `RoleSpec couldn't check ${name}.`,
        message: diagnostic.message,
        guidance: guideSteps(provider),
        provider,
        ...links,
      }
  }
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null
  const record = error as Record<string, unknown>
  const data =
    typeof record.data === "object" && record.data !== null
      ? (record.data as Record<string, unknown>)
      : null

  for (const key of ["statusCode", "status"] as const) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  for (const key of ["code", "status", "statusCode"] as const) {
    const value = data?.[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value)
  }
  return null
}

/**
 * Provider errors carry diagnostics in different places: the API error class
 * uses `data.stderr`, cloud SDKs use `responseBody`, and the CLI providers log a
 * structured event. Collect them so classification sees the real cause instead
 * of only "exited with code 1".
 */
function providerErrorDetail(error: unknown): string {
  if (typeof error !== "object" || error === null) return ""
  const data = (error as Record<string, unknown>).data
  if (typeof data !== "object" || data === null) return ""

  return (["stderr", "message", "responseBody", "body"] as const)
    .map((key) => (data as Record<string, unknown>)[key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : ""
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Removes anything that looks like a credential before provider output is
 * shown to the user or written to logs. The SDKs do not normally echo keys, but
 * this is the one place unknown error text becomes user-visible.
 */
export function sanitizeProviderDetail(text: string): string {
  return text
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\bAIza[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240)
}

function failure(
  provider: AiProvider | null,
  code: AiConnectionFailureCode,
  title: string,
  message: string,
  guidance: string[],
  detail?: string
): AiConnectionTestFailure {
  return {
    ok: false,
    code,
    title,
    message,
    guidance,
    provider,
    ...(provider ? guideLinks(provider) : {}),
    ...(detail ? { detail: sanitizeProviderDetail(detail) } : {}),
  }
}

function isCliProvider(provider: AiProvider): boolean {
  return provider === "claude-code" || provider === "codex-cli"
}

function isLocalServerProvider(provider: AiProvider): boolean {
  return provider === "ollama" || provider === "lmstudio"
}

/**
 * Classifies a provider failure. Exported for tests; the messages are the
 * contract the onboarding UI renders verbatim.
 */
export function classifyProviderError(
  provider: AiProvider,
  error: unknown
): AiConnectionTestFailure {
  const name = providerDisplayName(provider)
  const message = errorMessage(error)
  const detail = providerErrorDetail(error)
  // Classify on everything the provider returned, not just the top-level
  // message: the CLI providers often only put the real cause in stderr.
  const lower = `${message} ${detail}`.toLowerCase()
  const status = errorStatus(error)

  if (error instanceof AiDailyLimitError) {
    return failure(
      provider,
      "DAILY_LIMIT",
      "The daily AI limit has been reached.",
      "RoleSpec stops runaway usage with a daily request cap. Try again after the 24-hour window, or raise the limit in Settings.",
      ["You can keep working on your resume and tracking without AI in the meantime."]
    )
  }
  if (error instanceof AiKeyRequiredError) {
    return failure(
      provider,
      "KEY_MISSING",
      `AI setup for ${name} is incomplete.`,
      message,
      ["Finish the setup above, then test again."]
    )
  }

  if (
    errorName(error) === "AbortError" ||
    errorName(error) === "TimeoutError" ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("aborted")
  ) {
    return failure(
      provider,
      "TIMEOUT",
      `${name} did not answer in time.`,
      "The provider started but did not finish within a minute. A local model may still be loading, or the network may be slow.",
      ["Wait a moment and test again.", "If this keeps happening, check the provider's status page or logs."]
    )
  }

  // A CLI session failing with 401/403 is an expired sign-in, not a bad API key.
  if (isCliProvider(provider)) {
    if (
      status === 401 ||
      status === 403 ||
      lower.includes("not logged in") ||
      lower.includes("not signed in") ||
      lower.includes("login required") ||
      lower.includes("unauthorized")
    ) {
      return failure(
        provider,
        "NOT_SIGNED_IN",
        `You're not signed in to ${name} yet.`,
        "The installed program rejected the request because its sign-in is missing or expired.",
        ["Sign in again with the provider's official command.", "Then test the connection again."]
      )
    }
    if (lower.includes("enoent") || lower.includes("not found")) {
      return failure(
        provider,
        "NOT_INSTALLED",
        `${name} is not installed.`,
        "RoleSpec could not start the program it needs.",
        guideSteps(provider)
      )
    }
  }

  if (status === 401 || status === 403) {
    return failure(
      provider,
      "KEY_REJECTED",
      `${name} rejected the API key.`,
      "The key was saved, but the provider refused it. It may be mistyped, revoked, or from a different account.",
      ["Create a new key on the provider's website.", "Paste it above and test again."],
      message
    )
  }

  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return failure(
      provider,
      "RATE_LIMITED",
      `${name} is rate-limiting requests.`,
      "The provider is temporarily refusing more requests from this account.",
      ["Wait a minute and test again.", "If it persists, check the provider's usage dashboard."],
      message
    )
  }

  if (
    status === 402 ||
    lower.includes("insufficient") ||
    lower.includes("billing") ||
    lower.includes("credit balance") ||
    lower.includes("quota exceeded")
  ) {
    return failure(
      provider,
      "BILLING",
      `${name} says the account has no available credit.`,
      "The key is valid, but the provider will not serve requests until billing or credit is fixed.",
      ["Check the provider's billing page.", "Try a subscription option or a local model instead."],
      message
    )
  }

  if (
    lower.includes("model") &&
    (lower.includes("model not found") ||
      lower.includes("model_not_found") ||
      lower.includes("no such model") ||
      lower.includes("unknown model") ||
      lower.includes("does not exist") ||
      lower.includes("not available") ||
      lower.includes("not supported"))
  ) {
    return failure(
      provider,
      "MODEL_NOT_FOUND",
      `The selected model isn't available for ${name}.`,
      isCliProvider(provider)
        ? "This account cannot use the model RoleSpec sent. Codex model names change often; follow the model configured in the CLI rather than pinning an old one."
        : "The provider rejected the model name. Use the provider's default model unless you intentionally chose another one.",
      isCliProvider(provider)
        ? [
            "Run `codex doctor` (or `claude auth status`) to check the CLI's configured model.",
            "If you pinned a model under Advanced, clear it so the CLI default is used.",
          ]
        : ["Clear the model field to use the default.", "Save the provider again and test."],
      `${message} ${detail}`.trim()
    )
  }

  if (
    isLocalServerProvider(provider) &&
    (lower.includes("econnrefused") ||
      lower.includes("fetch failed") ||
      lower.includes("econnreset") ||
      lower.includes("enotfound"))
  ) {
    return failure(
      provider,
      "LOCAL_NOT_RUNNING",
      `${name} isn't running.`,
      "RoleSpec could not connect to the local server. Start the app and test again.",
      guideSteps(provider)
    )
  }

  if (lower.includes("enoent") || lower.includes("command not found")) {
    return failure(
      provider,
      "NOT_INSTALLED",
      `${name} is not installed.`,
      "RoleSpec could not start the program it needs.",
      guideSteps(provider)
    )
  }

  return failure(
    provider,
    "PROVIDER_ERROR",
    `${name} could not complete the test.`,
    "The provider returned an error instead of an answer.",
    [
      "Check that the provider is set up correctly and test again.",
      "If it keeps failing, open Settings → AI and choose another option.",
    ],
    message
  )
}

/**
 * Runs the live test for an already-saved provider configuration.
 *
 * The provider/model/key are resolved by the shared layer, not passed here: the
 * onboarding action saves the choice first, which is also what makes a failed
 * test recoverable (the key is already encrypted and the user can replace it).
 */
export async function testProviderConnection(
  diagnostic: ProviderDiagnostic,
  userId: string
): Promise<AiConnectionTestResult> {
  if (diagnostic.status !== "ready") {
    return connectionFailureForDiagnostic(diagnostic)
  }

  try {
    const result = await testAiConnection(
      userId,
      AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS)
    )
    const seconds = Math.max(0.1, Math.round(result.latencyMs / 100) / 10)
    return {
      ok: true,
      provider: diagnostic.provider,
      providerLabel: providerDisplayName(diagnostic.provider),
      model: result.model,
      latencyMs: result.latencyMs,
      message: `Answered in ${seconds}s.`,
    }
  } catch (error) {
    return classifyProviderError(diagnostic.provider, error)
  }
}
