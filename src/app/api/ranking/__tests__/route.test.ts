// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveApiUserId: vi.fn(),
  isSameOriginRequest: vi.fn(),
  consumeRateLimit: vi.fn(),
  rankSavedJobs: vi.fn(),
  saveRankingSnapshot: vi.fn(),
  getLatestRankingSnapshot: vi.fn(),
}))

vi.mock("@/features/auth/api-auth", () => ({
  resolveApiUserId: mocks.resolveApiUserId,
  isSameOriginRequest: mocks.isSameOriginRequest,
}))

vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { RANKING_RUN: "ranking:run" },
  consumeRateLimit: mocks.consumeRateLimit,
}))

vi.mock("@/features/ranking/services/job-ranking.service", () => ({
  rankSavedJobs: mocks.rankSavedJobs,
}))

vi.mock("@/features/ranking/services/ranking-snapshot.service", () => ({
  saveRankingSnapshot: mocks.saveRankingSnapshot,
  getLatestRankingSnapshot: mocks.getLatestRankingSnapshot,
}))

import { GET, POST } from "../route"

const RESULT = {
  result: {
    snapshot: { rankedAt: "2026-11-11T00:00:00.000Z", corpusSize: 1, queryTerms: [] },
    entries: [{ postingId: "job-1", rank: 1, score: 82 }],
    excluded: [],
  },
  reranked: false,
  warnings: [],
  poolSize: 1,
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/ranking", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveApiUserId.mockResolvedValue("user-1")
  mocks.isSameOriginRequest.mockReturnValue(true)
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.rankSavedJobs.mockResolvedValue(RESULT)
  mocks.saveRankingSnapshot.mockResolvedValue({ id: "snapshot-1" })
  mocks.getLatestRankingSnapshot.mockResolvedValue(null)
})

describe("POST /api/ranking", () => {
  it("refuses a cross-origin request before reading the body", async () => {
    mocks.isSameOriginRequest.mockReturnValue(false)

    const res = await request({}, { origin: "https://evil.example" })

    expect(res.status).toBe(403)
    expect(mocks.rankSavedJobs).not.toHaveBeenCalled()
  })

  it("rejects an anonymous caller", async () => {
    mocks.resolveApiUserId.mockResolvedValue(null)

    const res = await request({})

    expect(res.status).toBe(401)
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
    expect(mocks.rankSavedJobs).not.toHaveBeenCalled()
  })

  it("returns 429 when the ranking limit is exhausted", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await request({})

    expect(res.status).toBe(429)
    expect(mocks.rankSavedJobs).not.toHaveBeenCalled()
  })

  it("rejects an invalid or over-broad request", async () => {
    for (const body of [
      { topK: 0 },
      { minScore: 101 },
      { lexicalWeight: 2 },
      { jobIds: [] },
      { jobIds: Array.from({ length: 101 }, (_, index) => `job-${index}`) },
      { unexpected: true },
    ]) {
      const res = await request(body)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("INVALID_INPUT")
    }
    expect(mocks.rankSavedJobs).not.toHaveBeenCalled()
  })

  it("rejects a body that is not JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/ranking", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    )

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("INVALID_BODY")
  })

  it("ranks the caller's pool with the requested options", async () => {
    const res = await request({
      jobIds: ["job-1"],
      topK: 10,
      minScore: 40,
      lexicalWeight: 0.6,
      rerank: true,
    })

    expect(res.status).toBe(200)
    expect(mocks.rankSavedJobs).toHaveBeenCalledWith({
      userId: "user-1",
      jobIds: ["job-1"],
      topK: 10,
      minScore: 40,
      lexicalWeight: 0.6,
      rerank: true,
    })
    const body = await res.json()
    expect(body.entries).toHaveLength(1)
    expect(body.poolSize).toBe(1)
    expect(body.reranked).toBe(false)
    expect(body.warnings).toEqual([])
    expect(body.snapshotId).toBe("snapshot-1")
    expect(mocks.saveRankingSnapshot).toHaveBeenCalledWith({
      userId: "user-1",
      result: RESULT.result,
      reranked: false,
      poolSize: 1,
    })
  })

  it("reads the latest persisted snapshot for the owner", async () => {
    mocks.getLatestRankingSnapshot.mockResolvedValue({
      id: "snapshot-1",
      kind: "SAVED_JOBS",
      result: RESULT.result,
    })
    const res = await GET(new Request("http://localhost/api/ranking"))

    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await res.json()).toMatchObject({ snapshot: { id: "snapshot-1" } })
    expect(mocks.getLatestRankingSnapshot).toHaveBeenCalledWith("user-1")
  })

  it("returns a generic error without leaking the service failure", async () => {
    mocks.rankSavedJobs.mockRejectedValue(new Error("connection refused"))

    const res = await request({})

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe("RANKING_FAILED")
  })
})
