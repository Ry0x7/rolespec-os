import { NextResponse } from "next/server"
import { z } from "zod"
import { logActivityEvent, resolveApiUserId } from "@/features/auth/api-auth"
import { prisma } from "@/shared/lib/prisma"

export const dynamic = "force-dynamic"

const querySchema = z.object({
  done: z.coerce.boolean().optional(),
  jobApplicationId: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().cuid().optional(),
})

const createSchema = z.object({
  title: z.string().min(1).max(200),
  dueDate: z.string().optional(),
  jobApplicationId: z.string().cuid().optional(),
})

export async function GET(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const params = new URL(req.url).searchParams
  const parsed = querySchema.safeParse({
    done: params.get("done") ?? undefined,
    jobApplicationId: params.get("jobApplicationId") ?? undefined,
    limit: params.get("limit") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: "Invalid query" }, { status: 400 })

  const todos = await prisma.todo.findMany({
    where: {
      userId,
      ...(parsed.data.done !== undefined ? { done: parsed.data.done } : {}),
      ...(parsed.data.jobApplicationId ? { jobApplicationId: parsed.data.jobApplicationId } : {}),
    },
    orderBy: [{ done: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    take: parsed.data.limit + 1,
    ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
  })
  const hasMore = todos.length > parsed.data.limit
  const page = hasMore ? todos.slice(0, parsed.data.limit) : todos
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null
  return NextResponse.json(
    { todos: page, hasMore, nextCursor },
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

  let jobApplicationId: string | null = null
  if (parsed.data.jobApplicationId) {
    const link = await prisma.jobApplication.findFirst({
      where: { id: parsed.data.jobApplicationId, userId },
      select: { id: true },
    })
    if (!link) return NextResponse.json({ error: "Application not found" }, { status: 404 })
    jobApplicationId = link.id
  }

  const todo = await prisma.todo.create({
    data: {
      userId,
      title: parsed.data.title.trim(),
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      jobApplicationId,
    },
    select: { id: true },
  })

  await logActivityEvent({
    userId,
    type: "todo.created",
    title: parsed.data.title.trim().slice(0, 120),
    metadata: { todoId: todo.id, jobApplicationId },
  })

  return NextResponse.json({ id: todo.id }, { status: 201 })
}
