import { prisma } from "@/shared/lib/prisma"

import type { RankedEntry, RankingPosting, RankingResult } from "../types"
import { rankJobPool } from "./ranking.service"
import { readRankingProfile } from "./ranking-profile.service"
import { rerankShortlist } from "./rerank.service"

export interface RankSavedJobsInput {
  userId: string
  jobIds?: string[]
  topK?: number
  minScore?: number
  lexicalWeight?: number
  rerank?: boolean
  now?: Date
}

export interface RankSavedJobsResult {
  result: RankingResult
  /** True only when the model returned grounded judgements for the shortlist. */
  reranked: boolean
  warnings: string[]
  poolSize: number
}

function requirementFlags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

/**
 * Ranks the caller's saved jobs.
 *
 * Saved postings are the one pool that is already persisted and owned, so this
 * is the reusable ranking surface: no discovery run required, no new table, and
 * top-K/threshold only affect the response. A job that falls outside the cut is
 * reported in `excluded`, never deleted or hidden from the tracker.
 */
export async function rankSavedJobs(
  input: RankSavedJobsInput
): Promise<RankSavedJobsResult> {
  const [profile, jobs] = await Promise.all([
    readRankingProfile(input.userId),
    prisma.job.findMany({
      where: {
        userId: input.userId,
        ...(input.jobIds && input.jobIds.length > 0 ? { id: { in: input.jobIds } } : {}),
      },
      select: {
        id: true,
        title: true,
        companyName: true,
        description: true,
        location: true,
        workType: true,
        salary: true,
        salaryPeriod: true,
        salaryCurrency: true,
        postedAt: true,
        requirementFlags: true,
        url: true,
      },
      orderBy: [{ createdAt: "desc" }],
    }),
  ])

  const postings: RankingPosting[] = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    companyName: job.companyName,
    description: job.description,
    location: job.location,
    workType: job.workType,
    salary: job.salary,
    salaryCurrency: job.salaryCurrency,
    salaryPeriod: job.salaryPeriod,
    postedAt: job.postedAt,
    requirementFlags: requirementFlags(job.requirementFlags),
    url: job.url,
  }))

  const result = rankJobPool({
    postings,
    profile,
    options: {
      topK: input.topK,
      minScore: input.minScore,
      lexicalWeight: input.lexicalWeight,
      now: input.now,
    },
  })

  if (input.rerank !== true || result.entries.length === 0) {
    return { result, reranked: false, warnings: [], poolSize: postings.length }
  }

  const postingsById = new Map(postings.map((posting) => [posting.id, posting]))
  const reranked: { entries: RankedEntry[]; reranked: boolean; warnings: string[] } =
    await rerankShortlist({
      userId: input.userId,
      entries: result.entries,
      postings: postingsById,
    })

  return {
    result: { ...result, entries: reranked.entries },
    reranked: reranked.reranked,
    warnings: reranked.warnings,
    poolSize: postings.length,
  }
}
