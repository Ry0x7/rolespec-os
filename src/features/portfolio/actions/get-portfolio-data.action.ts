"use server"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import {
  toProfileRatingData,
  type ProfileRatingData,
} from "@/shared/lib/rating/rating.service"

export interface PortfolioData {
  /** Most recent portfolio rating, if any. */
  portfolio: ProfileRatingData | null
}

export async function getPortfolioData(): Promise<{
  error?: string
  data?: PortfolioData
}> {
  const session = await auth()
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  const userId = session.user.id

  const latestRating = await prisma.profileRating.findFirst({
    where: { userId, kind: "PORTFOLIO" },
    orderBy: { createdAt: "desc" },
  })

  return {
    data: {
      portfolio: latestRating ? toProfileRatingData(latestRating) : null,
    },
  }
}
