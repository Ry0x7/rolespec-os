import { prisma } from "@/shared/lib/prisma"
import { PROFILE_RATING_RATE_LIMIT_MAX } from "@/shared/lib/rating/constants"
import { rateLimitWindowStart } from "@/shared/lib/rating/rating.service"
import type { LinkedinSuggestions } from "./linkedin-assist"

/**
 * Same window and cap as the ratings, measured against LinkedinSuggestion rows
 * (indexed on [userId, createdAt]) since assists persist to their own table.
 */
export async function isLinkedinAssistRateLimited(userId: string): Promise<boolean> {
  const recent = await prisma.linkedinSuggestion.count({
    where: {
      userId,
      createdAt: { gte: rateLimitWindowStart() },
    },
  })
  return recent >= PROFILE_RATING_RATE_LIMIT_MAX
}

/** Serializable LinkedIn Assist payload — same shape from the route and the action. */
export interface LinkedinSuggestionData {
  id: string
  suggestions: LinkedinSuggestions
  /** ISO timestamp — kept as a string so the action and the route API match. */
  createdAt: string
}

interface LinkedinSuggestionRow {
  id: string
  suggestions: unknown
  createdAt: Date
}

/** Normalizes a LinkedinSuggestion row into the wire shape. */
export function toLinkedinSuggestionData(
  row: LinkedinSuggestionRow
): LinkedinSuggestionData {
  return {
    id: row.id,
    suggestions: row.suggestions as LinkedinSuggestions,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Writes a suggestions row and returns it in the wire shape. */
export async function persistLinkedinSuggestions(input: {
  userId: string
  suggestions: LinkedinSuggestions
}): Promise<LinkedinSuggestionData> {
  const row = await prisma.linkedinSuggestion.create({
    data: {
      userId: input.userId,
      suggestions: input.suggestions,
    },
  })

  return toLinkedinSuggestionData(row)
}
