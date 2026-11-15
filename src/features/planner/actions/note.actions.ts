"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { createNoteSchema, updateNoteSchema } from "../schemas/planner.schema"

export async function createNote(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const raw = Object.fromEntries(formData)
  const parsed = createNoteSchema.safeParse(raw)
  if (!parsed.success) return { error: "Invalid input", details: parsed.error.flatten() }

  const { content } = parsed.data

  try {
    const note = await prisma.note.create({
      data: {
        userId: session.user.id,
        content,
      },
      select: { id: true },
    })

    revalidatePath("/planner")
    return { success: true as const, id: note.id }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function updateNote(id: string, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const existing = await prisma.note.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!existing) return { error: "Not found" }

    const raw = Object.fromEntries(formData)
    const parsed = updateNoteSchema.safeParse(raw)
    if (!parsed.success) return { error: "Invalid input", details: parsed.error.flatten() }

    const { content } = parsed.data

    await prisma.note.update({
      where: { id },
      data: {
        ...(content !== undefined ? { content } : {}),
      },
    })

    revalidatePath("/planner")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function deleteNote(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const existing = await prisma.note.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!existing) return { error: "Not found" }

    await prisma.note.delete({ where: { id } })
    revalidatePath("/planner")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}
