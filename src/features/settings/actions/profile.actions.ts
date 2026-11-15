"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"

const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  image: z.union([z.literal(""), z.url("Enter a valid image URL")]),
})

export async function updateProfile(name: string, image: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = updateProfileSchema.safeParse({ name, image })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        name: parsed.data.name,
        image: parsed.data.image === "" ? null : parsed.data.image,
      },
      select: { id: true },
    })

    revalidatePath("/settings")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}
