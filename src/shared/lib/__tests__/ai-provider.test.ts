import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import os from "node:os"
import path from "node:path"

// Keep model resolution deterministic: without this, a developer's real
// ~/.codex/config.toml would decide the expected default in these tests.
const TEST_CODEX_HOME = path.join(os.tmpdir(), "rolespec-test-codex-home-missing")

const mockOpenAIModel = vi.fn((modelId: string) => ({ modelId }))
const mockCreateOpenAI = vi.fn(() => mockOpenAIModel)
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mockCreateOpenAI,
}))

const mockClaudeCodeModel = vi.fn((modelId: string) => ({ modelId }))
const mockCreateClaudeCode = vi.fn(() => mockClaudeCodeModel)
vi.mock("ai-sdk-provider-claude-code", () => ({
  createClaudeCode: mockCreateClaudeCode,
}))

const mockCodexModel = vi.fn((modelId: string) => ({ modelId }))
const mockCreateCodexExec = vi.fn(() => mockCodexModel)
vi.mock("ai-sdk-provider-codex-cli", () => ({
  createCodexExec: mockCreateCodexExec,
}))

const mockAnthropicModel = vi.fn((modelId: string) => ({ modelId }))
const mockCreateAnthropic = vi.fn(() => mockAnthropicModel)
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mockCreateAnthropic,
}))

const mockGoogleModel = vi.fn((modelId: string) => ({ modelId }))
const mockCreateGoogle = vi.fn(() => mockGoogleModel)
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: mockCreateGoogle,
}))

// The real SDK is heavy and this suite calls vi.resetModules() before every
// test, so it would be re-imported dozens of times.
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}))

const mockFindUnique = vi.fn(async () => null as Record<string, unknown> | null)
const mockUserFindUnique = vi.fn(async () => null as Record<string, unknown> | null)
vi.mock("../prisma", () => ({
  prisma: {
    aiSettings: { findUnique: mockFindUnique },
    user: { findUnique: mockUserFindUnique },
  },
}))

