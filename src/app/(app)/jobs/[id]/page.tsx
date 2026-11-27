import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { PreparationPanel } from "@/features/workflows/components/preparation-panel"
import { ApplicationTracking } from "@/features/tracking/components/application-tracking"
import type { ThreeLayerResearch } from "@/features/jobs/services/three-layer-research.service"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { StatusBadge } from "@/features/jobs/components/status-badge"
import { RequirementBadges } from "@/features/jobs/components/requirement-badges"
import { RiskBadge } from "@/features/jobs/components/risk-badge"
import { JobRiskPanel } from "@/features/jobs/components/job-risk-panel"
import { JobMatchPanel } from "@/features/jobs/components/job-match-panel"
import { JobEmailPanel } from "@/features/jobs/components/job-email-panel"
import { JobDescriptionPanel } from "@/features/jobs/components/job-description-panel"
import { InterviewQuestionsPanel } from "@/features/jobs/components/interview-questions-panel"
import { JobDetailActions } from "@/features/jobs/components/job-detail-actions"
import { TaskTabs } from "@/shared/components/task-tabs"
import { BackToJobsLink } from "@/features/jobs/components/back-to-jobs-link"
import { JobResumePanel } from "@/features/jobs/components/job-resume-panel"
import { CoverLetterDrawerButton } from "@/features/jobs/components/cover-letter-drawer-button"
import { resolveCoverLetterResumeDefault } from "@/features/jobs/services/cover-letter-form-options"
import { TailorResumeButton } from "@/features/jobs/components/tailor-resume-button"
import { getResumeSourceOptions } from "@/features/resume/services/resume-source-options"
import { resumeEditorHref } from "@/features/resume/lib/resume-editor-href"
import { JobQualificationCard } from "@/features/jobs/components/job-qualification-card"
import { OpportunityConfidenceBadge } from "@/features/discovery/components/opportunity-confidence-badge"
import { assessOpportunityConfidence } from "@/features/discovery/services/opportunity-confidence.service"
import { JobPipelineStepper } from "@/features/jobs/components/job-pipeline-stepper"
import { IntelligentMatchingCard } from "@/features/jobs/components/intelligent-matching-card"
import { CompanyResearchPanel } from "@/features/jobs/components/company-research-panel"
import { computeIntelligentMatch } from "@/features/jobs/services/intelligent-matching.service"
import { valueForJob } from "@/features/opportunity/services/opportunity-value.service"
import { OpportunityValueCard } from "@/features/jobs/components/opportunity-value-card"
import type { CompanyResearchResult } from "@/features/jobs/services/company-research.service"
import { isVerifiedCompanyResearch } from "@/features/jobs/lib/company-research"
import {
  FollowUpActions,
  LastFollowUpNote,
} from "@/features/jobs/components/follow-up-actions"
import {
  pickTailorSourceResumeId,
  recommendResumeForJob,
} from "@/features/jobs/services/resume-choice.service"
import { resolveChosenResumeId } from "@/features/jobs/lib/resolve-chosen-resume-id"
import { describeNextStep } from "@/features/jobs/services/application-next-step.service"
import { parseStoredQualification } from "@/features/jobs/schemas/job-qualification.schema"
import { getUserDayStart } from "@/shared/lib/user-day"
import { isFollowUpDue } from "@/features/jobs/services/follow-up.service"
import { describeJobProvenance } from "@/features/jobs/services/job-provenance.service"
import { isTerminalStatus } from "@/features/jobs/services/outcome.service"
import { OutcomePanel } from "@/features/jobs/components/outcome-panel"
import { JobTasksPanel } from "@/features/jobs/components/job-tasks-panel"
import { ApplicationStatusTimeline } from "@/features/jobs/components/application-status-timeline"
import { getApplicationStatusHistory } from "@/features/jobs/services/application-status.service"
import { WORK_TYPE_LABELS } from "@/features/jobs/components/job-form-options"
import { describeSalary } from "@/shared/lib/money/salary-display"
import { serializeMoney } from "@/shared/lib/money/money"
import { loadDisplayRates } from "@/shared/lib/money/rates"
import { parseStoredSalary } from "@/features/ranking/salary"
import { JobEditProvider } from "@/features/jobs/components/job-edit-provider"
import { parsePreferences } from "@/features/settings/schemas/preferences.schema"
import { formatDate } from "@/shared/lib/utils"
import { calendarDaysBetween, formatCalendarDate, toCalendarDateString } from "@/shared/lib/dates"
import { EmptyState } from "@/shared/components/empty-state"
import {
  FileText,
  ChevronLeft,
  ExternalLink,
  Calendar,
  MapPin,
  DollarSign,
  Mail,
  Briefcase,
  Laptop,
  Crosshair,
  BellRing,
  Sparkles,
} from "lucide-react"
import { buttonVariants } from "@/shared/ui/button"
import { PageShell } from "@/shared/components/page-shell"

