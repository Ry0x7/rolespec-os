// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    rateLimitAttempt: {
      create: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    // `consumeRateLimit` is one `SELECT public.consume_rate_limit(...)`.
    $queryRaw: vi.fn(),
    // Only the deploy-ordering fallback uses these; the interactive transaction
    // hands the callback a `tx` client, and the mock passes itself so tx calls
    // land on the same spies.
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))

/**
 * The shape Prisma 7 + `@prisma/adapter-pg` actually produced for a missing
 * function against Neon: P2010 on the outside, SQLSTATE on the adapter cause.
 */
function undefinedFunctionError() {
  return Object.assign(new Error("Raw query failed. Code: `42883`."), {
    code: "P2010",
    meta: {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          kind: "postgres",
          originalCode: "42883",
          code: "42883",
          originalMessage: "function public.consume_rate_limit(...) does not exist",
        },
      },
    },
  })
}

/** Args bound into the Nth `$queryRaw` call, in placeholder order. */
function consumeArgs(call = 0) {
  const [, key, bucket, identifier, since, now, max] =
    mockPrisma.$queryRaw.mock.calls[call] as [
      TemplateStringsArray,
      string,
      string,
      string,
      string,
      string,
      number,
    ]
  return { key, bucket, identifier, since, now, max }
}

vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))

import {
  consumeRateLimit,
  isRateLimited,
  recordAttempt,
  clearAttempts,
  pruneAttempts,
} from "../rate-limit"

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  mockPrisma.rateLimitAttempt.create.mockResolvedValue({ id: "row-1" })
  mockPrisma.rateLimitAttempt.count.mockResolvedValue(0)
  mockPrisma.rateLimitAttempt.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.$queryRaw.mockResolvedValue([{ allowed: true }])
  mockPrisma.$executeRaw.mockResolvedValue(1)
  mockPrisma.$transaction.mockImplementation(
    async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma),
  )
})

describe("recordAttempt", () => {
  it("inserts a row for the bucket and identifier", async () => {
    await recordAttempt("auth:sign-in", "user@example.com")

    expect(mockPrisma.rateLimitAttempt.create).toHaveBeenCalledWith({
      data: { bucket: "auth:sign-in", identifier: "user@example.com" },
    })
  })

  it("swallows DB errors", async () => {
    mockPrisma.rateLimitAttempt.create.mockRejectedValue(new Error("db down"))

    await expect(recordAttempt("auth:sign-in", "a@b.c")).resolves.toBeUndefined()
  })
})

describe("isRateLimited", () => {
  const opts = { max: 3, windowMs: 60_000 }

  it("is false below the threshold", async () => {
    mockPrisma.rateLimitAttempt.count.mockResolvedValue(2)

    expect(await isRateLimited("auth:sign-in", "a@b.c", opts)).toBe(false)
  })

  it("is true at and above the threshold", async () => {
    mockPrisma.rateLimitAttempt.count.mockResolvedValue(3)
    expect(await isRateLimited("auth:sign-in", "a@b.c", opts)).toBe(true)

    mockPrisma.rateLimitAttempt.count.mockResolvedValue(99)
    expect(await isRateLimited("auth:sign-in", "a@b.c", opts)).toBe(true)
  })

  it("counts only attempts inside the window", async () => {
    const now = 1_700_000_000_000
    vi.spyOn(Date, "now").mockReturnValue(now)

    await isRateLimited("auth:sign-in", "a@b.c", opts)

    expect(mockPrisma.rateLimitAttempt.count).toHaveBeenCalledWith({
      where: {
        bucket: "auth:sign-in",
        identifier: "a@b.c",
        createdAt: { gte: new Date(now - opts.windowMs) },
      },
    })
    vi.mocked(Date.now).mockRestore()
  })

  it("only sees rows the DB returns, so an expired window frees the caller", async () => {
    // Rows outside the window are excluded by the query, which the count mock
    // models directly: 3 inside the window blocks, 0 after it expires does not.
    mockPrisma.rateLimitAttempt.count.mockResolvedValueOnce(3)
    expect(await isRateLimited("auth:sign-in", "a@b.c", opts)).toBe(true)

    mockPrisma.rateLimitAttempt.count.mockResolvedValueOnce(0)
    expect(await isRateLimited("auth:sign-in", "a@b.c", opts)).toBe(false)
  })

  it("fails OPEN when the DB throws", async () => {
    mockPrisma.rateLimitAttempt.count.mockRejectedValue(new Error("db down"))

    expect(await isRateLimited("auth:sign-in", "a@b.c", opts)).toBe(false)
  })
})

