"use server"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import {
  toProfileRatingData,
  type ProfileRatingData,
} from "@/shared/lib/rating/rating.service"
import {
  toLinkedinSuggestionData,
  type LinkedinSuggestionData,
} from "../services/linkedin.service"

export interface LinkedinData {
  /** Most recent LinkedIn rating, if any. */
  linkedin: ProfileRatingData | null
  /** Most recent LinkedIn Assist run, if any. */
  linkedinSuggestions: LinkedinSuggestionData | null
}

export async function getLinkedinData(): Promise<{
  error?: string
  data?: LinkedinData
}> {
  const session = await auth()
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const userId = session.user.id

  const [latestRating, latestSuggestions] = await Promise.all([
    prisma.profileRating.findFirst({
      where: { userId, kind: "LINKEDIN" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.linkedinSuggestion.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
  ])

  return {
    data: {
      linkedin: latestRating ? toProfileRatingData(latestRating) : null,
      linkedinSuggestions: latestSuggestions
        ? toLinkedinSuggestionData(latestSuggestions)
        : null,
    },
  }
}
