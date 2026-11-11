import { Prisma } from "@/generated/prisma/client"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"

import type { RankingResult } from "../types"

const log = logger("ranking/snapshot")

export interface RankingSnapshotView {
  id: string
  kind: string
  topK: number | null
  minScore: number | null
  poolSize: number
  entryCount: number
  reranked: boolean
  result: RankingResult
  createdAt: string
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

/**
 * Best-effort persistence: a leaderboard snapshot is useful history, not a
 * reason to fail a ranking the user asked for. The route reports `snapshotId`
 * only when the write succeeded.
 */
export async function saveRankingSnapshot(input: {
  userId: string
  result: RankingResult
  reranked: boolean
  poolSize: number
  kind?: string
}): Promise<RankingSnapshotView | null> {
  try {
    const row = await prisma.rankingSnapshot.create({
      data: {
        userId: input.userId,
        kind: input.kind ?? "SAVED_JOBS",
        topK: input.result.snapshot.topK,
        minScore: input.result.snapshot.minScore,
        poolSize: input.poolSize,
        entryCount: input.result.entries.length,
        reranked: input.reranked,
        payload: json(input.result),
      },
    })
    return {
      id: row.id,
      kind: row.kind,
      topK: row.topK,
      minScore: row.minScore,
      poolSize: row.poolSize,
      entryCount: row.entryCount,
      reranked: row.reranked,
      result: row.payload as unknown as RankingResult,
      createdAt: row.createdAt.toISOString(),
    }
  } catch (error) {
    log.warn("Could not persist ranking snapshot", {
      userId: input.userId,
      err: error,
    })
    return null
  }
}

export async function getLatestRankingSnapshot(
  userId: string
): Promise<RankingSnapshotView | null> {
  const row = await prisma.rankingSnapshot.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  })
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    topK: row.topK,
    minScore: row.minScore,
    poolSize: row.poolSize,
    entryCount: row.entryCount,
    reranked: row.reranked,
    result: row.payload as unknown as RankingResult,
    createdAt: row.createdAt.toISOString(),
  }
}
