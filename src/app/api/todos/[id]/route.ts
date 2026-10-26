import { NextResponse } from "next/server"
import { z } from "zod"
import { logActivityEvent, resolveApiUserId } from "@/features/auth/api-auth"
import { prisma } from "@/shared/lib/prisma"

export const dynamic = "force-dynamic"

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  done: z.boolean().optional(),
  dueDate: z.string().nullable().optional(),
})

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const existing = await prisma.todo.findFirst({ where: { id, userId }, select: { id: true, title: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const todo = await prisma.todo.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim() } : {}),
      ...(parsed.data.done !== undefined ? { done: parsed.data.done } : {}),
      ...(parsed.data.dueDate !== undefined
        ? { dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null }
        : {}),
    },
  })

  if (parsed.data.done === true) {
    await logActivityEvent({
      userId,
      type: "todo.done",
      title: `Done: ${existing.title.slice(0, 120)}`,
      metadata: { todoId: id },
    })
  }

  return NextResponse.json({ todo })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params

  const existing = await prisma.todo.findFirst({ where: { id, userId }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.todo.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
