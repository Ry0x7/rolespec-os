import { NextResponse } from "next/server"
import { z } from "zod"
import { SalaryCurrency, SalaryPeriod } from "@/generated/prisma/enums"
import { logActivityEvent, resolveApiUserId } from "@/features/auth/api-auth"
import { canonicalizeUrl } from "@/features/discovery/services/normalize.service"
import { salaryColumnsFrom } from "@/features/jobs/services/job-record.service"
import { serializeMoney } from "@/shared/lib/money/money"
import { prisma } from "@/shared/lib/prisma"
import { isHttpUrl } from "@/shared/lib/url"

export const dynamic = "force-dynamic"

const querySchema = z.object({
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().cuid().optional(),
})

/** `DECIMAL(14,2)` upper bound. */
const MAX_MONEY = 999_999_999_999.99

const createSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    url: z
      .string()
      .trim()
      .max(2000)
      .refine((v) => v === "" || isHttpUrl(v), "Must be a valid http(s) URL")
      .optional(),
    location: z.string().max(200).optional().or(z.literal("")),
    description: z.string().max(50000).optional().or(z.literal("")),
    salaryMin: z.coerce.number().nonnegative().max(MAX_MONEY).optional(),
    salaryMax: z.coerce.number().nonnegative().max(MAX_MONEY).optional(),
    // No default: an absent currency means the posting never stated one.
    salaryCurrency: z.nativeEnum(SalaryCurrency).optional(),
    salaryPeriod: z.nativeEnum(SalaryPeriod).optional(),
    salaryTermMonths: z.coerce.number().int().min(1).max(120).optional(),
    salaryText: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) => v.salaryMin === undefined || v.salaryMax === undefined || v.salaryMin <= v.salaryMax,
    { path: ["salaryMax"], message: "Maximum pay must be at least the minimum" }
  )
  .refine((v) => v.salaryPeriod !== SalaryPeriod.CONTRACT || v.salaryTermMonths !== undefined, {
    path: ["salaryTermMonths"],
    message: "Contract pay needs a length in months",
  })

/** Prisma `Decimal` leaves the process as a string; dates stay ISO from JSON. */
function moneyWire<T extends { salaryMin: unknown; salaryMax: unknown; salaryAnnualMin: unknown; salaryAnnualMax: unknown }>(
  row: T
) {
  return {
    ...row,
    salaryMin: serializeMoney(row.salaryMin as never),
    salaryMax: serializeMoney(row.salaryMax as never),
    salaryAnnualMin: serializeMoney(row.salaryAnnualMin as never),
    salaryAnnualMax: serializeMoney(row.salaryAnnualMax as never),
  }
}

/**
 * `GET /api/jobs` — canonical posting list for the Jobs page + workspace widgets.
 * User-scoped; newest first; optional `?search=` matches company/title.
 */
export async function GET(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const params = new URL(req.url).searchParams
  const parsed = querySchema.safeParse({
    search: params.get("search") ?? undefined,
    limit: params.get("limit") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: "Invalid query" }, { status: 400 })

  const { search, limit, cursor } = parsed.data
  const jobs = await prisma.job.findMany({
    where: {
      userId,
      ...(search
        ? {
            OR: [
              { companyName: { contains: search, mode: "insensitive" } },
              { title: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      companyName: true,
      title: true,
      url: true,
      location: true,
      jobType: true,
      workType: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryPeriod: true,
      salaryTermMonths: true,
      salaryText: true,
      salaryProvenance: true,
      salaryAnnualMin: true,
      salaryAnnualMax: true,
      salaryNormalizedAt: true,
      source: true,
      createdAt: true,
      updatedAt: true,
      applications: { select: { id: true, status: true } },
    },
  })

  const hasMore = jobs.length > limit
  const page = hasMore ? jobs.slice(0, limit) : jobs
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null
  return NextResponse.json(
    { jobs: page.map(moneyWire), hasMore, nextCursor },
    { headers: { "Cache-Control": "private, max-age=10, s-maxage=0" } }
  )
}

/** `POST /api/jobs` — manual posting entry; dedupes on `(userId, canonicalUrl)`. */
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

  const canonicalUrl = parsed.data.url ? canonicalizeUrl(parsed.data.url) : ""
  if (canonicalUrl) {
    const existing = await prisma.job.findUnique({
      where: { userId_canonicalUrl: { userId, canonicalUrl } },
      select: { id: true },
    })
    if (existing) return NextResponse.json({ error: "You already track this posting.", id: existing.id }, { status: 409 })
  }

  const job = await prisma.job.create({
    data: {
      userId,
      companyName: parsed.data.companyName,
      title: parsed.data.title,
      url: parsed.data.url || null,
      location: parsed.data.location || null,
      description: parsed.data.description || null,
      canonicalUrl: canonicalUrl || null,
      source: "MANUAL",
      ...salaryColumnsFrom(parsed.data),
    },
    select: { id: true },
  })

  await logActivityEvent({
    userId,
    type: "job.saved",
    title: `Saved ${parsed.data.title} at ${parsed.data.companyName}`,
    metadata: { jobId: job.id },
  })

  return NextResponse.json({ id: job.id }, { status: 201 })
}
