"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { createTodoSchema, updateTodoSchema } from "../schemas/planner.schema"

async function resolveJobApplicationId(
  userId: string,
  jobApplicationId: string | undefined
): Promise<string | null> {
  if (!jobApplicationId) return null
  const job = await prisma.jobApplication.findUnique({
    where: { id: jobApplicationId, userId },
    select: { id: true },
  })
  return job ? job.id : null
}

/**
 * A todo shows up on three surfaces now: the planner, the job it hangs off and
 * the dashboard's "Upcoming". Every write has to refresh all of them, or adding
 * a task from a job detail page leaves the page it was added from stale.
 *
 * `ids` is the job application the todo was on *and* the one it is on now —
 * re-linking a todo has to clear the old page as well.
 */
function revalidateTodoSurfaces(...jobApplicationIds: (string | null | undefined)[]) {
  revalidatePath("/planner")
  revalidatePath("/dashboard")
  for (const id of new Set(jobApplicationIds.filter((value): value is string => Boolean(value)))) {
    revalidatePath(`/jobs/${id}`)
  }
}

export async function createTodo(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const raw = Object.fromEntries(formData)
  const parsed = createTodoSchema.safeParse(raw)
  if (!parsed.success) return { error: "Invalid input", details: parsed.error.flatten() }

  const { title, dueDate, jobApplicationId } = parsed.data

  try {
    const linkedId = await resolveJobApplicationId(
      session.user.id,
      jobApplicationId || undefined
    )
    const todo = await prisma.todo.create({
      data: {
        userId: session.user.id,
        title,
        dueDate: dueDate ? new Date(dueDate) : null,
        jobApplicationId: linkedId,
      },
      select: { id: true },
    })

    revalidateTodoSurfaces(linkedId)
    return { success: true as const, id: todo.id }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function updateTodo(id: string, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const existing = await prisma.todo.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true, jobApplicationId: true },
    })
    if (!existing) return { error: "Not found" }

    const raw = Object.fromEntries(formData)
    const parsed = updateTodoSchema.safeParse(raw)
    if (!parsed.success) return { error: "Invalid input", details: parsed.error.flatten() }

    const { title, done, dueDate, jobApplicationId } = parsed.data

    const nextLinkedId =
      jobApplicationId !== undefined
        ? await resolveJobApplicationId(session.user.id, jobApplicationId || undefined)
        : undefined

    await prisma.todo.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(done !== undefined ? { done } : {}),
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        ...(nextLinkedId !== undefined ? { jobApplicationId: nextLinkedId } : {}),
      },
    })

    revalidateTodoSurfaces(existing.jobApplicationId, nextLinkedId)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function deleteTodo(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const existing = await prisma.todo.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true, jobApplicationId: true },
    })
    if (!existing) return { error: "Not found" }

    await prisma.todo.delete({ where: { id } })
    revalidateTodoSurfaces(existing.jobApplicationId)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}
