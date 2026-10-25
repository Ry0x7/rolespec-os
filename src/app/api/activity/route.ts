import { NextResponse } from "next/server"
import { z } from "zod"
import { logActivityEvent, resolveApiUserId } from "@/features/auth/api-auth"
import { prisma } from "@/shared/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * `GET /api/activity` — the OS feed behind the workspace timeline and the
 * jobs page's "recent" rail. Unions:
 *  - explicit `activity_events` rows (human narrative, written best-effort),
 *  - latest application moves (ground truth even when the feed table is empty),
 *  - open todos due soon.
 *
 * An absent feed row never hides current state: live rows are always included.
 */
export async function GET(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const params = new URL(req.url).searchParams
  const rawCursor = params.get("cursor")
  const cursorCreatedAt = rawCursor ? new Date(rawCursor) : null
  const validCursor = cursorCreatedAt && !Number.isNaN(cursorCreatedAt.getTime()) ? cursorCreatedAt : null
  const limit = Math.min(Math.max(Number(params.get("limit") || 30), 1), 100)

  const [events, applications, todos] = await Promise.all([
    prisma.activityEvent.findMany({
      where: { userId, ...(validCursor ? { createdAt: { lt: validCursor } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    }),
    prisma.jobApplication.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true, status: true, followUpAt: true, updatedAt: true,
        job: { select: { title: true, companyName: true } },
      },
    }),
    prisma.todo.findMany({
      where: { userId, done: false },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 10,
      select: { id: true, title: true, dueDate: true, jobApplicationId: true },
    }),
  ])

  const hasMore = events.length > limit
  const page = hasMore ? events.slice(0, limit) : events
  const nextCursor = hasMore ? page[page.length - 1]?.createdAt.toISOString() ?? null : null
  return NextResponse.json(
    {
    hasMore,
    nextCursor,
    events: page.map((e) => ({
      id: e.id, type: e.type, title: e.title, body: e.body,
      metadata: e.metadata, createdAt: e.createdAt, source: "event" as const,
    })),
    recentApplications: applications.map((a) => ({
      id: `app-${a.id}-${a.updatedAt.toISOString()}`,
      type: "application.status",
      title: `${a.job.title} at ${a.job.companyName} — ${a.status}`,
      applicationId: a.id,
      followUpAt: a.followUpAt,
      createdAt: a.updatedAt,
      source: "application" as const,
    })),
    upcomingTodos: todos.map((t) => ({
      id: `todo-${t.id}`,
      type: "todo.open",
      title: t.title,
      jobApplicationId: t.jobApplicationId,
      dueDate: t.dueDate,
      source: "todo" as const,
    }),
    },
    { headers: { "Cache-Control": "private, max-age=10, s-maxage=0" } }
  )
}

const postSchema = z.object({
  type: z.string().min(1).max(80),
  title: z.string().min(1).max(300),
  body: z.string().max(4000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/** `POST /api/activity` — lets workspace/job clients log narrative entries. */
export async function POST(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  await logActivityEvent({
    userId,
    type: parsed.data.type,
    title: parsed.data.title,
    body: parsed.data.body ?? null,
    metadata: (parsed.data.metadata ?? null) as Record<string, unknown> | null,
  })
  return NextResponse.json({ ok: true }, { status: 201 })
}
