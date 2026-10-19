// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockTestAiConnection = vi.hoisted(() => vi.fn())

vi.mock("@/shared/lib/ai-generate", () => ({
  testAiConnection: mockTestAiConnection,
}))

vi.mock("@/shared/lib/ai-provider", () => ({
  AiKeyRequiredError: class AiKeyRequiredError extends Error {
    name = "AiKeyRequiredError"
  },
  AiDailyLimitError: class AiDailyLimitError extends Error {
    name = "AiDailyLimitError"
  },
}))

import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import {
  classifyProviderError,
  connectionFailureForDiagnostic,
  sanitizeProviderDetail,
  testProviderConnection,
} from "../ai-connection-test"
import type { ProviderDiagnostic } from "../provider-diagnostics"

function diagnostic(overrides: Partial<ProviderDiagnostic> = {}): ProviderDiagnostic {
  return {
    provider: "openai",
    status: "ready",
    reason: "ready",
    message: "A key is available.",
    configuredModel: "gpt-4o",
    ...overrides,
  }
}

beforeEach(() => {
  mockTestAiConnection.mockReset()
})

describe("connectionFailureForDiagnostic", () => {
  it("turns a missing CLI into install guidance with the official command", () => {
    const result = connectionFailureForDiagnostic(
      diagnostic({
        provider: "codex-cli",
        status: "unavailable",
        reason: "not-installed",
        configuredModel: "gpt-5.5",
      })
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("NOT_INSTALLED")
    expect(result.title).toContain("ChatGPT")
    expect(result.command).toBe("codex login")
    expect(result.docsUrl).toContain("openai.com")
    expect(result.guidance.length).toBeGreaterThan(0)
  })

  it("distinguishes a stopped local server from a missing model", () => {
    const stopped = connectionFailureForDiagnostic(
      diagnostic({
        provider: "ollama",
        status: "unavailable",
        reason: "not-running",
      })
    )
    const noModel = connectionFailureForDiagnostic(
      diagnostic({
        provider: "ollama",
        status: "needs-setup",
        reason: "no-models",
      })
    )

    expect(stopped.ok).toBe(false)
    expect(noModel.ok).toBe(false)
    if (stopped.ok || noModel.ok) return
    expect(stopped.code).toBe("LOCAL_NOT_RUNNING")
    expect(noModel.code).toBe("NO_LOCAL_MODEL")
  })

  it("asks for an API key with the provider's key page", () => {
    const result = connectionFailureForDiagnostic(
      diagnostic({
        provider: "google",
        status: "needs-setup",
        reason: "no-key",
      })
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("KEY_MISSING")
    expect(result.keyUrl).toContain("aistudio.google.com")
  })
})

describe("classifyProviderError", () => {
  it("maps a rejected API key to KEY_REJECTED", () => {
    const error = Object.assign(new Error("Unauthorized"), { statusCode: 401 })

    const result = classifyProviderError("openai", error)

    expect(result.code).toBe("KEY_REJECTED")
    expect(result.title).toContain("rejected")
  })

  it("treats a CLI 401 as an expired sign-in, not a bad key", () => {
    const error = Object.assign(new Error("Unauthorized"), { statusCode: 401 })

    const result = classifyProviderError("codex-cli", error)

    expect(result.code).toBe("NOT_SIGNED_IN")
  })

  it("maps 429 to RATE_LIMITED", () => {
    const error = Object.assign(new Error("Too many requests"), { statusCode: 429 })

    const result = classifyProviderError("anthropic", error)

    expect(result.code).toBe("RATE_LIMITED")
  })

  it("maps billing failures to BILLING", () => {
    const result = classifyProviderError(
      "openai",
      new Error("Your credit balance is too low")
    )

    expect(result.code).toBe("BILLING")
  })

  it("maps an abort to TIMEOUT", () => {
    const error = new Error("The operation was aborted")
    error.name = "AbortError"

    const result = classifyProviderError("ollama", error)

    expect(result.code).toBe("TIMEOUT")
  })

  it("maps a refused local connection to LOCAL_NOT_RUNNING", () => {
    const result = classifyProviderError(
      "lmstudio",
      new Error("connect ECONNREFUSED 127.0.0.1:1234")
    )

    expect(result.code).toBe("LOCAL_NOT_RUNNING")
  })

  it("maps a missing model response to MODEL_NOT_FOUND", () => {
    const error = Object.assign(new Error("model_not_found: gpt-nope"), {
      statusCode: 404,
    })

    const result = classifyProviderError("openai", error)

    expect(result.code).toBe("MODEL_NOT_FOUND")
  })

  it("maps the quota error class to DAILY_LIMIT", () => {
    const result = classifyProviderError("openai", new AiDailyLimitError())

    expect(result.code).toBe("DAILY_LIMIT")
  })

  it("maps a missing key error to KEY_MISSING", () => {
    const result = classifyProviderError("openai", new AiKeyRequiredError("no key"))

    expect(result.code).toBe("KEY_MISSING")
  })

  it("uses the provider's stderr to explain an unsupported model", () => {
    const error = Object.assign(new Error("Codex CLI exited with code 1"), {
      data: {
        stderr:
          "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.",
      },
    })

    const result = classifyProviderError("codex-cli", error)

    expect(result.code).toBe("MODEL_NOT_FOUND")
    expect(result.message).toContain("account cannot use")
    expect(result.detail).toContain("not supported")
  })

  it("reads a numeric status string from the provider error data", () => {
    const error = Object.assign(new Error("request failed"), {
      data: { code: "429" },
    })

    const result = classifyProviderError("openai", error)

    expect(result.code).toBe("RATE_LIMITED")
  })

  it("never echoes a credential-looking string in the detail", () => {
    const result = classifyProviderError(
      "openai",
      new Error("bad request with sk-abcdefgh12345678 and AIza1234567890abcdef")
    )

    expect(result.detail).not.toContain("sk-abcdefgh")
    expect(result.detail).not.toContain("AIza1234567890abcdef")
    expect(result.detail).toContain("[redacted]")
  })
})

describe("sanitizeProviderDetail", () => {
  it("collapses whitespace and bounds the length", () => {
    const detail = sanitizeProviderDetail(`${"a".repeat(400)}\n\nnext`)

    expect(detail.length).toBeLessThanOrEqual(240)
    expect(detail).not.toContain("\n")
  })
})

describe("testProviderConnection", () => {
  it("fails the preflight without spending an AI call", async () => {
    const result = await testProviderConnection(
      diagnostic({
        provider: "codex-cli",
        status: "needs-setup",
        reason: "not-signed-in",
      }),
      "user-1"
    )

    expect(result.ok).toBe(false)
    expect(mockTestAiConnection).not.toHaveBeenCalled()
  })

  it("runs the shared AI path and reports latency on success", async () => {
    mockTestAiConnection.mockResolvedValue({
      provider: "openai",
      model: "gpt-4o",
      latencyMs: 850,
      text: "OK",
    })

    const result = await testProviderConnection(diagnostic(), "user-1")

    expect(mockTestAiConnection).toHaveBeenCalledWith(
      "user-1",
      expect.any(AbortSignal)
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model).toBe("gpt-4o")
    expect(result.message).toContain("0.9s")
  })

  it("classifies a live provider failure instead of throwing", async () => {
    mockTestAiConnection.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { statusCode: 401 })
    )

    const result = await testProviderConnection(diagnostic(), "user-1")

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("KEY_REJECTED")
  })
})
