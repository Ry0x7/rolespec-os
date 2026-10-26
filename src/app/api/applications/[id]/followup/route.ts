import { NextResponse } from "next/server"
import { z } from "zod"
import { logActivityEvent, resolveApiUserId } from "@/features/auth/api-auth"
import { prisma } from "@/shared/lib/prisma"

export const dynamic = "force-dynamic"

const postSchema = z.object({
  /** ISO date for the chase; defaults to 7 days out when omitted. */
  followUpAt: z.string().optional(),
  snoozeDays: z.coerce.number().int().min(1).max(30).default(7),
})

/**
 * `POST /api/applications/[id]/followup` — explicit schedule/snooze for the
 * workspace chase list. `DELETE` clears it and stamps `lastFollowedUpAt`.
 * Thin wrapper over the same columns the server actions own; every read is
 * scoped to the resolved single-owner user id.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const existing = await prisma.jobApplication.findFirst({
    where: { id, userId },
    select: { id: true, job: { select: { title: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const followUpAt = parsed.data.followUpAt
    ? new Date(parsed.data.followUpAt)
    : new Date(Date.now() + parsed.data.snoozeDays * 86400000)
  if (Number.isNaN(followUpAt.getTime())) return NextResponse.json({ error: "Invalid date" }, { status: 400 })

  await prisma.jobApplication.update({ where: { id }, data: { followUpAt } })
  await logActivityEvent({
    userId, type: "application.followup",
    title: `Follow-up set for ${existing.job.title}`,
    metadata: { applicationId: id, followUpAt: followUpAt.toISOString() },
  })
  return NextResponse.json({ followUpAt })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params

  const existing = await prisma.jobApplication.findFirst({ where: { id, userId }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.jobApplication.update({
    where: { id },
    data: { followUpAt: null, lastFollowedUpAt: new Date() },
  })
  await logActivityEvent({ userId, type: "application.followup-done", title: "Follow-up completed", metadata: { applicationId: id } })
  return NextResponse.json({ ok: true })
}
