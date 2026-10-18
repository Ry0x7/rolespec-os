// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  mockGenerateObject,
  mockGenerateText,
  mockCreate,
  mockUpdate,
  mockCount,
  mockTransaction,
  mockExecuteRaw,
  mockConfig,
  mockModel,
  mockPrisma,
} = vi.hoisted(() => {
  const create = vi.fn()
  const update = vi.fn()
  const count = vi.fn()
  const transaction = vi.fn()
  const executeRaw = vi.fn()
  return {
    mockGenerateObject: vi.fn(),
    mockGenerateText: vi.fn(),
    mockCreate: create,
    mockUpdate: update,
    mockCount: count,
    mockTransaction: transaction,
    mockExecuteRaw: executeRaw,
    mockConfig: vi.fn(),
    mockModel: vi.fn(),
    // The interactive transaction hands the callback a `tx` client; the mock
    // passes itself, so tx calls land on the same spies.
    mockPrisma: {
      // Read by the provider resolver when it looks for a deployment-wide key.
      aiSettings: { findUnique: vi.fn(async () => null) },
      aiUsageEvent: { create, update, count },
      $transaction: transaction,
      $executeRaw: executeRaw,
    },
  }
})

vi.mock("ai", () => ({
  generateObject: mockGenerateObject,
  generateText: mockGenerateText,
}))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
// The real error classes are kept: callers identify the cap rejection with
// `instanceof AiDailyLimitError`, so a stub would hide a regression there.
vi.mock("@/shared/lib/ai-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/ai-provider")>()),
  getEffectiveAiConfigForUser: mockConfig,
  getAIModel: mockModel,
}))

import { z } from "zod"
import { AiDailyLimitError } from "@/shared/lib/ai-provider"
import {
  AI_USAGE_FEATURES,
  DEFAULT_AI_DAILY_REQUEST_LIMIT,
  generateObjectTracked,
  generateTextTracked,
} from "../ai-generate"

const schema = z.object({ answer: z.string() })

const tracking = {
  feature: AI_USAGE_FEATURES.JOB_MATCH,
  surface: "app" as const,
  userId: "user-1",
}

const fullUsage = {
  inputTokens: 120,
  outputTokens: 45,
  totalTokens: 165,
  inputTokenDetails: { cacheReadTokens: 30 },
  outputTokenDetails: { reasoningTokens: 12 },
}

/** What `reserveDailyUsage` inserted before the model was called. */
function reservedData() {
  return mockCreate.mock.calls[0][0].data
}

/**
 * The finished usage row as it ends up in the DB. On the tracked path that is
 * the reservation insert merged with the outcome update; with no userId there is
 * no reservation and the single create is the whole row.
 */
function recordedData() {
  const created = mockCreate.mock.calls[0]?.[0].data ?? {}
  const updated = mockUpdate.mock.calls[0]?.[0].data ?? {}
  return { ...created, ...updated }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExecuteRaw.mockResolvedValue(1)
  mockTransaction.mockImplementation(
    async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma),
  )
  mockUpdate.mockResolvedValue({})
  mockConfig.mockResolvedValue({
    provider: "openai",
    model: "gpt-5-mini",
    source: "user",
    temperature: null,
    maxOutputTokens: null,
    apiKey: "sk-user",
    dailyRequestLimit: null,
    modelPinned: true,
  })
  mockModel.mockResolvedValue("mock-model")
  mockCreate.mockResolvedValue({ id: "usage-1" })
  mockCount.mockResolvedValue(0)
})

