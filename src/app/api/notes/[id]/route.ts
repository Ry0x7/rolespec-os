import { NextResponse } from "next/server"
import { z } from "zod"
import { resolveApiUserId } from "@/features/auth/api-auth"
import { prisma } from "@/shared/lib/prisma"

export const dynamic = "force-dynamic"

const patchSchema = z.object({ content: z.string().min(1).max(10000) })

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

  const existing = await prisma.note.findFirst({ where: { id, userId }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const note = await prisma.note.update({ where: { id }, data: { content: parsed.data.content } })
  return NextResponse.json({ note })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params

  const existing = await prisma.note.findFirst({ where: { id, userId }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.note.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
