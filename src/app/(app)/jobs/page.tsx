import Link from "next/link"
import { redirect } from "next/navigation"
import { LayoutPanelTop, Telescope } from "lucide-react"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { calendarDaysBetween } from "@/shared/lib/dates"
import { serializeMoney } from "@/shared/lib/money/money"
import { loadDisplayRates } from "@/shared/lib/money/rates"
import { describeSalary } from "@/shared/lib/money/salary-display"
import { parseStoredSalary } from "@/features/ranking/salary"
import { serializeOpportunityValue } from "@/features/opportunity/serialize"
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
import { valueForJob } from "@/features/opportunity/services/opportunity-value.service"
import { savedJobFeedbackKey } from "@/features/feedback/posting-key"
import type { FeedbackMap } from "@/features/feedback/types"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { PageShell } from "@/shared/components/page-shell"
import { getUserDayStart } from "@/shared/lib/user-day"
import { buttonVariants } from "@/shared/ui/button"

/**
 * The posting's age in whole calendar days, against the user's own day.
 * `postedAt` is the employer's date; `createdAt` is when RoleSpec first saw the
 * row and only stands in when the posting states none.
 */
function postingAgeDays(
  postedAt: Date | null,
  createdAt: Date | null,
  today: Date
): number | null {
  const from = postedAt ?? createdAt
  if (!from) return null
  return Math.max(0, calendarDaysBetween(from, today))
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; sort?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/unlock")

  // `/jobs?filter=follow-up-due` is where the dashboard's follow-up next action
  // points, so the list opens already narrowed to what is overdue.
  const { filter, sort } = await searchParams
  const initialFollowUpFilter = parseFollowUpFilterParam(filter)
  const initialSort = parseJobSortParam(sort)

  // The same framing the dashboard uses, so "overdue" and "today" mean the same
  // day on both screens whatever timezone the server is in.
  const todayStart = await getUserDayStart()

  const [user, careerProfile, statusRows, applications, feedbackRows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferences: true },
    }),
    // Only the salary expectation is needed: the pay dimension compares the
    // posting with it, and the rest of the profile reaches the engine through
    // the qualification/fit values the page already has.
    prisma.careerProfile.findUnique({
      where: { userId: session.user.id },
      select: {
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
        salaryPeriod: true,
      },
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
            id: true,
            companyName: true,
            title: true,
            canonicalUrl: true,
            location: true,
            salaryMin: true,
            salaryMax: true,
            salaryCurrency: true,
            salaryPeriod: true,
            salaryTermMonths: true,
            salaryText: true,
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
    // One read for every verdict on the page; the keys are compared after the
    // rows are shaped, because the fallback key can include the saved job id.
    prisma.jobFeedback.findMany({
      where: { userId: session.user.id },
      select: { postingKey: true, verdict: true },
    }),
  ])

  const preferences = parsePreferences(user?.preferences)
  const feedbackByKey: FeedbackMap = Object.fromEntries(
    feedbackRows.map((row) => [row.postingKey, row.verdict]),
  )
  const { preferredCurrency } = preferences
  const { rates, failure } = await loadDisplayRates(preferredCurrency)

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

    const confidence = assessOpportunityConfidence({
      provider: application.job.sourceProvider,
      source: application.job.source,
      url: application.job.url,
      postedAt: application.job.postedAt,
      discoveredAt: application.job.discoveredAt,
      createdAt: application.job.createdAt,
      companyName: application.job.companyName,
      description: application.job.description,
    })

    const feedbackKey = savedJobFeedbackKey({
      id: application.job.id,
      canonicalUrl: application.job.canonicalUrl,
    })

    return {
      id: application.id,
      status: application.status,
      ...(feedbackKey
        ? { feedbackKey, feedback: feedbackByKey[feedbackKey] ?? null }
        : {}),
      ...(application.job.id ? { feedbackJobId: application.job.id } : {}),
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
        // Exact strings, never Prisma's Decimal: this row crosses into a client
        // component, and React cannot serialise a Decimal instance.
        salaryMin: serializeMoney(application.job.salaryMin),
        salaryMax: serializeMoney(application.job.salaryMax),
        salaryCurrency: application.job.salaryCurrency,
        salaryPeriod: application.job.salaryPeriod,
        salaryTermMonths: application.job.salaryTermMonths,
        salaryText: application.job.salaryText,
        // The list's opportunity filters read these exact strings; the card
        // keeps reading the Decimal columns above.
        salary: {
          min: serializeMoney(application.job.salaryMin),
          max: serializeMoney(application.job.salaryMax),
          currency: application.job.salaryCurrency,
          period: application.job.salaryPeriod,
          termMonths: application.job.salaryTermMonths,
        },
        ageDays: postingAgeDays(
          application.job.postedAt,
          application.job.createdAt,
          todayStart
        ),
        salaryDisplay: describeSalary(
          {
            min: application.job.salaryMin,
            max: application.job.salaryMax,
            currency: application.job.salaryCurrency,
            period: application.job.salaryPeriod,
            text: application.job.salaryText,
            reason: parseStoredSalary(application.job)?.reason ?? null,
          },
          { preferredCurrency, rates, failure }
        ),
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
      opportunityValue: serializeOpportunityValue(valueForJob({
        posting: {
          title: application.job.title,
          companyName: application.job.companyName,
          url: application.job.url,
          description: application.job.description,
          requirementFlags: (application.job.requirementFlags as string[] | null) ?? [],
          salaryMin: application.job.salaryMin,
          salaryMax: application.job.salaryMax,
          salaryCurrency: application.job.salaryCurrency,
          salaryPeriod: application.job.salaryPeriod,
          salaryTermMonths: application.job.salaryTermMonths,
          salaryText: application.job.salaryText,
        },
        profile: careerProfile,
        preferences,
        context: {
          // No ranking entry on this page, so fit is genuinely unknown rather
          // than guessed from something else.
          fitScore: null,
          eligibility:
            parseStoredQualification(application.job.qualification)?.qualification.eligible
              .signal ?? null,
          // UNKNOWN is not a confidence level the engine scores; null is its
          // "no data" and keeps the dimension out of the composite.
          confidence: confidence.level === "UNKNOWN" ? null : confidence.level,
          risk: application.job.riskLevel,
        },
      })),
      confidence,
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
          <h1 className="text-2xl font-bold">Saved jobs</h1>
          <p className="text-sm text-muted-foreground">
            Every job you saved, with the next step for each one. The agent can prepare an
            application, but you always review it and send it yourself.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* `/workspace` is the only cross-job kanban, so the list links to it
              in-flow rather than leaving it nav-only. */}
          <Link href="/workspace" className={buttonVariants({ variant: "secondary" })}>
            <LayoutPanelTop className="h-4 w-4" aria-hidden="true" />
            Application board
          </Link>
          <Link href="/jobs/discover" className={buttonVariants({ variant: "secondary" })}>
            <Telescope className="h-4 w-4" aria-hidden="true" />
            Find jobs
          </Link>
        </div>
      </div>

      <JobApplicationList
        applications={sortJobRows(applicationRows, initialSort)}
        statusCounts={statusCounts}
        initialFollowUpFilter={initialFollowUpFilter}
        initialSort={initialSort}
        today={todayStart}
      />
    </PageShell>
  )
}