describe("generateObjectTracked", () => {
  it("records a successful call with every token field", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { answer: "yes" },
      usage: fullUsage,
    })

    const result = await generateObjectTracked({
      schema,
      prompt: "q",
      tracking,
    })

    expect(result.object).toEqual({ answer: "yes" })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const data = recordedData()
    expect(data).toMatchObject({
      userId: "user-1",
      feature: "jobs.match",
      surface: "app",
      provider: "openai",
      model: "gpt-5-mini",
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      cachedInputTokens: 30,
      reasoningTokens: 12,
      ok: true,
    })
    expect(typeof data.durationMs).toBe("number")
  })

  it("passes the model and the caller's prompt through to the SDK", async () => {
    mockGenerateObject.mockResolvedValue({ object: { answer: "y" }, usage: fullUsage })

    await generateObjectTracked({ schema, system: "sys", prompt: "q", tracking })

    const args = mockGenerateObject.mock.calls[0][0]
    expect(args.model).toBe("mock-model")
    expect(args.prompt).toBe("q")
    expect(args.system).toBe("sys")
    expect(args.schema).toBe(schema)
    expect(args.tracking).toBeUndefined()
  })

  it("nulls every token column when the provider reports no usage", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { answer: "yes" },
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
        inputTokenDetails: { cacheReadTokens: undefined },
        outputTokenDetails: { reasoningTokens: undefined },
      },
    })

    await generateObjectTracked({ schema, prompt: "q", tracking })

    expect(recordedData()).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
      ok: true,
    })
  })

  it("tolerates a result with no usage object at all", async () => {
    mockGenerateObject.mockResolvedValue({ object: { answer: "yes" } })

    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).resolves.toMatchObject({ object: { answer: "yes" } })

    expect(recordedData()).toMatchObject({ totalTokens: null, ok: true })
  })

  it("records ok:false and rethrows when the AI call fails", async () => {
    mockGenerateObject.mockRejectedValue(new Error("provider down"))

    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).rejects.toThrow("provider down")

    expect(recordedData()).toMatchObject({
      feature: "jobs.match",
      ok: false,
      totalTokens: null,
    })
  })

  it("records ok:false when the model cannot even be resolved", async () => {
    mockModel.mockRejectedValue(new Error("local-only provider"))

    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).rejects.toThrow("local-only provider")

    expect(recordedData()).toMatchObject({ ok: false })
  })

  it("never throws when recording the usage row fails", async () => {
    mockGenerateObject.mockResolvedValue({ object: { answer: "yes" }, usage: fullUsage })
    mockCreate.mockRejectedValue(new Error("table missing"))

    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).resolves.toMatchObject({ object: { answer: "yes" } })
  })

  it("never throws when updating the reserved row fails", async () => {
    mockGenerateObject.mockResolvedValue({ object: { answer: "yes" }, usage: fullUsage })
    mockUpdate.mockRejectedValue(new Error("row vanished"))

    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).resolves.toMatchObject({ object: { answer: "yes" } })
  })

  it("applies the admin temperature and maxOutputTokens, caller wins", async () => {
    mockConfig.mockResolvedValue({
      provider: "openai",
      model: "gpt-5-mini",
      source: "db",
      temperature: 0.2,
      maxOutputTokens: 900,
      // A usable key: without one the config is rejected before the reservation.
      apiKey: "sk-admin",
    })
    mockGenerateObject.mockResolvedValue({ object: { answer: "y" }, usage: fullUsage })

    await generateObjectTracked({ schema, prompt: "q", tracking })
    expect(mockGenerateObject.mock.calls[0][0]).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 900,
    })

    await generateObjectTracked({
      schema,
      prompt: "q",
      temperature: 0.9,
      tracking,
    })
    expect(mockGenerateObject.mock.calls[1][0]).toMatchObject({
      temperature: 0.9,
      maxOutputTokens: 900,
    })
  })

  it("stores a null userId when the caller has none", async () => {
    mockGenerateObject.mockResolvedValue({ object: { answer: "y" }, usage: fullUsage })

    await generateObjectTracked({
      schema,
      prompt: "q",
      tracking: { feature: AI_USAGE_FEATURES.JOB_MATCH, surface: "extension" },
    })

    expect(recordedData()).toMatchObject({ userId: null, surface: "extension" })
  })
})

