import Link from "next/link"
import { redirect } from "next/navigation"
import { LayoutPanelTop, Telescope } from "lucide-react"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { getUsdPhpRate } from "@/shared/lib/fx"
import { JobApplicationList } from "@/features/jobs/components/job-application-list"
import type { StatusFilterCounts } from "@/features/jobs/hooks/use-job-filters"
import { parseFollowUpFilterParam } from "@/features/jobs/services/follow-up.service"
import { describeNextStep } from "@/features/jobs/services/application-next-step.service"
import { quickActionsFor } from "@/features/jobs/services/application-quick-actions"
import { describeJobProvenance } from "@/features/jobs/services/job-provenance.service"
import { parseJobSortParam, sortJobRows } from "@/features/jobs/services/job-sort.service"
import { parseStoredQualification } from "@/features/jobs/schemas/job-qualification.schema"
import { assessOpportunityConfidence } from "@/features/discovery/services/opportunity-confidence.service"
import { parsePreferences } from "@/features/settings/schemas/preferences.schema"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { PageShell } from "@/shared/components/page-shell"
import { getUserDayStart } from "@/shared/lib/user-day"
import { buttonVariants } from "@/shared/ui/button"

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; sort?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  // `/jobs?filter=follow-up-due` is where the dashboard's follow-up next action
  // points, so the list opens already narrowed to what is overdue.
  const { filter, sort } = await searchParams
  const initialFollowUpFilter = parseFollowUpFilterParam(filter)
  const initialSort = parseJobSortParam(sort)

  // The same framing the dashboard uses, so "overdue" and "today" mean the same
  // day on both screens whatever timezone the server is in.
  const todayStart = await getUserDayStart()

  const [usdPhpRate, user, statusRows, applications] = await Promise.all([
    getUsdPhpRate(),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferences: true },
    }),
    // Counted with an aggregate rather than off `applications`, so the filter
    // labels stay right if this list ever gets paginated.
    prisma.jobApplication.groupBy({
      by: ["status"],
      where: { userId: session.user.id },
      _count: { _all: true },
    }),
    prisma.jobApplication.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        status: true,
        dateApplied: true,
        interviewDate: true,
        followUpAt: true,
        outcomeAt: true,
        contact: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        // Everything about the posting itself now lives on the `Job` row.
        job: {
          select: {
            companyName: true,
            title: true,
            location: true,
            salary: true,
            salaryPeriod: true,
            salaryCurrency: true,
            deadline: true,
            url: true,
            description: true,
            jobType: true,
            workType: true,
            riskLevel: true,
            requirementFlags: true,
            // Read on the server only, for the verdict badge, the confidence
            // badge and the provenance line. None of these columns is sent to
            // the browser — the `qualification` blob in particular is large.
            qualification: true,
            sourceProvider: true,
            source: true,
            postedAt: true,
            discoveredAt: true,
            createdAt: true,
          },
        },
        // Cards link straight to the most recent letter, and badge the rest.
        coverLetters: {
          select: { id: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        _count: { select: { coverLetters: true } },
      },
    }),
  ])

  const { preferredCurrency } = parsePreferences(user?.preferences)

  // The cards take the posting nested under `job`, in `Job` vocabulary. The
  // relation is optional, so a missing one is normalised away here — empty
  // strings for the non-nullable text, and the column's schema default for
  // `salaryCurrency`, because the card's type requires a currency.
  const applicationRows = applications.map((application) => {
    const verdict =
      parseStoredQualification(application.job.qualification)?.qualification
        .verdict ?? null

    // The next-step line and the row's quick actions read exactly the same
    // facts, so they are handed the same object and can never disagree.
    const nextStepInput = {
      status: application.status,
      followUpAt: application.followUpAt,
      interviewDate: application.interviewDate,
      outcomeAt: application.outcomeAt,
      deadline: application.job.deadline,
      verdict,
    }

    return {
      id: application.id,
      status: application.status,
      dateApplied: application.dateApplied,
      interviewDate: application.interviewDate,
      followUpAt: application.followUpAt,
      outcomeAt: application.outcomeAt,
      contact: application.contact,
      notes: application.notes,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
      job: {
        companyName: application.job.companyName,
        title: application.job.title,
        location: application.job.location,
        salary: application.job.salary,
        salaryPeriod: application.job.salaryPeriod,
        salaryCurrency: application.job.salaryCurrency,
        deadline: application.job.deadline,
        url: application.job.url,
        description: application.job.description,
        jobType: application.job.jobType,
        workType: application.job.workType,
        riskLevel: application.job.riskLevel,
        requirementFlags: application.job.requirementFlags,
      },
      // Read-time assessments, all decided here so the client card renders plain
      // values and the list can sort by urgency without re-deriving anything.
      verdict,
      confidence: assessOpportunityConfidence({
        provider: application.job.sourceProvider,
        source: application.job.source,
        url: application.job.url,
        postedAt: application.job.postedAt,
        discoveredAt: application.job.discoveredAt,
        createdAt: application.job.createdAt,
        companyName: application.job.companyName,
        description: application.job.description,
      }),
      provenance: describeJobProvenance({
        sourceProvider: application.job.sourceProvider,
        source: application.job.source,
        postedAt: application.job.postedAt,
        discoveredAt: application.job.discoveredAt,
        jobCreatedAt: application.job.createdAt,
        savedAt: application.createdAt,
        // The card's footer already says "Saved …"; do not repeat it here.
      }, { includeSaved: false }),
      nextStep: describeNextStep(nextStepInput, todayStart),
      quickActions: quickActionsFor(nextStepInput, todayStart),
      coverLetters: application.coverLetters,
      _count: application._count,
    }
  })

  const countByStatus = new Map(
    statusRows.map((row) => [row.status, row._count._all]),
  )
  const statusCounts = Object.fromEntries(
    Object.values(ApplicationStatus).map((status) => [
      status,
      countByStatus.get(status) ?? 0,
    ]),
  ) as StatusFilterCounts

  return (
    <PageShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Job Applications</h1>
          <p className="text-sm text-muted-foreground">
            Track your job search progress
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* `/workspace` is the only cross-job kanban, so the list links to it
              in-flow rather than leaving it nav-only. */}
          <Link href="/workspace" className={buttonVariants({ variant: "secondary" })}>
            <LayoutPanelTop className="h-4 w-4" aria-hidden="true" />
            Board
          </Link>
          <Link href="/jobs/discover" className={buttonVariants({ variant: "secondary" })}>
            <Telescope className="h-4 w-4" aria-hidden="true" />
            Discover
          </Link>
        </div>
      </div>

      <JobApplicationList
        applications={sortJobRows(applicationRows, initialSort)}
        usdPhpRate={usdPhpRate}
        preferredCurrency={preferredCurrency}
        statusCounts={statusCounts}
        initialFollowUpFilter={initialFollowUpFilter}
        initialSort={initialSort}
        today={todayStart}
      />
    </PageShell>
  )
}