interface Props {
  params: Promise<{ id: string }>
}

/** Narrows the `matchResult` Json column to the one field the panel cannot render without. */
function isMatchResult(value: unknown): value is Record<string, unknown> & { summary: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).summary === "string"
  )
}

/** The string members of a Json value that should have been a string array. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

type ProfileCapability = {
  name: string
  selfAssessment?: "EXPOSURE" | "WORKING" | "DEEP" | null
  evidenceLinks?: Array<{
    evidence?: { status?: string | null } | null
  }>
}

export default async function JobApplicationDetailPage({ params }: Props) {
  const session = await auth()
  if (!session?.user?.id) redirect("/unlock")

  const { id } = await params

  // The same framing the tracker and dashboard use, so "overdue" and "today"
  // mean the same thing on every surface.
  const todayStart = await getUserDayStart()

  const [row, resumes, user, resumeSourceOptions, tasks, statusHistory, careerProfile] =
    await Promise.all([
    prisma.jobApplication.findUnique({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        status: true,
        dateApplied: true,
        interviewDate: true,
        followUpAt: true,
        lastFollowedUpAt: true,
        outcomeAt: true,
        outcomeNote: true,
        resumeId: true,
        contact: true,
        notes: true,
        matchScore: true,
        matchResult: true,
        matchResumeId: true,
        matchCheckedAt: true,
        createdAt: true,
        updatedAt: true,
        // Everything about the posting itself now lives on the `Job` row.
        job: {
          select: {
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
            salaryAnnualMin: true,
            salaryAnnualMax: true,
            description: true,
            deadline: true,
            riskLevel: true,
            riskReasons: true,
            riskSource: true,
            riskCheckedAt: true,
            requirementFlags: true,
            qualification: true,
            // Provenance and dates, for the source line and the read-time
            // opportunity-confidence assessment. Nothing here is stored.
            sourceProvider: true,
            source: true,
            postedAt: true,
            discoveredAt: true,
            createdAt: true,
          },
        },
        coverLetters: {
          select: {
            id: true,
            createdAt: true,
            resume: { select: { title: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        interviewQuestions: {
          select: { id: true, question: true, source: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.resume.findMany({
      where: { userId: session.user.id, status: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      // `jobApplicationId` rides along on the list the AI panels already need,
      // so the tailored-resume links below cost no extra query.
      // `variant`, `targetRole` and `updatedAt` ride along too: they are what
      // the resume recommendation reads, so it costs no extra query either.
      select: {
        id: true,
        title: true,
        atsScore: true,
        jobApplicationId: true,
        variant: true,
        targetRole: true,
        updatedAt: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferences: true },
    }),
    // The same source lists `/resumes` builds, so tailoring in place offers
    // exactly the same choices as the full page.
    getResumeSourceOptions(session.user.id),
    // This application's own todos. Open ones first, then by due date, so the
    // thing to do next is the first line of the panel.
    prisma.todo.findMany({
      where: { userId: session.user.id, jobApplicationId: id },
      orderBy: [{ done: "asc" }, { dueDate: "asc" }],
      select: { id: true, title: true, done: true, dueDate: true },
    }),
    // Scoped to the same owner as `row`; a foreign id returns no events.
    getApplicationStatusHistory(session.user.id, id),
    prisma.careerProfile?.findUnique
      ? prisma.careerProfile.findUnique({
          where: { userId: session.user.id },
          include: {
            capabilities: {
              include: {
                evidenceLinks: {
                  include: { evidence: { select: { status: true } } },
                },
              },
            },
            targetRoles: { select: { id: true } },
          },
        })
      : Promise.resolve(null),
  ])

  if (!row) notFound()

  // The posting fields come off the `job` relation now; the page and the panels
  // below it still work off the flat shape they always have.
  const application = {
    id: row.id,
    companyName: row.job.companyName,
    jobTitle: row.job.title,
    status: row.status,
    location: row.job.location,
    salaryMin: serializeMoney(row.job.salaryMin),
    salaryMax: serializeMoney(row.job.salaryMax),
    salaryCurrency: row.job.salaryCurrency,
    salaryPeriod: row.job.salaryPeriod,
    salaryTermMonths: row.job.salaryTermMonths,
    salaryText: row.job.salaryText,
    // Decimals cannot cross into Client Components; serialize like the range.
    salaryAnnualMin: serializeMoney(row.job.salaryAnnualMin),
    salaryAnnualMax: serializeMoney(row.job.salaryAnnualMax),
    dateApplied: row.dateApplied,
    deadline: row.job.deadline,
    interviewDate: row.interviewDate,
    followUpAt: row.followUpAt,
    jobLink: row.job.url,
    contact: row.contact,
    jobDescription: row.job.description,
    notes: row.notes,
    jobType: row.job.jobType,
    workType: row.job.workType,
    riskLevel: row.job.riskLevel,
    riskReasons: row.job.riskReasons,
    riskSource: row.job.riskSource,
    riskCheckedAt: row.job.riskCheckedAt,
    requirementFlags: row.job.requirementFlags,
    matchScore: row.matchScore,
    matchResult: row.matchResult,
    matchResumeId: row.matchResumeId,
    matchCheckedAt: row.matchCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    coverLetters: row.coverLetters,
    interviewQuestions: row.interviewQuestions,
  }

  // Shared with the tracker cards, so both surfaces word provenance identically.
  const provenanceLine = describeJobProvenance({
    sourceProvider: row.job.sourceProvider,
    source: row.job.source,
    postedAt: row.job.postedAt,
    discoveredAt: row.job.discoveredAt,
    jobCreatedAt: row.job.createdAt,
    savedAt: row.createdAt,
  })

  /**
   * Computed at read time, never stored: "is this posting worth my time?", which
   * is a different question from whether it fits the user.
   */
  const confidence = assessOpportunityConfidence({
    provider: row.job.sourceProvider,
    source: row.job.source,
    url: row.job.url,
    postedAt: row.job.postedAt,
    discoveredAt: row.job.discoveredAt,
    createdAt: row.job.createdAt,
    companyName: row.job.companyName,
    description: row.job.description,
  })

  const preferences = parsePreferences(user?.preferences)
  const { preferredCurrency } = preferences

  // Pay as the server words it: the posting's own figure, the annual equivalent
  // in the reader's currency, and the rate date that qualifies it. A failed
  // lookup keeps the reason, so the page says why no equivalent is shown.
  const { rates, failure } = await loadDisplayRates(preferredCurrency)
  const salaryDisplay = describeSalary(
    {
      min: application.salaryMin,
      max: application.salaryMax,
      currency: application.salaryCurrency,
      period: application.salaryPeriod,
      text: application.salaryText,
      reason: parseStoredSalary(application)?.reason ?? null,
    },
    { preferredCurrency, rates, failure },
  )

  // `riskReasons` is a Json column, so nothing guarantees its shape at runtime.
  const riskReasons = Array.isArray(application.riskReasons)
    ? application.riskReasons.filter(
        (reason): reason is string => typeof reason === "string",
      )
    : []

  // Same for `requirementFlags`, also a Json column.
  const requirementFlags = Array.isArray(application.requirementFlags)
    ? application.requirementFlags.filter(
        (flag): flag is string => typeof flag === "string",
      )
    : []

  // `matchResult` is a Json column too, and the score is only worth rendering
  // when the stored payload actually carries a summary to go with it.
  const storedMatch =
    application.matchScore !== null && isMatchResult(application.matchResult)
      ? {
          matchScore: application.matchScore,
          summary: application.matchResult.summary,
          matchedKeywords: stringList(application.matchResult.matchedKeywords),
          missingKeywords: stringList(application.matchResult.missingKeywords),
          suggestions: stringList(application.matchResult.suggestions),
          resumeId: application.matchResumeId,
          checkedAt: application.matchCheckedAt?.toISOString() ?? null,
        }
      : null

  // Resumes already tailored to this application, so a returning user opens the
  // one they made instead of creating a duplicate from "Tailor a resume".
  const tailoredResumes = resumes.filter(
    (resume) => resume.jobApplicationId === id,
  )

  // The picker names the tier, so "which of these five is the right one?" is
  // answered in the option text instead of from memory.
  const resumeChoiceOptions = resumes.map((resume) => ({
    id: resume.id,
    title: resume.title,
    variant: resume.variant,
    forThisJob:
      resume.variant === "JOB_TAILORED" && resume.jobApplicationId === id,
  }))

  // Deterministic, computed on the server so the panel renders the answer
  // rather than deciding it — see `recommendResumeForJob` for the four tiers.
  const resumeRecommendation = recommendResumeForJob({
    resumes,
    jobApplicationId: id,
    jobTitle: application.jobTitle,
  })

  // The stored choice only counts while its resume is still usable: archiving a
  // resume leaves `resumeId` in place so it can be restored, so an archived
  // choice has to read as "no choice" for every panel below.
  const chosenResumeId = resolveChosenResumeId(resumes, row.resumeId)

  // One resume per job across every panel: the explicit choice, then the
  // recommendation. Without this the match and email panels fell back to
  // whatever an old stored match had used — often another job's tailored resume.
  const effectiveResumeId = chosenResumeId ?? resumeRecommendation?.resumeId ?? null

  // The cover-letter drawer takes the same props `/jobs/cover-letter/new`
  // builds, off the resume list this page already loaded — no second query.
  const coverLetterResumeOptions = resumes.map(({ id: resumeId, title, atsScore }) => ({
    id: resumeId,
    title,
    atsScore,
  }))
  const coverLetterApplication = {
    id: application.id,
    companyName: application.companyName,
    jobTitle: application.jobTitle,
    // Only the availability of the stored description crosses to the client;
    // the 20-char floor matches the action's own minimum.
    hasJobDescription: (application.jobDescription?.trim().length ?? 0) >= 20,
  }
  const coverLetterDefault = resolveCoverLetterResumeDefault({
    resumes,
    chosenResumeId,
    jobApplicationId: id,
    jobTitle: application.jobTitle,
  })

  // Which source the tailor dialog opens on, so the common case is title-only.
  const tailorSourceResumeId = pickTailorSourceResumeId({
    roleFamilyResumes: resumeSourceOptions.roleFamilyResumes,
    masterResumes: resumeSourceOptions.masterResumes,
    jobTitle: application.jobTitle,
  })

  // The stored snapshot's `nextAction` was written for the discovery list,
  // where the decision is whether to save at all ("Save it and tailor a
  // resume…"). On a saved application the tracker's own next step is the
  // honest line, and it is the same string the tracker row shows.
  const storedQualification = parseStoredQualification(row.job.qualification)

  const rawMatchResult =
    typeof row.matchResult === "object" && row.matchResult !== null && !Array.isArray(row.matchResult)
      ? (row.matchResult as Record<string, unknown>)
      : null
  const initialCompanyResearch = (rawMatchResult?.companyResearch as CompanyResearchResult | undefined) ?? null

  // A profile row can exist while still being empty. The stage only counts when
  // at least one fact it needs has actually been saved.
  const hasCareerProfile = Boolean(
    careerProfile &&
      (careerProfile.contactFullName?.trim() ||
        careerProfile.experienceLevel ||
        careerProfile.locations.length > 0 ||
        careerProfile.targetRoles.length > 0 ||
        careerProfile.capabilities.length > 0)
  )

  const appliedStatuses = new Set([
    "APPLIED",
    "SCREENING",
    "INTERVIEW",
    "OFFER",
    "REJECTED",
    "WITHDRAWN",
  ])
  const hasApplied =
    Boolean(application.dateApplied) || appliedStatuses.has(application.status)
  // Saving the job and moving it to APPLIED are different records; tracking
  // starts paying off only when the application has actually moved again.
  const hasTracking =
    application.status !== "INTERESTED" && application.status !== "APPLIED"

  const intelligentMatch = computeIntelligentMatch(
    {
      title: application.jobTitle,
      description: application.jobDescription,
      location: application.location,
      workType: row.job.workType,
      salaryAnnualMin: row.job.salaryAnnualMin,
      salaryAnnualMax: row.job.salaryAnnualMax,
      salaryCurrency: application.salaryCurrency,
      salaryPeriod: application.salaryPeriod,
      postedAt: row.job.postedAt,
      requirementFlags: (row.job.requirementFlags as string[] | null) ?? [],
    },
    careerProfile
      ? {
          experienceLevel: careerProfile.experienceLevel,
          locations: careerProfile.locations,
          workModes: careerProfile.workModes,
          workAuthorization: careerProfile.workAuthorization,
          requiresSponsorship: careerProfile.requiresSponsorship,
          salaryMin: careerProfile.salaryMin,
          salaryMax: careerProfile.salaryMax,
          salaryPeriod: careerProfile.salaryPeriod,
          salaryCurrency: careerProfile.salaryCurrency,
          capabilities:
            (careerProfile as unknown as { capabilities?: ProfileCapability[] }).capabilities?.map((c) => ({
              name: c.name,
              depth: c.selfAssessment ?? "WORKING",
              confirmedCount:
                c.evidenceLinks?.filter((el) => el.evidence?.status === "CONFIRMED").length ?? 0,
            })) ?? [],
        }
      : {}
  )
  // Opportunity Value is deliberately computed after the fit and qualification
  // results it reuses: same inputs, one composite, no second definition of fit.
  const opportunityValue = valueForJob({
    posting: {
      title: application.jobTitle,
      companyName: application.companyName,
      url: application.jobLink,
      description: application.jobDescription,
      requirementFlags: (row.job.requirementFlags as string[] | null) ?? [],
      salaryMin: row.job.salaryMin,
      salaryMax: row.job.salaryMax,
      salaryCurrency: row.job.salaryCurrency,
      salaryPeriod: row.job.salaryPeriod,
      salaryTermMonths: row.job.salaryTermMonths,
      salaryText: row.job.salaryText,
    },
    profile: careerProfile,
    preferences,
    context: {
      // There is no ranking entry on this page, so profile fit is genuinely
      // unknown here rather than borrowed from a different model.
      fitScore: null,
      eligibility: storedQualification?.qualification.eligible.signal ?? null,
      confidence: confidence.level === "UNKNOWN" ? null : confidence.level,
      risk: row.job.riskLevel,
    },
  })

  const nextStep = describeNextStep(
    {
      status: row.status,
      followUpAt: row.followUpAt,
      interviewDate: row.interviewDate,
      outcomeAt: row.outcomeAt,
      deadline: row.job.deadline,
      verdict: storedQualification?.qualification.verdict ?? null,
    },
    todayStart,
  )

  // A follow-up whose date has passed is the whole point of scheduling one, so
  // it is called out rather than reading like any other date.
  const followUpOverdue = isFollowUpDue(row.followUpAt, todayStart)
  // `lastFollowedUpAt` is an instant; read its day on the user's calendar, the
  // same framing as `todayStart`, or a UTC+8 morning reads as "1 day ago".
  const lastFollowedUpDay = row.lastFollowedUpAt
    ? await getUserDayStart(row.lastFollowedUpAt)
    : null
  // isFollowUpDue includes today, so the label splits "due today" from a
  // follow-up that is actually past, matching the dashboard's wording.
  const followUpDaysOverdue = row.followUpAt
    ? calendarDaysBetween(row.followUpAt, todayStart)
    : null
  const followUpDueLabel =
    followUpDaysOverdue === null || followUpDaysOverdue < 0
      ? ""
      : followUpDaysOverdue === 0
        ? " — due today"
        : " — overdue"
  // A closed application has nothing to nudge; its outcome block covers it.
  // Rows closed before terminal moves cleared `followUpAt` still carry a date.
  const showFollowUp = !isTerminalStatus(application.status)

  const headerJobLink = application.jobLink?.match(/^https?:\/\//i)
    ? application.jobLink
    : null

  // The details card rendered an empty shell whenever every field was null.
  const hasApplicationDetails = [
    application.location,
    application.jobType,
    application.workType,
    salaryDisplay.primary,
    application.contact,
    application.dateApplied,
    application.deadline,
    application.interviewDate,
    showFollowUp ? application.followUpAt : null,
    showFollowUp ? row.lastFollowedUpAt : null,
    headerJobLink,
    application.notes,
  ].some((value) => value !== null && value !== undefined)

  return (
    <PageShell>
      {/*
        One edit dialog for the whole page: the header button opens it, and so do
        the "Add job description" affordances inside the AI panels.
      */}
      <JobEditProvider application={application}>
      {/* Header */}
      <div className="space-y-3">
        <BackToJobsLink className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Job Applications
        </BackToJobsLink>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{application.companyName}</h1>
            <p className="text-sm text-muted-foreground">{application.jobTitle}</p>
            {/*
              Pay belongs beside the role, not three tabs deep: "is this worth my
              time" cannot be answered without it. The equivalent keeps its rate
              date on the same line, so no figure is shown without provenance.
            */}
            {salaryDisplay.primary && (
              <p className="mt-1 text-sm" data-testid="header-salary">
                {salaryDisplay.primary}
                {salaryDisplay.equivalent ? (
                  <span className="text-muted-foreground">
                    {" · "}≈ {salaryDisplay.equivalent}
                    {salaryDisplay.equivalentNotice ? ` (${salaryDisplay.equivalentNotice})` : null}
                  </span>
                ) : salaryDisplay.equivalentNotice ? (
                  <span className="text-muted-foreground"> · {salaryDisplay.equivalentNotice}</span>
                ) : null}
              </p>
            )}
            {salaryDisplay.caveat && (
              <p className="text-xs text-muted-foreground">{salaryDisplay.caveat}</p>
            )}
            {/* Where it came from and how old it is, before any AI panel speaks. */}
            <p className="text-xs text-muted-foreground">{provenanceLine}</p>
          </div>
          {/*
            No `shrink-0`: it defeated the `flex-wrap` on the same element, so at
            390px the row grew past the viewport and pushed "View posting" off
            screen instead of wrapping onto a second line.
          */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={application.status} />
            <RiskBadge level={application.riskLevel} />
            {!isTerminalStatus(application.status) && (
              <Link
                href={`/jobs/${application.id}#preparation`}
                className={buttonVariants({ size: "sm" })}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Apply with agent
              </Link>
            )}
            <JobDetailActions
              application={application}
              savedResumeId={chosenResumeId}
              effectiveResumeId={effectiveResumeId}
            />
            <TailorResumeButton
              jobApplicationId={application.id}
              jobTitle={application.jobTitle}
              companyName={application.companyName}
              tailoredResumes={tailoredResumes.map(({ id: resumeId, title }) => ({
                id: resumeId,
                title,
              }))}
              defaultSourceResumeId={tailorSourceResumeId}
              {...resumeSourceOptions}
            />
            {headerJobLink && (
              <a
                href={headerJobLink}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                View posting
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Unified 8-stage job pipeline stepper */}
      <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Application milestones</summary>
      <div className="mt-3"><JobPipelineStepper
        jobApplicationId={application.id}
        status={application.status}
        hasCareerProfile={hasCareerProfile}
        hasQualification={Boolean(storedQualification)}
        hasCompanyResearch={
          initialCompanyResearch ? isVerifiedCompanyResearch(initialCompanyResearch) : false
        }
        hasTailoredResume={tailoredResumes.length > 0}
        hasCoverLetter={application.coverLetters.length > 0}
        hasMatchScore={storedMatch !== null || Boolean(row.matchScore)}
        hasApplied={hasApplied}
        hasTracking={hasTracking}
        hasFollowUp={Boolean(application.followUpAt)}
        hasFollowedUp={Boolean(row.lastFollowedUpAt)}
        isFollowUpDue={followUpOverdue}
        chosenResumeId={effectiveResumeId}
      /></div>
      </details>

      {/*
        Sixteen sibling blocks read as one undifferentiated column, so the page
        is grouped into the four questions it answers — decide, prepare, track,
        read the posting — with a sticky jump bar so no group is buried.
      */}
      <TaskTabs label="Job tasks" items={[{ id: "decide", label: "Decide" }, { id: "prepare", label: "Prepare" }, { id: "track", label: "Track" }, { id: "posting", label: "Posting" }]}>

      {/*
        Decide: is this one worth my time at all? Confidence (about the posting)
        sits with fit (about the user) so the two verdicts are read together.
      */}
      <section id="decide" className="scroll-mt-28 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Decide
        </h2>

        <div className="space-y-2">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <OpportunityConfidenceBadge
              level={confidence.level}
              summary={confidence.summary}
              signals={confidence.signals}
              showSignals
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Fit and confidence are separate: fit is about you, confidence is about the
            posting.
          </p>
          {/*
            Renders its own "Not checked yet" state for jobs saved before the
            qualification snapshot existed; the confidence badge above stays a
            sibling because the two verdicts are about different things.
          */}
          <JobQualificationCard
            jobApplicationId={application.id}
            qualification={row.job.qualification}
            nextAction={nextStep.label}
          />

          <IntelligentMatchingCard matchingResult={intelligentMatch} />

          {/* Pay, workload and friction as one auditable number, with the
              sentences it read. Sits under fit because fit is what the user
              checks first; value is what they weigh before applying. */}
          <OpportunityValueCard value={opportunityValue} />
        </div>

        {/*
          An eligibility knockout has to be visible before the user starts
          writing an application.
        */}
        <RequirementBadges flags={requirementFlags} />
      </section>

      {/*
        Prepare: everything that produces application material, in the order it
        is used. The resume choice leads because Resume Match, the email and the
        cover letters are all measured against it.
      */}
      <section id="prepare" className="scroll-mt-28 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Prepare
        </h2>

        <TaskTabs label="Preparation tools" items={[{ id: "preparation", label: "Agent" }, { id: "research", label: "Research" }, { id: "resume-tools", label: "Resume & match" }, { id: "application-drafts", label: "Letters & interview" }]}>
        <div><PreparationPanel jobApplicationId={application.id} resumeId={chosenResumeId} resumeTitle={resumes.find(resume => resume.id === chosenResumeId)?.title} /></div>

        {/* Factual company and role research with verified citations. The card
            carries `id="research"`, the pipeline's stage-3 destination. */}
        <CompanyResearchPanel
          jobApplicationId={application.id}
          companyName={application.companyName}
          initialResearch={initialCompanyResearch}
          initialLayers={(rawMatchResult?.researchLayers as ThreeLayerResearch | undefined) ?? null}
        />

        <div id="resume-tools" className="space-y-4">
        <JobResumePanel
          jobApplicationId={application.id}
          selectedResumeId={chosenResumeId}
          resumeOptions={resumeChoiceOptions}
          recommendation={resumeRecommendation}
        />

        {/*
          Directly under the picker: the resumes already tailored for this job
          are part of the same choice, not a header decoration.
        */}
        {tailoredResumes.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
              Tailored resumes
            </span>
            {tailoredResumes.map((resume) => (
              <Link
                key={resume.id}
                href={resumeEditorHref(resume.id, application.id)}
                className="rounded-sm text-brand-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {resume.title}
              </Link>
            ))}
          </div>
        )}

        {/* Resume Match + Email */}
        <JobMatchPanel
          jobApplicationId={application.id}
          hasJobDescription={Boolean(application.jobDescription)}
          resumeOptions={resumes}
          initialMatch={storedMatch}
          chosenResumeId={effectiveResumeId}
        />

        </div>
        <div id="application-drafts" className="space-y-4">
        <JobEmailPanel
          jobApplicationId={application.id}
          resumeOptions={resumes}
          chosenResumeId={effectiveResumeId}
        />

        {/* Cover Letters */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Cover Letters</h3>
            <div className="flex flex-wrap items-center gap-2">
              <CoverLetterDrawerButton
                resumes={coverLetterResumeOptions}
                application={coverLetterApplication}
                defaultResumeId={coverLetterDefault.defaultResumeId}
                resumeHint={coverLetterDefault.resumeHint}
              />
            </div>
          </div>

          {application.coverLetters.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No cover letters yet"
              description="Generate one tailored to this job with New cover letter above."
            />
          ) : (
            <div className="space-y-2">
              {application.coverLetters.map((cl) => (
                <Link key={cl.id} href={`/jobs/cover-letter/${cl.id}`}>
                  <Card variant="interactive" className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">
                        {cl.resume?.title ?? "Untitled Resume"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(cl.createdAt.toISOString())}
                      </p>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Interview prep — display only, no practice mode yet */}
        <InterviewQuestionsPanel
          jobApplicationId={application.id}
          scrapedQuestions={application.interviewQuestions.filter(
            (q) => q.source === "SCRAPED"
          )}
          generatedQuestions={application.interviewQuestions.filter(
            (q) => q.source === "AI_GENERATED"
          )}
          hasJobDescription={Boolean(application.jobDescription)}
        />
        </div>
        </TaskTabs>
      </section>

      {/*
        Track: the record the user actually saved, plus the end state. Below
        Prepare because it is what you come back to, not what you act on first.
      */}
      <section id="track" className="scroll-mt-28 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Track
        </h2>

        <ApplicationTracking jobApplicationId={application.id} resumeId={chosenResumeId} />

        {hasApplicationDetails && (
        <Card>
          <CardHeader>
            <CardTitle>Application Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {application.location && (
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Location</dt>
                    <dd className="mt-0.5 text-sm">{application.location}</dd>
                  </div>
                </div>
              )}

              {application.jobType && (
                <div className="flex items-start gap-2">
                  <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Job Type</dt>
                    <dd className="mt-0.5 text-sm capitalize">
                      {application.jobType.replaceAll("_", " ").toLowerCase()}
                    </dd>
                  </div>
                </div>
              )}

              {application.workType && (
                <div className="flex items-start gap-2">
                  <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Work Type</dt>
                    <dd className="mt-0.5 text-sm">
                      {WORK_TYPE_LABELS[application.workType]}
                    </dd>
                  </div>
                </div>
              )}

              {salaryDisplay.primary && (
                <div className="flex items-start gap-2">
                  <DollarSign className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Salary</dt>
                    <dd className="mt-0.5 text-sm">{salaryDisplay.primary}</dd>
                    {salaryDisplay.equivalent && salaryDisplay.equivalent !== salaryDisplay.primary ? (
                      <dd
                        className="mt-0.5 text-xs text-muted-foreground"
                        data-testid="salary-equivalent"
                      >
                        ≈ {salaryDisplay.equivalent}
                        {salaryDisplay.equivalentNotice ? (
                          <span className="text-muted-foreground/70">
                            {" "}· {salaryDisplay.equivalentNotice}
                          </span>
                        ) : null}
                      </dd>
                    ) : salaryDisplay.equivalentNotice ? (
                      <dd className="mt-0.5 text-xs text-muted-foreground">
                        {salaryDisplay.equivalentNotice}
                      </dd>
                    ) : null}
                    {salaryDisplay.caveat ? (
                      <dd className="mt-0.5 text-xs text-muted-foreground">
                        {salaryDisplay.caveat}
                      </dd>
                    ) : null}
                  </div>
                </div>
              )}

              {application.contact && (
                <div className="flex items-start gap-2">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Contact</dt>
                    <dd className="mt-0.5 text-sm">{application.contact}</dd>
                  </div>
                </div>
              )}

              {application.dateApplied && (
                <div className="flex items-start gap-2">
                  <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Date Applied</dt>
                    <dd className="mt-0.5 text-sm">
                      {formatCalendarDate(application.dateApplied)}
                    </dd>
                  </div>
                </div>
              )}

              {application.deadline && (
                <div className="flex items-start gap-2">
                  <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Deadline</dt>
                    <dd className="mt-0.5 text-sm">
                      {formatCalendarDate(application.deadline)}
                    </dd>
                  </div>
                </div>
              )}

              {application.interviewDate && (
                <div className="flex items-start gap-2">
                  <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Interview Date</dt>
                    <dd className="mt-0.5 text-sm">
                      {formatDate(application.interviewDate.toISOString())}
                    </dd>
                  </div>
                </div>
              )}

              {showFollowUp && application.followUpAt && (
                <div className="flex items-start gap-2">
                  <BellRing
                    className={`mt-0.5 h-4 w-4 shrink-0 ${followUpOverdue ? "text-error" : "text-muted-foreground"}`}
                    aria-hidden="true"
                  />
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Follow Up</dt>
                    <dd className={`mt-0.5 text-sm ${followUpOverdue ? "text-error" : ""}`}>
                      {formatCalendarDate(application.followUpAt)}
                      {followUpDueLabel}
                    </dd>
                    {/*
                      The schedule button in the header disappears once a date is
                      set, so without these a follow-up is a one-way door.
                    */}
                    <dd>
                      <FollowUpActions jobApplicationId={application.id} />
                    </dd>
                  </div>
                </div>
              )}

              {showFollowUp && !application.followUpAt && lastFollowedUpDay && (
                <div className="flex items-start gap-2">
                  <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Follow Up</dt>
                    <dd className="mt-0.5">
                      <LastFollowUpNote
                        lastFollowedUpAt={lastFollowedUpDay}
                        today={todayStart}
                      />
                    </dd>
                  </div>
                </div>
              )}

              {headerJobLink && (
                <div className="flex items-start gap-2">
                  <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Job Link</dt>
                    <dd className="mt-0.5 text-sm">
                      <a
                        href={headerJobLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-brand-400 hover:underline"
                      >
                        {application.jobLink}
                      </a>
                    </dd>
                  </div>
                </div>
              )}
            </dl>

            {application.notes && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Notes
                </p>
                <p className="text-sm whitespace-pre-wrap">{application.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {/*
          How the application moved through the pipeline, between the current
          facts and the tasks still open. The header badge says where it is; this
          says how it got there.
        */}
        <ApplicationStatusTimeline
          events={statusHistory.events}
          trackingStartedAt={application.createdAt}
        />

        {/*
          The job's own tasks, between the facts of the application and how it
          ended: a task is something still to do about this application.
        */}
        <JobTasksPanel
          jobApplicationId={application.id}
          todos={tasks.map((task) => ({
            id: task.id,
            title: task.title,
            done: task.done,
            // A calendar date crossing the client boundary as the day it is.
            dueDate: task.dueDate ? toCalendarDateString(task.dueDate) : null,
          }))}
        />

        {/*
          Only for the three end states. The date was already stamped by the
          status move, so this is purely the optional note — and it disappears
          again if the user re-opens the application, without losing what was
          stored.
        */}
        {isTerminalStatus(application.status) && (
          <OutcomePanel
            jobApplicationId={application.id}
            status={application.status}
            outcomeAt={row.outcomeAt}
            outcomeNote={row.outcomeNote}
          />
        )}
      </section>

      {/*
        Posting: the source material. Last and collapsed by default — it is what
        everything above is measured against, not a step the user works through.
      */}
      <section id="posting" className="scroll-mt-28 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Posting
        </h2>

        {application.jobDescription && (
          <JobDescriptionPanel jobDescription={application.jobDescription} />
        )}

        {/* Scam / red-flag check */}
        <JobRiskPanel
          jobApplicationId={application.id}
          riskLevel={application.riskLevel}
          riskReasons={riskReasons}
          riskSource={application.riskSource}
          riskCheckedAt={application.riskCheckedAt?.toISOString() ?? null}
          hasJobDescription={Boolean(application.jobDescription)}
        />
      </section>
      </TaskTabs>
      </JobEditProvider>
    </PageShell>
  )
}
