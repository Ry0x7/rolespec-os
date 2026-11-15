"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/features/auth/config"
import {
  atsWatchlistSchema,
  parsePreferences,
  type AtsWatchlistInput,
} from "@/features/settings/schemas/preferences.schema"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"

/**
 * The companies whose ATS boards discovery scans for this user.
 *
 * Stored in the shared `preferences` Json column, so the write is
 * read-merge-write: it must never blank a preference the settings page owns.
 */

const log = logger("discovery")

export async function updateAtsWatchlist(input: AtsWatchlistInput) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = atsWatchlistSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferences: true },
    })

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        preferences: { ...parsePreferences(user?.preferences), atsWatchlist: parsed.data },
      },
      select: { id: true },
    })

    revalidatePath("/jobs/discover")
    return { success: true as const }
  } catch (err) {
    log.error("Failed to update the ATS watchlist", { err, userId: session.user.id })
    return { error: "Something went wrong. Please try again." }
  }
}