describe("per-user config, cheap tier and the daily cap", () => {
  beforeEach(() => {
    mockGenerateObject.mockResolvedValue({ object: { answer: "y" }, usage: fullUsage })
  })

  it("builds the model from the caller's resolved provider, model and key", async () => {
    await generateObjectTracked({ schema, prompt: "q", tracking })

    expect(mockConfig).toHaveBeenCalledWith("user-1")
    expect(mockModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-5-mini",
        apiKey: "sk-user",
      }),
    )
  })

  it("swaps in the provider's cheap model for a light-tier call", async () => {
    mockConfig.mockResolvedValue({
      provider: "openai",
      model: "gpt-4o",
      source: "user",
      temperature: null,
      maxOutputTokens: null,
      apiKey: "sk-user",
      dailyRequestLimit: null,
      modelPinned: false,
    })

    await generateObjectTracked({ schema, prompt: "q", tier: "light", tracking })

    expect(mockModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini" }),
    )
    // The usage row records what actually ran.
    expect(recordedData()).toMatchObject({ model: "gpt-4o-mini" })
  })

  it("keeps a user-pinned model on a light-tier call", async () => {
    mockConfig.mockResolvedValue({
      provider: "openai",
      model: "gpt-4o",
      source: "user",
      temperature: null,
      maxOutputTokens: null,
      apiKey: "sk-user",
      dailyRequestLimit: null,
      modelPinned: true,
    })

    await generateObjectTracked({ schema, prompt: "q", tier: "light", tracking })

    expect(mockModel).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o" }))
  })

  it("ignores the tier for a provider with no cheap model", async () => {
    mockConfig.mockResolvedValue({
      provider: "claude-code",
      model: "sonnet",
      source: "env",
      temperature: null,
      maxOutputTokens: null,
      dailyRequestLimit: null,
      modelPinned: false,
    })

    await generateObjectTracked({ schema, prompt: "q", tier: "light", tracking })

    expect(mockModel).toHaveBeenCalledWith(expect.objectContaining({ model: "sonnet" }))
  })

  it("counts the caller's last 24h of calls against the default cap", async () => {
    await generateObjectTracked({ schema, prompt: "q", tracking })

    const where = mockCount.mock.calls[0][0].where
    expect(where.userId).toBe("user-1")
    expect(where.createdAt.gte).toBeInstanceOf(Date)
  })

  it("throws instead of calling the model once the daily cap is reached", async () => {
    mockCount.mockResolvedValue(DEFAULT_AI_DAILY_REQUEST_LIMIT)

    // Typed, not a bare Error: every AI entry point passes this one through so
    // the user is told why, instead of "Something went wrong" for 24h.
    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).rejects.toBeInstanceOf(AiDailyLimitError)
    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).rejects.toThrow("Daily AI request limit reached. Try again later.")

    expect(mockGenerateObject).not.toHaveBeenCalled()
    // Nothing reached a provider, so nothing is recorded.
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("honours a per-user cap override", async () => {
    mockConfig.mockResolvedValue({
      provider: "openai",
      model: "gpt-5-mini",
      source: "user",
      temperature: null,
      maxOutputTokens: null,
      apiKey: "sk-user",
      dailyRequestLimit: 2,
      modelPinned: true,
    })
    mockCount.mockResolvedValue(2)

    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).rejects.toThrow("Daily AI request limit reached. Try again later.")
  })

  it("allows the call when the cap count query fails", async () => {
    mockCount.mockRejectedValue(new Error("db down"))

    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).resolves.toMatchObject({ object: { answer: "y" } })
  })

  it("propagates the missing-key error without recording usage", async () => {
    mockConfig.mockRejectedValue(new Error("Add your API key in Settings → AI to use AI features."))

    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).rejects.toThrow("Add your API key in Settings")

    expect(mockGenerateObject).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects a local-only provider in a deploy without reserving quota", async () => {
    process.env.VERCEL = "1"
    mockConfig.mockResolvedValue({
      provider: "claude-code",
      model: "sonnet",
      source: "db",
      temperature: null,
      maxOutputTokens: null,
      dailyRequestLimit: null,
      modelPinned: false,
    })

    try {
      await expect(
        generateObjectTracked({ schema, prompt: "q", tracking }),
      ).rejects.toThrow("local-development only")
    } finally {
      delete process.env.VERCEL
    }

    // The whole point: a config that can never reach a provider must not spend
    // a slot against the caller's daily cap.
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockModel).not.toHaveBeenCalled()
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it("rejects a keyless cloud provider without reserving quota", async () => {
    const key = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    mockConfig.mockResolvedValue({
      provider: "openai",
      model: "gpt-4o",
      source: "env",
      temperature: null,
      maxOutputTokens: null,
      apiKey: undefined,
      dailyRequestLimit: null,
      modelPinned: false,
    })

    try {
      await expect(
        generateObjectTracked({ schema, prompt: "q", tracking }),
      ).rejects.toThrow("OPENAI_API_KEY")
    } finally {
      if (key !== undefined) process.env.OPENAI_API_KEY = key
    }

    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it("reserves the usage row before the model is called", async () => {
    await generateObjectTracked({ schema, prompt: "q", tracking })

    // The reservation is what makes the cap concurrency-safe: the row exists
    // before the multi-second provider call, not after it.
    expect(mockCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mockGenerateObject.mock.invocationCallOrder[0],
    )
    expect(reservedData()).toMatchObject({
      userId: "user-1",
      feature: "jobs.match",
      surface: "app",
      provider: "openai",
      model: "gpt-5-mini",
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      durationMs: null,
      ok: false,
    })
  })

  it("takes the advisory lock before counting, inside one transaction", async () => {
    await generateObjectTracked({ schema, prompt: "q", tracking })

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecuteRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mockCount.mock.invocationCallOrder[0],
    )
    expect(mockCount.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreate.mock.invocationCallOrder[0],
    )
    const [strings, param] = mockExecuteRaw.mock.calls[0]
    expect(strings.join("")).toContain("pg_advisory_xact_lock")
    expect(strings.join("")).toContain("hashtext('ai-quota')")
    expect(param).toBe("user-1")
  })

  it("bounds the reservation transaction so a burst queues on the lock instead of failing open", async () => {
    await generateObjectTracked({ schema, prompt: "q", tracking })

    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 15_000,
    })
  })

  it("updates the reserved row instead of writing a second one", async () => {
    await generateObjectTracked({ schema, prompt: "q", tracking })

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: "usage-1" })
    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({
      provider: "openai",
      model: "gpt-5-mini",
      totalTokens: 165,
      ok: true,
    })
  })

  it("updates the reserved row with ok:false when the call fails, and rethrows", async () => {
    mockGenerateObject.mockRejectedValue(new Error("provider down"))

    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).rejects.toThrow("provider down")

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({
      ok: false,
      totalTokens: null,
    })
  })

  it("creates the row after the call, with no transaction, when there is no userId", async () => {
    await generateObjectTracked({
      schema,
      prompt: "q",
      tracking: { feature: AI_USAGE_FEATURES.JOB_MATCH, surface: "extension" },
    })

    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockGenerateObject.mock.invocationCallOrder[0],
    )
    expect(recordedData()).toMatchObject({ userId: null, ok: true })
  })

  it("falls back to a plain create when the reservation transaction fails", async () => {
    mockTransaction.mockRejectedValue(new Error("db down"))

    await expect(
      generateObjectTracked({ schema, prompt: "q", tracking }),
    ).resolves.toMatchObject({ object: { answer: "y" } })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(recordedData()).toMatchObject({ userId: "user-1", ok: true })
  })

  it("lets exactly the cap through when many calls start at once", async () => {
    // Simulates what the advisory lock guarantees in Postgres: reservations for
    // one user run one at a time. The mock serializes the transaction callbacks
    // on a promise chain and backs them with one shared row array.
    const limit = 3
    mockConfig.mockResolvedValue({
      provider: "openai",
      model: "gpt-5-mini",
      source: "user",
      temperature: null,
      maxOutputTokens: null,
      apiKey: "sk-user",
      dailyRequestLimit: limit,
      modelPinned: true,
    })
    const rows: string[] = []
    let chain: Promise<unknown> = Promise.resolve()
    mockCount.mockImplementation(async () => rows.length)
    mockCreate.mockImplementation(async () => {
      const id = `usage-${rows.length + 1}`
      rows.push(id)
      return { id }
    })
    mockTransaction.mockImplementation((cb: (tx: typeof mockPrisma) => unknown) => {
      const next = chain.then(() => cb(mockPrisma))
      chain = next.catch(() => {})
      return next
    })

    const results = await Promise.allSettled(
      Array.from({ length: limit + 2 }, () =>
        generateObjectTracked({ schema, prompt: "q", tracking }),
      ),
    )

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(limit)
    expect(
      results.filter(
        (r) => r.status === "rejected" && r.reason instanceof AiDailyLimitError,
      ),
    ).toHaveLength(2)
    expect(rows).toHaveLength(limit)
    expect(mockGenerateObject).toHaveBeenCalledTimes(limit)
  })

  it("never forwards the tier to the SDK", async () => {
    await generateObjectTracked({ schema, prompt: "q", tier: "light", tracking })

    expect(mockGenerateObject.mock.calls[0][0].tier).toBeUndefined()
  })
})

describe("generateTextTracked", () => {
  it("returns the text and records the call", async () => {
    mockGenerateText.mockResolvedValue({ text: "hello", usage: fullUsage })

    const result = await generateTextTracked({
      prompt: "q",
      tracking: { ...tracking, feature: AI_USAGE_FEATURES.RESUME_ENHANCE },
    })

    expect(result.text).toBe("hello")
    expect(recordedData()).toMatchObject({
      feature: "resume.enhance",
      totalTokens: 165,
      ok: true,
    })
  })

  it("records ok:false and rethrows on failure", async () => {
    mockGenerateText.mockRejectedValue(new Error("boom"))

    await expect(
      generateTextTracked({ prompt: "q", tracking }),
    ).rejects.toThrow("boom")

    expect(recordedData()).toMatchObject({ ok: false })
  })
})
