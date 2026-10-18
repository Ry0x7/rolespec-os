import { prisma } from "@/shared/lib/prisma"
import type { ProfileRatingKind } from "@/generated/prisma/enums"
import type { RatingBenchmark, RatingIssue, RatingSuggestions } from "./schemas"
import {
  PROFILE_RATING_RATE_LIMIT_MAX,
  PROFILE_RATING_RATE_LIMIT_WINDOW_MS,
} from "./constants"

/** Serializable rating payload returned to the client by both entry points. */
export interface ProfileRatingData {
  id: string
  kind: ProfileRatingKind
  sourceUrl: string | null
  overallScore: number
  scores: Record<string, number>
  issues: RatingIssue[]
  suggestions: RatingSuggestions
  /** Competitor comparison — null for portfolio ratings and pre-benchmark rows. */
  benchmark: RatingBenchmark | null
  /** ISO timestamp — kept as a string so the action and the route API match. */
  createdAt: string
}

interface ProfileRatingRow {
  id: string
  kind: ProfileRatingKind
  sourceUrl: string | null
  overallScore: number
  scores: unknown
  issues: unknown
  suggestions: unknown
  benchmark?: unknown
  createdAt: Date
}

/** Normalizes a ProfileRating row into the wire shape. */
export function toProfileRatingData(row: ProfileRatingRow): ProfileRatingData {
  return {
    id: row.id,
    kind: row.kind,
    sourceUrl: row.sourceUrl,
    overallScore: row.overallScore,
    scores: (row.scores ?? {}) as Record<string, number>,
    issues: (row.issues ?? []) as RatingIssue[],
    suggestions: (row.suggestions ?? { items: [] }) as RatingSuggestions,
    benchmark: (row.benchmark ?? null) as RatingBenchmark | null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The user's most recent rating of a kind, or null when they have none. */
export async function getLatestProfileRating(
  userId: string,
  kind: ProfileRatingKind
): Promise<ProfileRatingData | null> {
  const row = await prisma.profileRating.findFirst({
    where: { userId, kind },
    orderBy: { createdAt: "desc" },
  })

  return row ? toProfileRatingData(row) : null
}

/** Start of the current sliding window, shared by every rating limit. */
export function rateLimitWindowStart(): Date {
  return new Date(Date.now() - PROFILE_RATING_RATE_LIMIT_WINDOW_MS)
}

/**
 * True when the user already used up the per-kind sliding window. ProfileRating
 * rows carry `createdAt` and are indexed on [userId, kind, createdAt], so the
 * window is measured against them — same approach as the ATS scan limit.
 */
export async function isProfileRatingRateLimited(
  userId: string,
  kind: ProfileRatingKind
): Promise<boolean> {
  const recent = await prisma.profileRating.count({
    where: {
      userId,
      kind,
      createdAt: { gte: rateLimitWindowStart() },
    },
  })
  return recent >= PROFILE_RATING_RATE_LIMIT_MAX
}

export interface PersistRatingInput {
  userId: string
  kind: ProfileRatingKind
  sourceUrl?: string | null
  result: {
    overallScore: number
    scores: Record<string, number>
    issues: RatingIssue[]
    suggestions: RatingSuggestions
    /** Only LinkedIn ratings produce one — portfolio ratings omit it. */
    benchmark?: RatingBenchmark
  }
}

/** Writes a rating row and returns it in the wire shape. */
export async function persistProfileRating(
  input: PersistRatingInput
): Promise<ProfileRatingData> {
  const row = await prisma.profileRating.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      sourceUrl: input.sourceUrl ?? null,
      overallScore: input.result.overallScore,
      scores: input.result.scores,
      issues: input.result.issues,
      suggestions: input.result.suggestions,
      // Nullable Json column: leaving it unset stores NULL for portfolio ratings.
      benchmark: input.result.benchmark,
    },
  })

  return toProfileRatingData(row)
}
