import { NextResponse } from "next/server"
import { z } from "zod"
import { resolveApiUserId } from "@/features/auth/api-auth"
import { prisma } from "@/shared/lib/prisma"

export const dynamic = "force-dynamic"

const patchSchema = z.object({
  companyName: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(200).optional(),
  url: z.string().max(2000).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  description: z.string().max(50000).nullable().optional(),
})

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params

  const job = await prisma.job.findFirst({
    where: { id, userId },
    include: { applications: { orderBy: { createdAt: "desc" } } },
  })
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ job }, { headers: { "Cache-Control": "private, max-age=10, s-maxage=0" } })
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

  const existing = await prisma.job.findFirst({ where: { id, userId }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const job = await prisma.job.update({ where: { id }, data: parsed.data })
  return NextResponse.json({ job })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params

  const existing = await prisma.job.findFirst({
    where: { id, userId },
    select: { id: true, applications: { select: { id: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (existing.applications.length > 0) {
    return NextResponse.json(
      { error: "Delete the linked application first — it owns this posting's history." },
      { status: 409 }
    )
  }

  await prisma.job.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
