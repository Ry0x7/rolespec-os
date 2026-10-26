"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/features/auth/config"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import { onboardingSchema } from "@/features/auth/schemas"

const log = logger("onboarding-actions")

const completeOnboardingSchema = onboardingSchema.partial().extend({
  applicationGoalTarget: z.number().int().min(1).max(200).optional(),
  applicationGoalPeriod: z.enum(["DAILY", "WEEKLY"]).optional(),
})

export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>

function blankToUndefined(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Low-friction draft save: persists profile progress without marking
 * onboarding complete, so the user can "Save & finish later" and resume
 * where they left off. Never sets `onboardedAt`.
 */
export async function saveOnboardingDraft(input: CompleteOnboardingInput) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = completeOnboardingSchema.safeParse({
    ...input,
    currentRole: blankToUndefined(input.currentRole),
    targetRole: blankToUndefined(input.targetRole),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const { currentRole, targetRole, experienceLevel, applicationGoalTarget, applicationGoalPeriod } =
    parsed.data

  try {
    await prisma.playerProfile.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        ...(currentRole !== undefined && { currentRole }),
        ...(targetRole !== undefined && { targetRole }),
        ...(experienceLevel !== undefined && { experienceLevel }),
        ...(applicationGoalTarget !== undefined && { applicationGoalTarget }),
        ...(applicationGoalPeriod !== undefined && { applicationGoalPeriod }),
      },
      update: {
        ...(currentRole !== undefined && { currentRole }),
        ...(targetRole !== undefined && { targetRole }),
        ...(experienceLevel !== undefined && { experienceLevel }),
        ...(applicationGoalTarget !== undefined && { applicationGoalTarget }),
        ...(applicationGoalPeriod !== undefined && { applicationGoalPeriod }),
      },
    })
    revalidatePath("/onboarding")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function completeOnboarding(input: CompleteOnboardingInput) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = completeOnboardingSchema.safeParse({
    ...input,
    currentRole: blankToUndefined(input.currentRole),
    targetRole: blankToUndefined(input.targetRole),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const { currentRole, targetRole, experienceLevel, applicationGoalTarget, applicationGoalPeriod } =
    parsed.data

  const data = {
    ...(currentRole !== undefined && { currentRole }),
    ...(targetRole !== undefined && { targetRole }),
    ...(experienceLevel !== undefined && { experienceLevel }),
    ...(applicationGoalTarget !== undefined && { applicationGoalTarget }),
    ...(applicationGoalPeriod !== undefined && { applicationGoalPeriod }),
    onboardedAt: new Date(),
  }

  try {
    await prisma.playerProfile.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, ...data },
      update: data,
    })

    // Additive: a new account also needs the canonical Career Profile that the
    // migration created for pre-existing accounts, plus the one legacy field
    // that is genuinely a statement of direction. Best-effort on purpose — the
    // legacy write above is what onboarding has always depended on, so a
    // failure here must not fail onboarding. Nothing else is copied: no
    // evidence or capability is inferred from onboarding answers.
    try {
      const careerProfile = await prisma.careerProfile.upsert({
        where: { userId: session.user.id },
        create: { userId: session.user.id },
        update: {},
        select: { id: true },
      })

      if (targetRole) {
        const existing = await prisma.careerTargetRole.findFirst({
          where: { careerProfileId: careerProfile.id, title: targetRole },
          select: { id: true },
        })
        if (!existing) {
          await prisma.careerTargetRole.create({
            data: { careerProfileId: careerProfile.id, title: targetRole },
            select: { id: true },
          })
        }
      }
    } catch (err) {
      log.warn("Failed to seed career profile during onboarding", { err })
    }

    revalidatePath("/dashboard")
    revalidatePath("/career-profile")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}
