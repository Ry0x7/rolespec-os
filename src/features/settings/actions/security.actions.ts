"use server"

import { z } from "zod"
import bcrypt from "bcryptjs"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = changePasswordSchema.safeParse({
    currentPassword,
    newPassword,
    confirmPassword,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  })
  if (!user?.password) {
    return { error: "This account does not use a password." }
  }

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.password)
  if (!valid) return { error: "Current password is incorrect" }

  try {
    const hashed = await bcrypt.hash(parsed.data.newPassword, 12)
    await prisma.user.update({
      where: { id: session.user.id },
      // Stamping the change invalidates every session minted before now on its
      // next JWT refresh (see `syncTokenProfile`).
      data: { password: hashed, passwordChangedAt: new Date() },
      select: { id: true },
    })

    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}
