import { NextResponse } from "next/server"
import { z } from "zod"
import { ApplicationStatus, SalaryCurrency, SalaryPeriod } from "@/generated/prisma/enums"
import { logActivityEvent, resolveApiUserId } from "@/features/auth/api-auth"
import { createJobApplicationWithJob } from "@/features/jobs/services/job-record.service"
import { serializeMoney } from "@/shared/lib/money/money"
import { canonicalizeUrl } from "@/features/discovery/services/normalize.service"
import { prisma } from "@/shared/lib/prisma"

export const dynamic = "force-dynamic"

const querySchema = z.object({
  status: z.nativeEnum(ApplicationStatus).optional(),
  followUpDue: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().cuid().optional(),
})

const createSchema = z.object({
  companyName: z.string().min(1).max(200),
  jobTitle: z.string().min(1).max(200),
  status: z.nativeEnum(ApplicationStatus).default("INTERESTED"),
  jobLink: z.string().max(2000).optional().or(z.literal("")),
  notes: z.string().max(10000).optional().or(z.literal("")),
  salaryMin: z.coerce.number().nonnegative().max(999_999_999_999.99).optional(),
  salaryMax: z.coerce.number().nonnegative().max(999_999_999_999.99).optional(),
  salaryCurrency: z.nativeEnum(SalaryCurrency).optional(),
  salaryPeriod: z.nativeEnum(SalaryPeriod).optional(),
  salaryTermMonths: z.coerce.number().int().min(1).max(120).optional(),
  salaryText: z.string().trim().max(500).optional(),
})

export async function GET(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const params = new URL(req.url).searchParams
  const parsed = querySchema.safeParse({
    status: params.get("status") ?? undefined,
    followUpDue: params.get("followUpDue") ?? undefined,
    limit: params.get("limit") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: "Invalid query" }, { status: 400 })

  const applications = await prisma.jobApplication.findMany({
    where: {
      userId,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.followUpDue ? { followUpAt: { lte: new Date() } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: parsed.data.limit + 1,
    ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
    include: {
      job: {
        select: {
          id: true, companyName: true, title: true, url: true, location: true,
          salaryMin: true, salaryMax: true, salaryCurrency: true, salaryPeriod: true,
          salaryAnnualMin: true, salaryAnnualMax: true,
          jobType: true, workType: true,
        },
      },
    },
  })
  const hasMore = applications.length > parsed.data.limit
  const page = hasMore ? applications.slice(0, parsed.data.limit) : applications
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null
  // Pay is a Decimal pair: serialize it, or the JSON carries a Decimal object
  // instead of the figure the client expects.
  const wire = page.map((application) => ({
    ...application,
    job: {
      ...application.job,
      salaryMin: serializeMoney(application.job.salaryMin),
      salaryMax: serializeMoney(application.job.salaryMax),
      salaryAnnualMin: serializeMoney(application.job.salaryAnnualMin),
      salaryAnnualMax: serializeMoney(application.job.salaryAnnualMax),
    },
  }))
  return NextResponse.json(
    { applications: wire, hasMore, nextCursor },
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

  const canonicalUrl = parsed.data.jobLink ? canonicalizeUrl(parsed.data.jobLink) : ""
  const application = await createJobApplicationWithJob({
    userId,
    companyName: parsed.data.companyName,
    jobTitle: parsed.data.jobTitle,
    status: parsed.data.status,
    jobLink: parsed.data.jobLink || null,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    notes: parsed.data.notes || null,
    salaryMin: parsed.data.salaryMin ?? null,
    salaryMax: parsed.data.salaryMax ?? null,
    salaryCurrency: parsed.data.salaryCurrency ?? null,
    salaryPeriod: parsed.data.salaryPeriod ?? null,
    salaryTermMonths: parsed.data.salaryTermMonths ?? null,
    salaryText: parsed.data.salaryText ?? null,
    ...(parsed.data.status === "APPLIED" ? { dateApplied: new Date() } : {}),
  })

  await logActivityEvent({
    userId,
    type: "application.created",
    title: `Started tracking ${parsed.data.jobTitle} at ${parsed.data.companyName}`,
    metadata: { applicationId: application.id },
  })

  return NextResponse.json({ id: application.id }, { status: 201 })
}
