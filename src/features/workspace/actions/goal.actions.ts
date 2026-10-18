"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { GoalPeriod } from "@/generated/prisma/enums"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"

const updateApplicationGoalSchema = z.object({
  target: z.number().int().min(1).max(100),
  period: z.nativeEnum(GoalPeriod),
})

export async function updateApplicationGoal(
  target: number,
  period: "DAILY" | "WEEKLY",
) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = updateApplicationGoalSchema.safeParse({ target, period })
  if (!parsed.success) return { error: "Invalid input", details: parsed.error.flatten() }

  try {
    await prisma.playerProfile.update({
      where: { userId: session.user.id },
      data: {
        applicationGoalTarget: parsed.data.target,
        applicationGoalPeriod: parsed.data.period,
      },
      select: { id: true },
    })

    revalidatePath("/workspace")
    return { success: true as const }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2025"
    ) {
      return { error: "Profile not found" }
    }
    return { error: "Something went wrong. Please try again." }
  }
}
