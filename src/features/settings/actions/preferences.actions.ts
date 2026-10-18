"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import {
  parsePreferences,
  preferencesSchema,
  type UpdatePreferencesInput,
} from "../schemas/preferences.schema"

/**
 * Takes the whole preferences object rather than one argument per field: the
 * set grows, and a list of positional primitives is a silent-swap hazard.
 *
 * The column holds keys this form does not own (the discovery ATS watchlist),
 * so the write is read-merge-write: saving the settings page must never blank
 * a preference the user set somewhere else.
 */
export async function updatePreferences(input: UpdatePreferencesInput) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = preferencesSchema.safeParse(input)
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
        preferences: {
          ...parsePreferences(user?.preferences),
          defaultAiInstructions: parsed.data.defaultAiInstructions,
          emailNotifications: parsed.data.emailNotifications,
          preferredCurrency: parsed.data.preferredCurrency,
        },
      },
      select: { id: true },
    })

    revalidatePath("/settings")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}