describe("getAIModel", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    mockFindUnique.mockReset()
    mockFindUnique.mockResolvedValue(null)
    mockCreateOpenAI.mockClear()
    mockOpenAIModel.mockClear()
    mockCreateClaudeCode.mockClear()
    mockClaudeCodeModel.mockClear()
    mockCreateAnthropic.mockClear()
    mockAnthropicModel.mockClear()
    mockCreateCodexExec.mockClear()
    mockCodexModel.mockClear()
    mockCreateGoogle.mockClear()
    mockGoogleModel.mockClear()
    process.env = {
      ...originalEnv,
      AUTH_SECRET: "test-auth-secret-value",
      CODEX_HOME: TEST_CODEX_HOME,
    }
    delete process.env.CODEX_CLI_MODEL
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("defaults to claude-code when AI_PROVIDER is unset", async () => {
    delete process.env.AI_PROVIDER
    delete process.env.CLAUDE_CODE_MODEL
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateClaudeCode).toHaveBeenCalled()
    expect(mockClaudeCodeModel).toHaveBeenCalledWith("sonnet")
  })

  it("uses lmstudio env overrides when AI_PROVIDER=lmstudio", async () => {
    process.env.AI_PROVIDER = "lmstudio"
    process.env.LMSTUDIO_BASE_URL = "http://custom:1234/v1"
    process.env.LMSTUDIO_MODEL = "custom-model"
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      baseURL: "http://custom:1234/v1",
      apiKey: "lm-studio",
    })
    expect(mockOpenAIModel).toHaveBeenCalledWith("custom-model")
  })

  it("defaults the lmstudio base URL and model id when unset", async () => {
    process.env.AI_PROVIDER = "lmstudio"
    delete process.env.LMSTUDIO_BASE_URL
    delete process.env.LMSTUDIO_MODEL
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      baseURL: "http://localhost:1234/v1",
      apiKey: "lm-studio",
    })
    expect(mockOpenAIModel).toHaveBeenCalledWith("qwen3:8b")
  })

  it("uses openai when AI_PROVIDER=openai", async () => {
    process.env.AI_PROVIDER = "openai"
    process.env.OPENAI_API_KEY = "sk-test"
    process.env.OPENAI_MODEL = "gpt-4o-mini"
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: "sk-test" })
    expect(mockOpenAIModel).toHaveBeenCalledWith("gpt-4o-mini")
  })

  it("defaults the openai model id to gpt-4o", async () => {
    process.env.AI_PROVIDER = "openai"
    delete process.env.OPENAI_MODEL
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockOpenAIModel).toHaveBeenCalledWith("gpt-4o")
  })

  it("uses ollama when AI_PROVIDER=ollama", async () => {
    process.env.AI_PROVIDER = "ollama"
    process.env.OLLAMA_BASE_URL = "http://custom-ollama:11434/v1"
    process.env.OLLAMA_MODEL = "llama3.1:8b"
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      baseURL: "http://custom-ollama:11434/v1",
      apiKey: "ollama",
    })
    expect(mockOpenAIModel).toHaveBeenCalledWith("llama3.1:8b")
  })

  it("defaults ollama base URL and model id when unset", async () => {
    process.env.AI_PROVIDER = "ollama"
    delete process.env.OLLAMA_BASE_URL
    delete process.env.OLLAMA_MODEL
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      baseURL: "http://localhost:11434/v1",
      apiKey: "ollama",
    })
    expect(mockOpenAIModel).toHaveBeenCalledWith("qwen2.5vl:7b")
  })

  it("uses claude-code when AI_PROVIDER=claude-code", async () => {
    process.env.AI_PROVIDER = "claude-code"
    process.env.CLAUDE_CODE_MODEL = "opus"
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateClaudeCode).toHaveBeenCalled()
    expect(mockClaudeCodeModel).toHaveBeenCalledWith("opus")
  })

  it("defaults the claude-code model id to sonnet", async () => {
    process.env.AI_PROVIDER = "claude-code"
    delete process.env.CLAUDE_CODE_MODEL
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockClaudeCodeModel).toHaveBeenCalledWith("sonnet")
  })

  it("uses anthropic when AI_PROVIDER=anthropic", async () => {
    process.env.AI_PROVIDER = "anthropic"
    process.env.ANTHROPIC_API_KEY = "sk-ant-test"
    process.env.ANTHROPIC_MODEL = "claude-sonnet-4-5"
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-test" })
    expect(mockAnthropicModel).toHaveBeenCalledWith("claude-sonnet-4-5")
  })

  it("defaults the anthropic model id to claude-opus-4-8", async () => {
    process.env.AI_PROVIDER = "anthropic"
    delete process.env.ANTHROPIC_MODEL
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockAnthropicModel).toHaveBeenCalledWith("claude-opus-4-8")
  })

  it("uses codex-cli when AI_PROVIDER=codex-cli", async () => {
    process.env.AI_PROVIDER = "codex-cli"
    process.env.CODEX_CLI_MODEL = "gpt-5.2-codex"
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateCodexExec).toHaveBeenCalled()
    expect(mockCodexModel).toHaveBeenCalledWith("gpt-5.2-codex")
  })

  it("falls back to the current codex-cli model when no CLI config exists", async () => {
    process.env.AI_PROVIDER = "codex-cli"
    process.env.CODEX_HOME = TEST_CODEX_HOME
    delete process.env.CODEX_CLI_MODEL
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCodexModel).toHaveBeenCalledWith("gpt-6.1-sol")
  })

  it("prefers the AiSettings API key over the env var for openai", async () => {
    process.env.AI_PROVIDER = "openai"
    process.env.OPENAI_API_KEY = "sk-from-env"
    const { encryptSecret } = await import("../secret-box")
    mockFindUnique.mockResolvedValue({
      provider: null,
      model: null,
      temperature: null,
      maxOutputTokens: null,
      openaiApiKeyEnc: encryptSecret("sk-from-db"),
      anthropicApiKeyEnc: null,
    })
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: "sk-from-db" })
  })

  it("prefers the AiSettings API key over the env var for anthropic", async () => {
    process.env.AI_PROVIDER = "anthropic"
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env"
    const { encryptSecret } = await import("../secret-box")
    mockFindUnique.mockResolvedValue({
      provider: null,
      model: null,
      temperature: null,
      maxOutputTokens: null,
      openaiApiKeyEnc: null,
      anthropicApiKeyEnc: encryptSecret("sk-ant-from-db"),
    })
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-from-db" })
  })

  it("falls back to the env key when the stored key cannot be decrypted", async () => {
    process.env.AI_PROVIDER = "openai"
    process.env.OPENAI_API_KEY = "sk-from-env"
    mockFindUnique.mockResolvedValue({
      provider: null,
      model: null,
      temperature: null,
      maxOutputTokens: null,
      openaiApiKeyEnc: "v1.bogus.bogus.bogus",
      anthropicApiKeyEnc: null,
    })
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: "sk-from-env" })
  })

  it("auto-picks openai from a stored key when AI_PROVIDER is unset", async () => {
    delete process.env.AI_PROVIDER
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    const { encryptSecret } = await import("../secret-box")
    mockFindUnique.mockResolvedValue({
      provider: null,
      model: null,
      temperature: null,
      maxOutputTokens: null,
      openaiApiKeyEnc: encryptSecret("sk-from-db"),
      anthropicApiKeyEnc: null,
    })
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateClaudeCode).not.toHaveBeenCalled()
    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: "sk-from-db" })
  })

  it("lets the AiSettings row override the env provider and model", async () => {
    process.env.AI_PROVIDER = "claude-code"
    mockFindUnique.mockResolvedValue({
      provider: "openai",
      model: "gpt-5-mini",
      temperature: null,
      maxOutputTokens: null,
    })
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockCreateClaudeCode).not.toHaveBeenCalled()
    expect(mockOpenAIModel).toHaveBeenCalledWith("gpt-5-mini")
  })

  it("falls back to env when the AiSettings columns are null", async () => {
    process.env.AI_PROVIDER = "openai"
    process.env.OPENAI_MODEL = "gpt-4o-mini"
    mockFindUnique.mockResolvedValue({
      provider: null,
      model: null,
      temperature: 0.7,
      maxOutputTokens: 2048,
    })
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockOpenAIModel).toHaveBeenCalledWith("gpt-4o-mini")
  })

  it("falls back to env when the AiSettings read throws", async () => {
    process.env.AI_PROVIDER = "openai"
    process.env.OPENAI_MODEL = "gpt-4o-mini"
    mockFindUnique.mockRejectedValue(new Error("relation does not exist"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { getAIModel } = await import("../ai-provider")

    await getAIModel()

    expect(mockOpenAIModel).toHaveBeenCalledWith("gpt-4o-mini")
    expect(consoleError).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })
})

