// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveApiUserId: vi.fn(),
  consumeRateLimit: vi.fn(),
  createIntakeRun: vi.fn(),
  getIntakeRun: vi.fn(),
  listIntakeRuns: vi.fn(),
  scheduleIntakeRun: vi.fn(),
  logError: vi.fn(),
}))

vi.mock("@/features/auth/api-auth", () => ({
  resolveApiUserId: mocks.resolveApiUserId,
}))

vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { INTAKE_RUN: "intake:run" },
  consumeRateLimit: mocks.consumeRateLimit,
}))

vi.mock("@/features/intake/services/intake-run.service", () => ({
  createIntakeRun: mocks.createIntakeRun,
  getIntakeRun: mocks.getIntakeRun,
  listIntakeRuns: mocks.listIntakeRuns,
}))

vi.mock("@/features/intake/services/schedule", () => ({
  scheduleIntakeRun: mocks.scheduleIntakeRun,
}))

vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ error: mocks.logError }),
}))

import { GET, POST } from "../route"

const RUN = {
  id: "run-1",
  status: "PENDING",
  requestedSources: ["GITHUB"],
  sources: [],
  patches: [],
  counts: { pending: 0, applied: 0, conflicts: 0, rejected: 0 },
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveApiUserId.mockResolvedValue("user-1")
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.createIntakeRun.mockResolvedValue("run-1")
  mocks.getIntakeRun.mockResolvedValue(RUN)
  mocks.scheduleIntakeRun.mockResolvedValue(undefined)
})

describe("GET /api/intake", () => {
  it("rejects an anonymous caller", async () => {
    mocks.resolveApiUserId.mockResolvedValue(null)

    const res = await GET(new Request("http://localhost/api/intake"))

    expect(res.status).toBe(401)
    expect(mocks.listIntakeRuns).not.toHaveBeenCalled()
  })

  it("lists only the authenticated owner's runs", async () => {
    mocks.listIntakeRuns.mockResolvedValue([RUN])

    const res = await GET(new Request("http://localhost/api/intake?limit=25"))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runs: [RUN] })
    expect(mocks.listIntakeRuns).toHaveBeenCalledWith("user-1", 25)
  })

  it("falls back to ten when the limit is not a number", async () => {
    mocks.listIntakeRuns.mockResolvedValue([])

    await GET(new Request("http://localhost/api/intake?limit=abc"))

    expect(mocks.listIntakeRuns).toHaveBeenCalledWith("user-1", 10)
  })
})

describe("POST /api/intake", () => {
  it("rejects an anonymous caller before any work", async () => {
    mocks.resolveApiUserId.mockResolvedValue(null)

    const res = await post({ requests: [] })

    expect(res.status).toBe(401)
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
  })

  it("returns 429 when the owner's run limit is exhausted", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await post({
      requests: [
        { source: "GITHUB", input: { url: "https://github.com/ada", consent: true } },
      ],
    })

    expect(res.status).toBe(429)
    expect(mocks.createIntakeRun).not.toHaveBeenCalled()
  })

  it("rejects two sources of the same kind in one run", async () => {
    const res = await post({
      requests: [
        { source: "GITHUB", input: { url: "https://github.com/ada", consent: true } },
        { source: "GITHUB", input: { url: "https://github.com/grace", consent: true } },
      ],
    })

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("INVALID_INPUT")
    expect(mocks.createIntakeRun).not.toHaveBeenCalled()
  })

  it("requires explicit consent for a web read", async () => {
    const res = await post({
      requests: [{ source: "GITHUB", input: { url: "https://github.com/ada" } }],
    })

    expect(res.status).toBe(400)
    expect(mocks.createIntakeRun).not.toHaveBeenCalled()
  })

  it("creates the run, returns it and schedules execution after the response", async () => {
    const requests = [
      { source: "GITHUB", input: { url: "https://github.com/ada", consent: true } },
    ]

    const res = await post({ requests, idempotencyKey: "replay-key-123" })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ run: RUN })
    expect(mocks.createIntakeRun).toHaveBeenCalledWith("user-1", requests, "replay-key-123")
    expect(mocks.scheduleIntakeRun).toHaveBeenCalledWith("run-1")
  })

  it("does not echo a service failure", async () => {
    mocks.createIntakeRun.mockRejectedValue(new Error("database password leaked"))

    const res = await post({
      requests: [
        { source: "GITHUB", input: { url: "https://github.com/ada", consent: true } },
      ],
    })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: "Could not start intake. Please try again.",
      code: "INTAKE_FAILED",
    })
    expect(mocks.scheduleIntakeRun).not.toHaveBeenCalled()
  })
})