describe("consumeRateLimit", () => {
  const opts = { max: 3, windowMs: 60_000 }

  /**
   * Stands in for `public.consume_rate_limit()`: one shared row store, and the
   * lock modelled the way Postgres enforces it — calls for the same key run one
   * at a time, each seeing what the previous one wrote. Behaviour of the SQL
   * itself is covered live against Neon, not here.
   */
  function fakeConsumeFunction() {
    const rows: { identifier: string; createdAt: string }[] = []
    let chain: Promise<unknown> = Promise.resolve()
    mockPrisma.$queryRaw.mockImplementation((...args: unknown[]) => {
      const [, , , identifier, since, now, max] = args as [
        unknown,
        string,
        string,
        string,
        string,
        string,
        number,
      ]
      const run = () => {
        const recent = rows.filter(
          (r) => r.identifier === identifier && r.createdAt >= since,
        ).length
        if (recent >= max) return [{ allowed: false }]
        rows.push({ identifier, createdAt: now })
        return [{ allowed: true }]
      }
      const next = chain.then(run)
      chain = next.catch(() => {})
      return next
    })
    return rows
  }

  it("allows the attempt below the threshold", async () => {
    const rows = fakeConsumeFunction()

    expect(await consumeRateLimit("auth:sign-in", "a@b.c", opts)).toBe(true)
    expect(rows).toHaveLength(1)
  })

  it("refuses and records nothing at the threshold", async () => {
    const rows = fakeConsumeFunction()

    for (let i = 0; i < opts.max; i++) {
      expect(await consumeRateLimit("auth:sign-in", "a@b.c", opts)).toBe(true)
    }
    expect(await consumeRateLimit("auth:sign-in", "a@b.c", opts)).toBe(false)
    expect(rows).toHaveLength(opts.max)
  })

  it("is keyed per bucket:identifier", async () => {
    fakeConsumeFunction()

    for (let i = 0; i < opts.max; i++) await consumeRateLimit("auth:sign-in", "a@b.c", opts)

    expect(await consumeRateLimit("auth:sign-in", "a@b.c", opts)).toBe(false)
    expect(await consumeRateLimit("auth:sign-in", "other@b.c", opts)).toBe(true)
    expect(consumeArgs().key).toBe("auth:sign-in:a@b.c")
  })

  it("counts only attempts inside the window, so an expired window frees the caller", async () => {
    const now = 1_700_000_000_000
    vi.spyOn(Date, "now").mockReturnValue(now)
    fakeConsumeFunction()

    for (let i = 0; i < opts.max; i++) await consumeRateLimit("auth:sign-in", "a@b.c", opts)
    expect(await consumeRateLimit("auth:sign-in", "a@b.c", opts)).toBe(false)

    // The window boundary is a bound parameter, so aging the clock past it drops
    // the recorded rows out of the count exactly as the SQL does.
    vi.mocked(Date.now).mockReturnValue(now + opts.windowMs + 1)
    expect(await consumeRateLimit("auth:sign-in", "a@b.c", opts)).toBe(true)

    const first = consumeArgs(0)
    expect(first.since).toBe(new Date(now - opts.windowMs).toISOString())
    expect(first.now).toBe(new Date(now).toISOString())
    expect(first.max).toBe(opts.max)
    vi.mocked(Date.now).mockRestore()
  })

  it("does the lock, count and insert in one statement", async () => {
    await consumeRateLimit("auth:sign-in", "a@b.c", opts)

    // One round trip, and no interactive transaction wrapping it: the implicit
    // single-statement transaction is what scopes `pg_advisory_xact_lock`.
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()

    const [strings] = mockPrisma.$queryRaw.mock.calls[0] as [TemplateStringsArray]
    expect(strings.join("?")).toContain("public.consume_rate_limit")
    // User input is bound, never interpolated into the SQL text.
    expect(strings.join("?")).not.toContain("a@b.c")
    expect(consumeArgs()).toMatchObject({
      key: "auth:sign-in:a@b.c",
      bucket: "auth:sign-in",
      identifier: "a@b.c",
      max: opts.max,
    })
  })

  it("fails OPEN without recording when the query throws", async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error("db down"))

    expect(await consumeRateLimit("auth:sign-in", "a@b.c", opts)).toBe(true)
    expect(mockPrisma.rateLimitAttempt.create).not.toHaveBeenCalled()
    // A generic failure must NOT reach for the fallback.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  describe("when consume_rate_limit() has not been migrated yet", () => {
    beforeEach(() => {
      mockPrisma.$queryRaw.mockRejectedValue(undefinedFunctionError())
    })

    it("falls back to the transaction path and returns ITS decision, not fail-open", async () => {
      mockPrisma.rateLimitAttempt.count.mockResolvedValue(opts.max)

      // Fail-open would return true here; the fallback's real answer is false.
      expect(await consumeRateLimit("auth:sign-in", "a@b.c", opts)).toBe(false)
      expect(mockPrisma.rateLimitAttempt.create).not.toHaveBeenCalled()
      expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 10_000,
        timeout: 15_000,
      })
      // The lock is still taken before the count.
      const [strings, param] = mockPrisma.$executeRaw.mock.calls[0]
      expect(strings.join("")).toContain("pg_advisory_xact_lock")
      expect(param).toBe("auth:sign-in:a@b.c")
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.rateLimitAttempt.count.mock.invocationCallOrder[0],
      )
      expect(console.error).toHaveBeenCalled()
    })

    it("records the attempt through the fallback when it is allowed", async () => {
      mockPrisma.rateLimitAttempt.count.mockResolvedValue(opts.max - 1)

      expect(await consumeRateLimit("auth:sign-in", "a@b.c", opts)).toBe(true)
      expect(mockPrisma.rateLimitAttempt.create).toHaveBeenCalledWith({
        data: { bucket: "auth:sign-in", identifier: "a@b.c" },
      })
    })

    it("still fails OPEN if the fallback itself throws", async () => {
      mockPrisma.$transaction.mockRejectedValue(new Error("db down"))

      expect(await consumeRateLimit("auth:sign-in", "a@b.c", opts)).toBe(true)
    })
  })

  it("lets exactly `max` of many concurrent callers through", async () => {
    const rows = fakeConsumeFunction()

    const results = await Promise.all(
      Array.from({ length: opts.max + 2 }, () =>
        consumeRateLimit("auth:sign-in", "a@b.c", opts),
      ),
    )

    expect(results.filter(Boolean)).toHaveLength(opts.max)
    expect(rows).toHaveLength(opts.max)
  })
})

describe("clearAttempts", () => {
  it("deletes every row for the bucket and identifier", async () => {
    await clearAttempts("auth:sign-in", "a@b.c")

    expect(mockPrisma.rateLimitAttempt.deleteMany).toHaveBeenCalledWith({
      where: { bucket: "auth:sign-in", identifier: "a@b.c" },
    })
  })

  it("swallows DB errors", async () => {
    mockPrisma.rateLimitAttempt.deleteMany.mockRejectedValue(new Error("db down"))

    await expect(clearAttempts("auth:sign-in", "a@b.c")).resolves.toBeUndefined()
  })
})

describe("pruneAttempts", () => {
  it("returns the number of rows removed", async () => {
    mockPrisma.rateLimitAttempt.deleteMany.mockResolvedValue({ count: 7 })

    expect(await pruneAttempts(86_400_000)).toBe(7)
  })

  it("returns 0 when the DB throws", async () => {
    mockPrisma.rateLimitAttempt.deleteMany.mockRejectedValue(new Error("db down"))

    expect(await pruneAttempts(86_400_000)).toBe(0)
  })
})
