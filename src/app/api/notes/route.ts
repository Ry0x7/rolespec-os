import { NextResponse } from "next/server"
import { z } from "zod"
import { logActivityEvent, resolveApiUserId } from "@/features/auth/api-auth"
import { prisma } from "@/shared/lib/prisma"

export const dynamic = "force-dynamic"

const createSchema = z.object({ content: z.string().min(1).max(10000) })

export async function GET(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const params = new URL(req.url).searchParams
  const limit = Math.min(Math.max(Number(params.get("limit") || 50), 1), 100)
  const cursor = params.get("cursor") ?? undefined
  const notes = await prisma.note.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const hasMore = notes.length > limit
  const page = hasMore ? notes.slice(0, limit) : notes
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null
  return NextResponse.json(
    { notes: page, hasMore, nextCursor },
    { headers: { "Cache-Control": "private, max-age=10, s-maxage=0" } }
  )
}

export async function POST(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const note = await prisma.note.create({
    data: { userId, content: parsed.data.content },
    select: { id: true },
  })

  await logActivityEvent({
    userId,
    type: "note.created",
    title: "Captured a note",
    body: parsed.data.content.slice(0, 280),
    metadata: { noteId: note.id },
  })

  return NextResponse.json({ id: note.id }, { status: 201 })
}
