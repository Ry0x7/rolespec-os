// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    aiUsageEvent: {
      aggregate: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}))

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))

import { getUserAiUsage, USER_AI_USAGE_WINDOW_DAYS } from "../ai-usage.service"

const NOW = new Date("2026-08-16T10:00:00.000Z")

/** groupBy is called three times, in order: by model, by feature, by failure. */
function queueGroupBy(modelRows: unknown[], featureRows: unknown[], failureRows: unknown[]) {
  mockPrisma.aiUsageEvent.groupBy.mockReset()
  mockPrisma.aiUsageEvent.groupBy
    .mockResolvedValueOnce(modelRows)
    .mockResolvedValueOnce(featureRows)
    .mockResolvedValueOnce(failureRows)
}

function modelRow(
  provider: string,
  model: string,
  sums: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number },
  calls = 1,
) {
  return {
    provider,
    model,
    _count: { _all: calls },
    _sum: {
      inputTokens: sums.inputTokens ?? 0,
      outputTokens: sums.outputTokens ?? 0,
      totalTokens: (sums.inputTokens ?? 0) + (sums.outputTokens ?? 0),
      cachedInputTokens: sums.cachedInputTokens ?? 0,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)

  mockPrisma.aiUsageEvent.aggregate.mockResolvedValue({
    _count: { _all: 4 },
    _sum: { inputTokens: 2_000_000, outputTokens: 1_000_000, totalTokens: 3_000_000 },
  })
  mockPrisma.aiUsageEvent.count.mockResolvedValue(3)
  mockPrisma.$queryRaw.mockResolvedValue([])
  queueGroupBy([], [], [])
})

afterEach(() => {
  vi.useRealTimers()
})

describe("getUserAiUsage", () => {
  it("scopes every query to the caller", async () => {
    await getUserAiUsage("u1")

    expect(mockPrisma.aiUsageEvent.aggregate.mock.calls[0][0].where.userId).toBe("u1")
    expect(mockPrisma.aiUsageEvent.count.mock.calls[0][0].where.userId).toBe("u1")
    expect(mockPrisma.aiUsageEvent.groupBy.mock.calls[0][0].where.userId).toBe("u1")
  })

  it("derives totals, with failures as calls minus successes", async () => {
    const usage = await getUserAiUsage("u1")

    expect(usage.windowDays).toBe(USER_AI_USAGE_WINDOW_DAYS)
    expect(usage.totals).toMatchObject({
      calls: 4,
      okCalls: 3,
      failedCalls: 1,
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
      totalTokens: 3_000_000,
    })
  })

  it("estimates cost per model and sums it into the totals", async () => {
    queueGroupBy(
      [
        modelRow("openai", "gpt-4o", { inputTokens: 1_000_000, outputTokens: 0 }),
        modelRow("deepseek", "deepseek-chat", {
          inputTokens: 1_000_000,
          outputTokens: 0,
        }),
      ],
      [],
      [],
    )

    const usage = await getUserAiUsage("u1")

    expect(usage.byModel[0].estimatedCostUsd).toBeCloseTo(2.5, 10)
    expect(usage.byModel[1].estimatedCostUsd).toBeCloseTo(0.27, 10)
    expect(usage.totals.estimatedCostUsd).toBeCloseTo(2.77, 10)
  })

  it("reports an unknown model's cost as null and leaves it out of the total", async () => {
    queueGroupBy(
      [
        modelRow("claude-code", "sonnet", { inputTokens: 5000, outputTokens: 500 }),
        modelRow("openai", "gpt-4o", { inputTokens: 1_000_000, outputTokens: 0 }),
      ],
      [],
      [],
    )

    const usage = await getUserAiUsage("u1")

    const local = usage.byModel.find((row) => row.provider === "claude-code")
    expect(local?.estimatedCostUsd).toBeNull()
    expect(usage.totals.estimatedCostUsd).toBeCloseTo(2.5, 10)
  })

  it("reports a null total cost when no model in the window has a price", async () => {
    queueGroupBy([modelRow("ollama", "qwen2.5vl:7b", { inputTokens: 100 })], [], [])

    const usage = await getUserAiUsage("u1")

    expect(usage.totals.estimatedCostUsd).toBeNull()
  })

  it("joins failure counts onto the feature rows", async () => {
    queueGroupBy(
      [],
      [
        { feature: "resume.enhance", _count: { _all: 5 }, _sum: { totalTokens: 900 } },
        { feature: "jobs.match", _count: { _all: 2 }, _sum: { totalTokens: 2000 } },
      ],
      [{ feature: "resume.enhance", _count: { _all: 2 } }],
    )

    const usage = await getUserAiUsage("u1")

    // Sorted by tokens, so jobs.match leads.
    expect(usage.byFeature).toEqual([
      { feature: "jobs.match", calls: 2, failedCalls: 0, totalTokens: 2000 },
      { feature: "resume.enhance", calls: 5, failedCalls: 2, totalTokens: 900 },
    ])
  })

  it("zero-fills the daily token series across the whole window", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { day: "2026-08-16", count: 120 },
    ])

    const usage = await getUserAiUsage("u1")

    expect(usage.tokensByDay).toHaveLength(USER_AI_USAGE_WINDOW_DAYS)
    expect(usage.tokensByDay.at(-1)).toEqual({ day: "2026-08-16", count: 120 })
    expect(usage.tokensByDay[0].count).toBe(0)
  })

  it("starts the series query at the start of the oldest UTC day it renders", async () => {
    await getUserAiUsage("u1")

    // Bound values of the tagged template: userId, then the cutoff.
    const [, boundUserId, cutoff] = mockPrisma.$queryRaw.mock.calls[0]
    expect(boundUserId).toBe("u1")
    // 30 whole UTC days ending on 2026-08-16 → 2026-07-18T00:00:00Z, not the
    // rolling `now - 30d` (2026-07-17T10:00Z) which cut the oldest bar short.
    expect((cutoff as Date).toISOString()).toBe("2026-07-18T00:00:00.000Z")
  })
})
