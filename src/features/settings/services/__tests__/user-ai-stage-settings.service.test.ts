// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockPrisma, mockClearCache } = vi.hoisted(() => ({
  mockPrisma: {
    userAiStageSetting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  mockClearCache: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/shared/lib/ai-provider", () => ({
  clearUserAiSettingsCache: mockClearCache,
}))

import { decryptSecret, encryptSecret } from "@/shared/lib/secret-box"
import {
  clearUserAiStageSetting,
  listUserAiStageSettings,
  saveUserAiStageSetting,
} from "../user-ai-stage-settings.service"

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...originalEnv, AUTH_SECRET: "test-auth-secret-value" }
  mockPrisma.userAiStageSetting.findUnique.mockResolvedValue(null)
  mockPrisma.userAiStageSetting.findMany.mockResolvedValue([])
  mockPrisma.userAiStageSetting.upsert.mockImplementation(
    async ({ create }: { create: Record<string, unknown> }) => create
  )
  mockPrisma.userAiStageSetting.deleteMany.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  process.env = originalEnv
})

describe("saveUserAiStageSetting", () => {
  it("encrypts the stage key and returns only its last four characters", async () => {
    const view = await saveUserAiStageSetting("u1", {
      stage: "TAILOR",
      provider: "anthropic",
      model: " claude-stage ",
      apiKey: "sk-ant-stage-9876",
    })

    const stored = mockPrisma.userAiStageSetting.upsert.mock.calls[0][0]
    expect(stored.create.apiKeyEnc).not.toContain("sk-ant-stage-9876")
    expect(decryptSecret(stored.create.apiKeyEnc)).toBe("sk-ant-stage-9876")
    expect(view).toMatchObject({
      stage: "TAILOR",
      provider: "anthropic",
      model: "claude-stage",
      configured: true,
      last4: "9876",
    })
    expect(JSON.stringify(view)).not.toContain("sk-ant-stage-9876")
    expect(mockClearCache).toHaveBeenCalledWith("u1")
  })

  it("drops the old stage key when the provider changes without a new key", async () => {
    mockPrisma.userAiStageSetting.findUnique.mockResolvedValue({
      provider: "openai",
      apiKeyEnc: encryptSecret("sk-openai"),
    })

    await saveUserAiStageSetting("u1", {
      stage: "RESEARCH",
      provider: "deepseek",
    })

    expect(mockPrisma.userAiStageSetting.upsert.mock.calls[0][0].update).toMatchObject({
      provider: "deepseek",
      apiKeyEnc: null,
    })
  })

  it("keeps the stored key when the provider is unchanged", async () => {
    mockPrisma.userAiStageSetting.findUnique.mockResolvedValue({
      provider: "openai",
      apiKeyEnc: encryptSecret("sk-openai"),
    })

    await saveUserAiStageSetting("u1", {
      stage: "RANK",
      provider: "openai",
      model: "gpt-4.1",
    })

    expect(mockPrisma.userAiStageSetting.upsert.mock.calls[0][0].update).not.toHaveProperty(
      "apiKeyEnc"
    )
  })
})

describe("listUserAiStageSettings", () => {
  it("reports configured status without exposing a key", async () => {
    mockPrisma.userAiStageSetting.findMany.mockResolvedValue([
      {
        stage: "RESEARCH",
        provider: "openai",
        model: null,
        apiKeyEnc: encryptSecret("sk-research-4321"),
      },
      { stage: "NOT_A_STAGE", provider: "openai", model: null, apiKeyEnc: null },
    ])

    const items = await listUserAiStageSettings("u1")

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      stage: "RESEARCH",
      provider: "openai",
      configured: true,
      last4: "4321",
      defaultModel: "gpt-4o",
    })
    expect(JSON.stringify(items)).not.toContain("sk-research-4321")
  })
})

describe("clearUserAiStageSetting", () => {
  it("clears the cache after deleting an override", async () => {
    await expect(clearUserAiStageSetting("u1", "TAILOR")).resolves.toBe(true)
    expect(mockClearCache).toHaveBeenCalledWith("u1")
  })

  it("returns false when the owner has no such override", async () => {
    mockPrisma.userAiStageSetting.deleteMany.mockResolvedValue({ count: 0 })
    await expect(clearUserAiStageSetting("u1", "TAILOR")).resolves.toBe(false)
  })
})
