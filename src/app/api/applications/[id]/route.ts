import { NextResponse } from "next/server"
import { z } from "zod"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { logActivityEvent, resolveApiUserId } from "@/features/auth/api-auth"
import { prisma } from "@/shared/lib/prisma"

export const dynamic = "force-dynamic"

const patchSchema = z.object({
  status: z.nativeEnum(ApplicationStatus).optional(),
  followUpAt: z.string().nullable().optional(),
  outcomeNote: z.string().max(2000).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  contact: z.string().max(300).nullable().optional(),
})

const TERMINAL = new Set<ApplicationStatus>(["OFFER", "REJECTED", "WITHDRAWN"])

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params

  const application = await prisma.jobApplication.findFirst({
    where: { id, userId },
    include: { job: true, todos: { orderBy: { createdAt: "asc" } } },
  })
  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ application }, { headers: { "Cache-Control": "private, max-age=10, s-maxage=0" } })
}

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

  const existing = await prisma.jobApplication.findFirst({
    where: { id, userId },
    select: { id: true, status: true, job: { select: { title: true, companyName: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (parsed.data.status) {
    data.status = parsed.data.status
    if (TERMINAL.has(parsed.data.status)) {
      data.outcomeAt = new Date()
      data.followUpAt = null
    }
    if (parsed.data.status === "APPLIED") data.dateApplied = new Date()
  }
  if (parsed.data.followUpAt !== undefined) {
    data.followUpAt = parsed.data.followUpAt ? new Date(parsed.data.followUpAt) : null
    if (parsed.data.followUpAt) data.lastFollowedUpAt = null
  }
  if (parsed.data.outcomeNote !== undefined) {
    const t = (parsed.data.outcomeNote ?? "").trim()
    data.outcomeNote = t === "" ? null : t
  }
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes?.trim() ? parsed.data.notes : null
  if (parsed.data.contact !== undefined) data.contact = parsed.data.contact?.trim() ? parsed.data.contact : null

  const application = await prisma.jobApplication.update({ where: { id }, data })

  if (parsed.data.status && parsed.data.status !== existing.status) {
    await logActivityEvent({
      userId,
      type: "application.status",
      title: `${existing.job.title} at ${existing.job.companyName} → ${parsed.data.status}`,
      metadata: { applicationId: id, from: existing.status, to: parsed.data.status },
    })
  }
  if (parsed.data.followUpAt !== undefined) {
    await logActivityEvent({
      userId,
      type: parsed.data.followUpAt ? "application.followup" : "application.followup-done",
      title: parsed.data.followUpAt
        ? `Follow-up set for ${existing.job.title}`
        : `Follow-up done for ${existing.job.title}`,
      metadata: { applicationId: id, followUpAt: parsed.data.followUpAt },
    })
  }

  return NextResponse.json({ application })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params

  const existing = await prisma.jobApplication.findFirst({ where: { id, userId }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.jobApplication.delete({ where: { id } })
  await logActivityEvent({ userId, type: "application.deleted", title: "Removed an application", metadata: { applicationId: id } })
  return NextResponse.json({ ok: true })
}