describe("AiSettings cache", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    mockFindUnique.mockReset()
    mockFindUnique.mockResolvedValue(null)
    mockOpenAIModel.mockClear()
    process.env = { ...originalEnv }
    process.env.AI_PROVIDER = "openai"
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = originalEnv
  })

  it("reads the DB once for repeated calls inside the TTL", async () => {
    const { getEffectiveAiConfig } = await import("../ai-provider")

    await getEffectiveAiConfig()
    await getEffectiveAiConfig()
    await getEffectiveAiConfig()

    expect(mockFindUnique).toHaveBeenCalledTimes(1)
  })

  it("re-reads the DB after the 60s TTL expires", async () => {
    vi.useFakeTimers()
    const { getEffectiveAiConfig } = await import("../ai-provider")

    await getEffectiveAiConfig()
    vi.advanceTimersByTime(61_000)
    await getEffectiveAiConfig()

    expect(mockFindUnique).toHaveBeenCalledTimes(2)
  })

  it("re-reads the DB immediately after clearAiSettingsCache()", async () => {
    const { getEffectiveAiConfig, clearAiSettingsCache } = await import(
      "../ai-provider"
    )

    await getEffectiveAiConfig()
    clearAiSettingsCache()
    await getEffectiveAiConfig()

    expect(mockFindUnique).toHaveBeenCalledTimes(2)
  })

  it("reports source db when the row supplies a provider", async () => {
    delete process.env.ANTHROPIC_MODEL
    mockFindUnique.mockResolvedValue({
      provider: "anthropic",
      model: null,
      temperature: 0.3,
      maxOutputTokens: 512,
    })
    const { getEffectiveAiConfig } = await import("../ai-provider")

    await expect(getEffectiveAiConfig()).resolves.toEqual({
      provider: "anthropic",
      model: "claude-opus-4-8",
      source: "db",
      temperature: 0.3,
      maxOutputTokens: 512,
    })
  })

  it("reports source env when there is no row", async () => {
    process.env.OPENAI_MODEL = "gpt-4o-mini"
    const { getEffectiveAiConfig } = await import("../ai-provider")

    await expect(getEffectiveAiConfig()).resolves.toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      source: "env",
      temperature: null,
      maxOutputTokens: null,
    })
  })
})

