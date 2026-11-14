import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { redirect } from "next/navigation"
import { JobsOverview } from "@/features/dashboard/components/jobs-overview"
import { NeedsAttention } from "@/features/dashboard/components/needs-attention"
import { GettingStarted } from "@/features/dashboard/components/getting-started"
import { DailyStatus } from "@/features/dashboard/components/daily-status"
import {
  NextActionCard,
  resolveNextAction,
} from "@/features/dashboard/components/next-action"
import {
  AiKeyBanner,
  shouldShowAiKeyBanner,
} from "@/features/dashboard/components/ai-key-banner"
import { getJobsDashboardStats } from "@/features/jobs/services/dashboard-stats.service"
import { getDashboardAttention } from "@/features/jobs/services/dashboard-attention.service"
import { assertAiConfigUsable, getEffectiveAiConfigForUser } from "@/shared/lib/ai-provider"
import { PageShell } from "@/shared/components/page-shell"
import { getUserDayStart, getUserTzOffsetMinutes } from "@/shared/lib/user-day"
import { OpportunityLeaderboard } from "@/features/ranking/components/opportunity-leaderboard"
import { AttentionOverview } from "@/features/dashboard/components/attention-inbox"

/** True when an AI call would pass its own preflight right now. */
async function hasUsableAiConfig(userId: string): Promise<boolean> {
  try {
    await assertAiConfigUsable(await getEffectiveAiConfigForUser(userId))
    return true
  } catch {
    return false
  }
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/unlock")

  // The single owner is always "admin", but that no longer says anything about
  // which AI credentials are usable. Resolve the effective config so the banner
  // reflects a real provider/key, not the old role shortcut.
  const aiUsable = await hasUsableAiConfig(session.user.id)

  // Framed on the user's calendar day, not the server's: a stamp made at 07:00
  // in UTC+8 belongs to "today" on their clock, not yesterday's UTC. Resolved
  // once so the overview window and the overdue counts agree on which day it is.
  const todayStart = await getUserDayStart()
  const tzOffsetMinutes = await getUserTzOffsetMinutes()

  const [
    careerProfile,
    resumeCount,
    atsScannedCount,
    jobCount,
    stagedAttempt,
    jobStats,
    attention,
  ] = await Promise.all([
      // The exact inverse of `needsSetup` on /career-profile, so the checkmark
      // and that page's guided-setup redirect can never disagree. The old
      // `playerProfile.onboardedAt` flag belongs to a different onboarding.
      prisma.careerProfile.findUnique({
        where: { userId: session.user.id },
        select: {
          experienceLevel: true,
          careerGoals: true,
          _count: { select: { targetRoles: true } },
        },
      }),
      prisma.resume.count({
        where: { userId: session.user.id, status: { not: "ARCHIVED" } },
      }),
      prisma.resume.count({
        where: {
          userId: session.user.id,
          status: { not: "ARCHIVED" },
          atsScore: { not: null },
        },
      }),
      prisma.jobApplication.count({ where: { userId: session.user.id } }),
      // A prepared package that has not been sent yet is the most concrete
      // unfinished task in the workspace, so it outranks undecided saved jobs.
      prisma.submissionAttempt.findFirst({
        where: {
          userId: session.user.id,
          status: "STAGED",
          jobApplicationId: { not: null },
          // A manually-recorded application must not keep asking the owner to
          // "finish" a package they already sent outside the tracker.
          jobApplication: { status: "INTERESTED" },
        },
        orderBy: { createdAt: "desc" },
        select: { jobApplicationId: true, jobTitle: true, companyName: true },
      }),
      getJobsDashboardStats(session.user.id, todayStart),
      getDashboardAttention(session.user.id, todayStart, tzOffsetMinutes),
    ])

  const hasCareerProfile = Boolean(
    careerProfile &&
      !(
        !careerProfile.experienceLevel &&
        careerProfile._count.targetRoles === 0 &&
        !careerProfile.careerGoals
      )
  )

  // `statusCounts` is zero-filled across every status, so this always resolves.
  const interestedCount =
    jobStats.statusCounts.find((row) => row.status === "INTERESTED")?.count ?? 0

  const topDecide = attention.decideQueue[0]
  const topAwaitingOutcome = attention.awaitingOutcome[0]

  const nextAction = resolveNextAction({
    hasProfile: hasCareerProfile,
    resumeCount,
    applicationCount: jobCount,
    interestedCount,
    stagedAttempt: stagedAttempt?.jobApplicationId
      ? {
          jobApplicationId: stagedAttempt.jobApplicationId,
          companyName: stagedAttempt.companyName,
          jobTitle: stagedAttempt.jobTitle,
        }
      : undefined,
    followUpDueCount: jobStats.followUpDue,
    topDecide: topDecide && {
      id: topDecide.id,
      companyName: topDecide.companyName,
      jobTitle: topDecide.jobTitle,
      reason: topDecide.reason,
    },
    topAwaitingOutcome: topAwaitingOutcome && {
      id: topAwaitingOutcome.id,
      companyName: topAwaitingOutcome.companyName,
      daysSince: topAwaitingOutcome.daysSince,
    },
    topFollowUpDaysOverdue: attention.overdueFollowUps[0]?.daysOverdue,
  })

  const showAiKeyBanner = shouldShowAiKeyBanner({ hasUsableKey: aiUsable })

  const opportunityJobs = await prisma.jobApplication.findMany({
    where: { userId: session.user.id },
    select: { id: true, jobId: true, status: true, job: { select: { title: true, companyName: true, location: true, workType: true } } },
  })

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl font-bold">Home</h1>
        <p className="text-sm text-muted-foreground">
          See what to do next, what the agent prepared, and what is waiting on your answer.
        </p>
      </div>

      {/* The daily numbers lead: they are the first thing to read, not a footer. */}
      <DailyStatus
        todayStart={jobStats.todayStart}
        appliedToday={jobStats.appliedToday}
        followUpDue={jobStats.followUpDue}
        upcomingEvents={jobStats.upcomingEvents}
      />

      {showAiKeyBanner && <AiKeyBanner />}

      <NextActionCard action={nextAction} />

      <GettingStarted
        hasResume={resumeCount > 0}
        hasAtsScan={atsScannedCount > 0}
        hasJob={jobCount > 0}
        hasProfile={hasCareerProfile}
      />

      <AttentionOverview />

      <OpportunityLeaderboard jobs={opportunityJobs} />

      <NeedsAttention
        overdueFollowUps={attention.overdueFollowUps}
        overdueTotal={attention.overdueTotal}
        awaitingOutcome={attention.awaitingOutcome}
        decideQueue={attention.decideQueue}
        interestedTotal={attention.interestedTotal}
      />

      <JobsOverview
        todayStart={jobStats.todayStart}
        statusCounts={jobStats.statusCounts}
        upcomingEvents={jobStats.upcomingEvents}
        recentApplications={jobStats.recentApplications}
      />
    </PageShell>
  )
}
