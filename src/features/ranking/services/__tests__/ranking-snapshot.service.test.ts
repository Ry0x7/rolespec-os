// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
}))

vi.mock("@/shared/lib/prisma", () => ({
  prisma: { rankingSnapshot: { create: mocks.create, findFirst: mocks.findFirst } },
}))
vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import {
  getLatestRankingSnapshot,
  saveRankingSnapshot,
} from "../ranking-snapshot.service"
import type { RankingResult } from "../../types"

const RESULT: RankingResult = {
  snapshot: {
    rankedAt: "2026-11-12T00:00:00.000Z",
    corpusSize: 2,
    unscoredCount: 0,
    averageDocumentLength: 10,
    queryTerms: ["typescript"],
    topK: 20,
    minScore: null,
    lexicalWeight: 0.65,
    fitWeight: 0.35,
  },
  entries: [{ postingId: "job-1", rank: 1, score: 80 } as never],
  excluded: [],
}

const ROW = {
  id: "snapshot-1",
  userId: "u1",
  kind: "SAVED_JOBS",
  topK: 20,
  minScore: null,
  poolSize: 2,
  entryCount: 1,
  reranked: false,
  payload: RESULT,
  createdAt: new Date("2026-11-12T00:00:00.000Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.create.mockResolvedValue(ROW)
  mocks.findFirst.mockResolvedValue(ROW)
})

describe("saveRankingSnapshot", () => {
  it("persists the exact result the route returned", async () => {
    const view = await saveRankingSnapshot({
      userId: "u1",
      result: RESULT,
      reranked: false,
      poolSize: 2,
    })

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        poolSize: 2,
        entryCount: 1,
        payload: RESULT,
      }),
    })
    expect(view).toMatchObject({ id: "snapshot-1", entryCount: 1, result: RESULT })
  })

  it("never fails the ranking when persistence fails", async () => {
    mocks.create.mockRejectedValue(new Error("db down"))
    await expect(
      saveRankingSnapshot({
        userId: "u1",
        result: RESULT,
        reranked: false,
        poolSize: 2,
      })
    ).resolves.toBeNull()
  })
})

describe("getLatestRankingSnapshot", () => {
  it("returns the newest owner snapshot", async () => {
    const view = await getLatestRankingSnapshot("u1")
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: { createdAt: "desc" },
    })
    expect(view).toMatchObject({ id: "snapshot-1", result: RESULT })
  })

  it("returns null when the owner has not ranked yet", async () => {
    mocks.findFirst.mockResolvedValue(null)
    await expect(getLatestRankingSnapshot("u1")).resolves.toBeNull()
  })
})