describe("getEffectiveAiConfigForUser", () => {
  const originalEnv = { ...process.env }

  /** Shape of the `prisma.user.findUnique` select used by the resolver. */
  function userRow(
    role: string,
    aiSettings: {
      provider?: string | null
      model?: string | null
      apiKeyEnc?: string | null
    } | null,
    aiDailyRequestLimit: number | null = null,
  ) {
    return {
      role,
      aiDailyRequestLimit,
      aiSettings: aiSettings
        ? {
            provider: aiSettings.provider ?? null,
            model: aiSettings.model ?? null,
            apiKeyEnc: aiSettings.apiKeyEnc ?? null,
          }
        : null,
    }
  }

  beforeEach(() => {
    vi.resetModules()
    mockFindUnique.mockReset()
    mockFindUnique.mockResolvedValue(null)
    mockUserFindUnique.mockReset()
    mockUserFindUnique.mockResolvedValue(null)
    process.env = {
      ...originalEnv,
      AUTH_SECRET: "test-auth-secret-value",
      CODEX_HOME: TEST_CODEX_HOME,
    }
    delete process.env.AI_PROVIDER
    delete process.env.OPENAI_MODEL
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("uses a non-admin's own provider, model and key", async () => {
    const { encryptSecret } = await import("../secret-box")
    mockUserFindUnique.mockResolvedValue(
      userRow("USER", {
        provider: "deepseek",
        model: "deepseek-reasoner",
        apiKeyEnc: encryptSecret("sk-mine"),
      }),
    )
    const { getEffectiveAiConfigForUser } = await import("../ai-provider")

    await expect(getEffectiveAiConfigForUser("u1")).resolves.toMatchObject({
      provider: "deepseek",
      model: "deepseek-reasoner",
      source: "user",
      apiKey: "sk-mine",
      modelPinned: true,
    })
  })

  it("falls back to the provider default model when the user pinned none", async () => {
    const { encryptSecret } = await import("../secret-box")
    mockUserFindUnique.mockResolvedValue(
      userRow("USER", { provider: "openai", apiKeyEnc: encryptSecret("sk-mine") }),
    )
    const { getEffectiveAiConfigForUser } = await import("../ai-provider")

    await expect(getEffectiveAiConfigForUser("u1")).resolves.toMatchObject({
      model: "gpt-4o",
      modelPinned: false,
    })
  })

  it("falls back to deployment config when user has no personal provider set", async () => {
    mockUserFindUnique.mockResolvedValue(userRow("USER", null))
    const { getEffectiveAiConfigForUser } = await import(
      "../ai-provider"
    )

    const config = await getEffectiveAiConfigForUser("u1")
    expect(config.provider).toBe("claude-code")
  })

  it("allows user to select local and CLI providers like claude-code", async () => {
    mockUserFindUnique.mockResolvedValue(
      userRow("USER", {
        provider: "claude-code",
        apiKeyEnc: null,
      }),
    )
    const { getEffectiveAiConfigForUser } = await import(
      "../ai-provider"
    )

    const config = await getEffectiveAiConfigForUser("u1")
    expect(config.provider).toBe("claude-code")
    expect(config.model).toBe("sonnet")
  })

  it("throws when there is no user id at all", async () => {
    const { getEffectiveAiConfigForUser, AiKeyRequiredError } = await import(
      "../ai-provider"
    )

    await expect(getEffectiveAiConfigForUser(null)).rejects.toBeInstanceOf(
      AiKeyRequiredError,
    )
  })

  it("falls back to the deployment config for an admin with no personal key", async () => {
    process.env.AI_PROVIDER = "claude-code"
    mockUserFindUnique.mockResolvedValue(userRow("ADMIN", null, 50))
    const { getEffectiveAiConfigForUser } = await import("../ai-provider")

    await expect(getEffectiveAiConfigForUser("admin-1")).resolves.toMatchObject({
      provider: "claude-code",
      model: "sonnet",
      source: "env",
      apiKey: undefined,
      dailyRequestLimit: 50,
    })
  })

  it("prefers an admin's personal key over the deployment config", async () => {
    process.env.AI_PROVIDER = "claude-code"
    const { encryptSecret } = await import("../secret-box")
    mockUserFindUnique.mockResolvedValue(
      userRow("ADMIN", { provider: "anthropic", apiKeyEnc: encryptSecret("sk-ant-mine") }),
    )
    const { getEffectiveAiConfigForUser } = await import("../ai-provider")

    await expect(getEffectiveAiConfigForUser("admin-1")).resolves.toMatchObject({
      provider: "anthropic",
      source: "user",
      apiKey: "sk-ant-mine",
    })
  })

  it("applies the deployment sampling settings to a personal-key call", async () => {
    const { encryptSecret } = await import("../secret-box")
    mockFindUnique.mockResolvedValue({
      provider: null,
      model: null,
      temperature: 0.4,
      maxOutputTokens: 1234,
      openaiApiKeyEnc: null,
      anthropicApiKeyEnc: null,
    })
    mockUserFindUnique.mockResolvedValue(
      userRow("USER", { provider: "openai", apiKeyEnc: encryptSecret("sk-mine") }),
    )
    const { getEffectiveAiConfigForUser } = await import("../ai-provider")

    await expect(getEffectiveAiConfigForUser("u1")).resolves.toMatchObject({
      temperature: 0.4,
      maxOutputTokens: 1234,
    })
  })

  it("caches the user row and re-reads it after clearUserAiSettingsCache", async () => {
    const { encryptSecret } = await import("../secret-box")
    mockUserFindUnique.mockResolvedValue(
      userRow("USER", { provider: "openai", apiKeyEnc: encryptSecret("sk-mine") }),
    )
    const { getEffectiveAiConfigForUser, clearUserAiSettingsCache } = await import(
      "../ai-provider"
    )

    await getEffectiveAiConfigForUser("u1")
    await getEffectiveAiConfigForUser("u1")
    expect(mockUserFindUnique).toHaveBeenCalledTimes(1)

    clearUserAiSettingsCache("u1")
    await getEffectiveAiConfigForUser("u1")
    expect(mockUserFindUnique).toHaveBeenCalledTimes(2)
  })
})

describe("assertAiConfigUsable", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    mockFindUnique.mockReset()
    mockFindUnique.mockResolvedValue(null)
    mockCreateOpenAI.mockClear()
    process.env = { ...originalEnv, AUTH_SECRET: "test-auth-secret-value" }
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    delete process.env.VERCEL
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("rejects a local-only provider in a serverless deploy, naming /admin/ai", async () => {
    process.env.VERCEL = "1"
    const { assertAiConfigUsable, AiKeyRequiredError } = await import("../ai-provider")

    const error = await assertAiConfigUsable({
      provider: "claude-code",
      source: "db",
    }).catch((e: unknown) => e)

    // Typed so the call sites surface the reason instead of "Something went wrong".
    expect(error).toBeInstanceOf(AiKeyRequiredError)
    expect((error as Error).message).toContain("local-development only")
    expect((error as Error).message).toContain("/admin/ai")
  })

  it("names AI_PROVIDER as the origin when the provider came from the env", async () => {
    process.env.VERCEL = "1"
    const { assertAiConfigUsable } = await import("../ai-provider")

    await expect(
      assertAiConfigUsable({ provider: "ollama", source: "env" }),
    ).rejects.toThrow("AI_PROVIDER environment variable")
  })

  it("allows a local-only provider with no key outside a deploy", async () => {
    const { assertAiConfigUsable } = await import("../ai-provider")

    await expect(
      assertAiConfigUsable({ provider: "claude-code", source: "env" }),
    ).resolves.toBeUndefined()
  })

  it("rejects a cloud provider with no key anywhere, naming the env var", async () => {
    const { assertAiConfigUsable, AiKeyRequiredError } = await import("../ai-provider")

    const error = await assertAiConfigUsable({
      provider: "openai",
      source: "env",
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AiKeyRequiredError)
    expect((error as Error).message).toContain("OPENAI_API_KEY")
  })

  it("rejects a blank explicit key rather than passing it to the SDK", async () => {
    const { assertAiConfigUsable } = await import("../ai-provider")

    await expect(
      assertAiConfigUsable({ provider: "anthropic", source: "db", apiKey: "   " }),
    ).rejects.toThrow("ANTHROPIC_API_KEY")
  })

  it("accepts the deployment env key", async () => {
    process.env.OPENAI_API_KEY = "sk-env"
    const { assertAiConfigUsable } = await import("../ai-provider")

    await expect(
      assertAiConfigUsable({ provider: "openai", source: "env" }),
    ).resolves.toBeUndefined()
  })

  it("accepts a key stored on the AiSettings row", async () => {
    const { encryptSecret } = await import("../secret-box")
    mockFindUnique.mockResolvedValue({
      provider: null,
      model: null,
      temperature: null,
      maxOutputTokens: null,
      openaiApiKeyEnc: encryptSecret("sk-from-db"),
      anthropicApiKeyEnc: null,
    })
    const { assertAiConfigUsable } = await import("../ai-provider")

    await expect(
      assertAiConfigUsable({ provider: "openai", source: "db" }),
    ).resolves.toBeUndefined()
  })

  it("gives a keyless personal call the Settings message, not deployment detail", async () => {
    const { assertAiConfigUsable } = await import("../ai-provider")

    await expect(
      assertAiConfigUsable({ provider: "google", source: "user" }),
    ).rejects.toThrow("Add your API key in Settings → AI to use AI features.")
  })

  it("never reads the AiSettings row for a provider with no stored-key column", async () => {
    const { assertAiConfigUsable } = await import("../ai-provider")

    await expect(
      assertAiConfigUsable({ provider: "deepseek", source: "env" }),
    ).rejects.toThrow("DEEPSEEK_API_KEY")
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it("still blocks a local-only provider inside getAIModel in a deploy", async () => {
    process.env.VERCEL = "1"
    const { getAIModel, AiKeyRequiredError } = await import("../ai-provider")

    await expect(
      getAIModel({ provider: "claude-code", model: "sonnet", source: "db" }),
    ).rejects.toBeInstanceOf(AiKeyRequiredError)
    expect(mockCreateClaudeCode).not.toHaveBeenCalled()
  })

  it("does not apply the key check inside getAIModel, which is only a factory", async () => {
    const { getAIModel } = await import("../ai-provider")

    await expect(
      getAIModel({ provider: "openai", model: "gpt-4o", source: "env" }),
    ).resolves.toBeDefined()
  })
})

describe("getAIModel with an explicit per-call config", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    mockFindUnique.mockReset()
    mockFindUnique.mockResolvedValue(null)
    mockCreateOpenAI.mockClear()
    mockOpenAIModel.mockClear()
    process.env = { ...originalEnv, AUTH_SECRET: "test-auth-secret-value" }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("uses the passed key and model without reading any settings", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env"
    const { getAIModel } = await import("../ai-provider")

    await getAIModel({
      provider: "openai",
      model: "gpt-4.1-mini",
      source: "user",
      apiKey: "sk-user",
    })

    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: "sk-user" })
    expect(mockOpenAIModel).toHaveBeenCalledWith("gpt-4.1-mini")
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it("routes deepseek through the OpenAI-compatible client", async () => {
    delete process.env.DEEPSEEK_BASE_URL
    const { getAIModel } = await import("../ai-provider")

    await getAIModel({
      provider: "deepseek",
      model: "deepseek-chat",
      source: "user",
      apiKey: "sk-ds",
    })

    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      baseURL: "https://api.deepseek.com/v1",
      apiKey: "sk-ds",
    })
    expect(mockOpenAIModel).toHaveBeenCalledWith("deepseek-chat")
  })

  it("routes google through the Gemini client with the caller's key", async () => {
    const { getAIModel } = await import("../ai-provider")

    await getAIModel({
      provider: "google",
      model: "gemini-2.5-flash",
      source: "user",
      apiKey: "AIza-user",
    })

    expect(mockCreateGoogle).toHaveBeenCalledWith({ apiKey: "AIza-user" })
    expect(mockGoogleModel).toHaveBeenCalledWith("gemini-2.5-flash")
    // No stored-key column for google, so the AiSettings row is never read.
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
})
