// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockPrisma, mockClearCache } = vi.hoisted(() => ({
  mockPrisma: {
    userAiSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
  mockClearCache: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/shared/lib/ai-provider", () => ({
  clearUserAiSettingsCache: mockClearCache,
}))

// The real secret-box is used, so the round trip through the encryption envelope
// is covered rather than mocked away.
import { decryptSecret, encryptSecret } from "@/shared/lib/secret-box"
import {
  getUserAiKeyStatus,
  saveUserAiSettings,
} from "../user-ai-settings.service"

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...originalEnv, AUTH_SECRET: "test-auth-secret-value" }
  mockPrisma.userAiSettings.findUnique.mockResolvedValue(null)
  mockPrisma.userAiSettings.upsert.mockImplementation(async (args: unknown) => args)
})

afterEach(() => {
  process.env = originalEnv
})

describe("getUserAiKeyStatus", () => {
  it("reports no provider and no key when there is no row", async () => {
    await expect(getUserAiKeyStatus("u1")).resolves.toEqual({
      provider: null,
      model: null,
      configured: false,
      envConfigured: false,
      defaultModel: null,
    })
  })

  it("returns provider, model, last4 and the provider default — never the key", async () => {
    mockPrisma.userAiSettings.findUnique.mockResolvedValue({
      provider: "openai",
      model: " gpt-4.1-mini ",
      apiKeyEnc: encryptSecret("sk-live-abcd1234"),
    })

    const status = await getUserAiKeyStatus("u1")

    expect(status).toEqual({
      provider: "openai",
      model: "gpt-4.1-mini",
      configured: true,
      envConfigured: false,
      last4: "1234",
      defaultModel: "gpt-4o",
    })
    expect(JSON.stringify(status)).not.toContain("sk-live-abcd1234")
  })

  it("reports not configured when the stored key cannot be decrypted", async () => {
    mockPrisma.userAiSettings.findUnique.mockResolvedValue({
      provider: "anthropic",
      model: null,
      apiKeyEnc: "v1.bogus.bogus.bogus",
    })

    await expect(getUserAiKeyStatus("u1")).resolves.toMatchObject({
      provider: "anthropic",
      configured: false,
    })
  })

  it("ignores a provider that is not recognized", async () => {
    mockPrisma.userAiSettings.findUnique.mockResolvedValue({
      provider: "not-a-real-provider",
      model: null,
      apiKeyEnc: null,
    })

    await expect(getUserAiKeyStatus("u1")).resolves.toMatchObject({
      provider: null,
      defaultModel: null,
    })
  })
})

describe("saveUserAiSettings", () => {
  function upsertArgs() {
    return mockPrisma.userAiSettings.upsert.mock.calls[0][0]
  }

  it("stores the key encrypted, never in plaintext", async () => {
    await saveUserAiSettings("u1", { provider: "openai", apiKey: "sk-secret-value" })

    const args = upsertArgs()
    expect(args.create.apiKeyEnc).toMatch(/^v1\./)
    expect(decryptSecret(args.update.apiKeyEnc)).toBe("sk-secret-value")
    expect(JSON.stringify(args)).not.toContain("sk-secret-value")
  })

  it("leaves the stored key alone when the provider is unchanged and no key is submitted", async () => {
    mockPrisma.userAiSettings.findUnique.mockResolvedValue({
      provider: "deepseek",
      model: null,
      apiKeyEnc: encryptSecret("sk-deepseek-existing"),
    })

    await saveUserAiSettings("u1", { provider: "deepseek", model: "deepseek-chat" })

    const args = upsertArgs()
    expect("apiKeyEnc" in args.update).toBe(false)
    expect(args.update).toMatchObject({ provider: "deepseek", model: "deepseek-chat" })
  })

  it("clears the stored key when the provider changes and no new key is submitted", async () => {
    mockPrisma.userAiSettings.findUnique.mockResolvedValue({
      provider: "openai",
      model: null,
      apiKeyEnc: encryptSecret("sk-openai-existing"),
    })

    await saveUserAiSettings("u1", { provider: "deepseek" })

    const args = upsertArgs()
    expect(args.update.apiKeyEnc).toBeNull()
    expect(args.update.provider).toBe("deepseek")
  })

  it("replaces the stored key when the provider changes and a new key is submitted", async () => {
    mockPrisma.userAiSettings.findUnique.mockResolvedValue({
      provider: "openai",
      model: null,
      apiKeyEnc: encryptSecret("sk-openai-existing"),
    })

    await saveUserAiSettings("u1", { provider: "anthropic", apiKey: "sk-ant-new" })

    const args = upsertArgs()
    expect(decryptSecret(args.update.apiKeyEnc)).toBe("sk-ant-new")
  })

  it("clears the stored key on an explicit null", async () => {
    await saveUserAiSettings("u1", { provider: "openai", apiKey: null })

    expect(upsertArgs().update.apiKeyEnc).toBeNull()
  })

  it("normalises a blank model to null", async () => {
    await saveUserAiSettings("u1", { provider: "openai", model: "   " })

    expect(upsertArgs().update.model).toBeNull()
  })

  it("drops the user's cached runtime config", async () => {
    await saveUserAiSettings("u1", { provider: "openai" })

    expect(mockClearCache).toHaveBeenCalledWith("u1")
  })
})
