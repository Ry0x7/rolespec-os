// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  saveUserAiSettings: vi.fn(),
  getUserAiKeyStatus: vi.fn(),
  diagnoseProvider: vi.fn(),
  testProviderConnection: vi.fn(),
  classifyProviderError: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mocks.auth }))
vi.mock("@/features/settings/services/user-ai-settings.service", () => ({
  saveUserAiSettings: mocks.saveUserAiSettings,
  getUserAiKeyStatus: mocks.getUserAiKeyStatus,
}))
vi.mock("@/features/onboarding/lib/provider-diagnostics", () => ({
  diagnoseProvider: mocks.diagnoseProvider,
}))
vi.mock("@/features/onboarding/lib/ai-connection-test", () => ({
  testProviderConnection: mocks.testProviderConnection,
  classifyProviderError: mocks.classifyProviderError,
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import {
  configureAndTestAiProvider,
  testSavedAiProvider,
} from "../ai-setup.actions"

const READY = {
  provider: "openai",
  status: "ready",
  reason: "ready",
  message: "A key is available.",
  configuredModel: "gpt-4o",
}

const SUCCESS = {
  ok: true,
  provider: "openai",
  providerLabel: "OpenAI",
  model: "gpt-4o",
  latencyMs: 500,
  message: "OpenAI answered in 0.5s.",
}

beforeEach(() => {
  // resetAllMocks also drops implementations, so a rejected save in one test
  // cannot leak into the next one.
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } })
  mocks.getUserAiKeyStatus.mockResolvedValue({
    provider: "openai",
    model: null,
    configured: true,
    envConfigured: false,
    last4: "abcd",
  })
  mocks.diagnoseProvider.mockResolvedValue(READY)
  mocks.testProviderConnection.mockResolvedValue(SUCCESS)
})

describe("configureAndTestAiProvider", () => {
  it("refuses without a session and stores nothing", async () => {
    mocks.auth.mockResolvedValue(null)

    const result = await configureAndTestAiProvider({ provider: "openai" })

    expect(result.saved).toBe(false)
    expect(mocks.saveUserAiSettings).not.toHaveBeenCalled()
    expect(mocks.testProviderConnection).not.toHaveBeenCalled()
  })

  it("saves the key through the encrypted settings service, then tests", async () => {
    const result = await configureAndTestAiProvider({
      provider: "openai",
      model: "  gpt-4.1  ",
      apiKey: "  sk-test-key  ",
    })

    expect(mocks.saveUserAiSettings).toHaveBeenCalledWith("user-1", {
      provider: "openai",
      model: "gpt-4.1",
      apiKey: "sk-test-key",
    })
    expect(mocks.diagnoseProvider).toHaveBeenCalledWith("openai", {
      storedKeyProviders: ["openai"],
      envKeyProviders: [],
    })
    expect(mocks.testProviderConnection).toHaveBeenCalledWith(READY, "user-1")
    expect(result).toEqual({ test: SUCCESS, saved: true })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/onboarding")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/ai")
  })

  it("does not send an empty key or model to the settings service", async () => {
    await configureAndTestAiProvider({
      provider: "ollama",
      model: "   ",
      apiKey: "   ",
    })

    expect(mocks.saveUserAiSettings).toHaveBeenCalledWith("user-1", {
      provider: "ollama",
      model: null,
      apiKey: undefined,
    })
  })

  it("reports a save failure without claiming the choice was saved", async () => {
    mocks.saveUserAiSettings.mockRejectedValue(new Error("ENCRYPTION_KEY missing"))

    const result = await configureAndTestAiProvider({
      provider: "openai",
      apiKey: "sk-test-key",
    })

    expect(result.saved).toBe(false)
    expect(result.saveError).toContain("couldn't save")
    expect(result.test.ok).toBe(false)
    expect(mocks.testProviderConnection).not.toHaveBeenCalled()
  })

  it("returns the classified preflight failure while keeping the saved choice", async () => {
    const failure = {
      ok: false,
      code: "NOT_SIGNED_IN",
      title: "You're not signed in to ChatGPT via Codex CLI yet.",
      message: "Sign in first.",
      guidance: ["Run codex login."],
      provider: "codex-cli",
    }
    mocks.getUserAiKeyStatus.mockResolvedValue({
      provider: "codex-cli",
      model: null,
      configured: false,
      envConfigured: false,
    })
    mocks.diagnoseProvider.mockResolvedValue({
      provider: "codex-cli",
      status: "needs-setup",
      reason: "not-signed-in",
      message: "Not signed in.",
      configuredModel: "gpt-5.5",
    })
    mocks.testProviderConnection.mockResolvedValue(failure)

    const result = await configureAndTestAiProvider({ provider: "codex-cli" })

    expect(result.saved).toBe(true)
    expect(result.test).toEqual(failure)
  })

  it("rejects an unknown provider before touching the database", async () => {
    const result = await configureAndTestAiProvider({ provider: "not-a-provider" })

    expect(result.saved).toBe(false)
    expect(mocks.saveUserAiSettings).not.toHaveBeenCalled()
  })
})

describe("testSavedAiProvider", () => {
  it("asks for a choice when none is saved", async () => {
    mocks.getUserAiKeyStatus.mockResolvedValue({
      provider: null,
      model: null,
      configured: false,
      envConfigured: false,
    })

    const result = await testSavedAiProvider()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("KEY_MISSING")
    expect(mocks.diagnoseProvider).not.toHaveBeenCalled()
  })

  it("re-tests the saved provider without rewriting settings", async () => {
    const result = await testSavedAiProvider()

    expect(mocks.saveUserAiSettings).not.toHaveBeenCalled()
    expect(mocks.diagnoseProvider).toHaveBeenCalledWith("openai", {
      storedKeyProviders: ["openai"],
      envKeyProviders: [],
    })
    expect(result).toEqual(SUCCESS)
  })

  it("classifies an unexpected failure instead of throwing", async () => {
    mocks.diagnoseProvider.mockRejectedValue(new Error("boom"))
    mocks.classifyProviderError.mockReturnValue({
      ok: false,
      code: "PROVIDER_ERROR",
      title: "OpenAI could not complete the test.",
      message: "Provider error.",
      guidance: [],
      provider: "openai",
    })

    const result = await testSavedAiProvider()

    expect(result.ok).toBe(false)
    expect(mocks.classifyProviderError).toHaveBeenCalledWith("openai", expect.any(Error))
  })
})
