import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { redirect } from "next/navigation"
import { JobsOverview } from "@/features/dashboard/components/jobs-overview"
import { NeedsAttention } from "@/features/dashboard/components/needs-attention"
import { GettingStarted } from "@/features/dashboard/components/getting-started"
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
import { getUserAiKeyStatus } from "@/features/settings/services/user-ai-settings.service"
import { PageShell } from "@/shared/components/page-shell"
import { getUserDayStart, getUserTzOffsetMinutes } from "@/shared/lib/user-day"

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const isAdmin = session.user.role === "ADMIN"

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
    jobStats,
    attention,
    aiKey,
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
      getJobsDashboardStats(session.user.id, todayStart),
      getDashboardAttention(session.user.id, todayStart, tzOffsetMinutes),
      // Admins fall back to the deployment credentials, so skip the lookup.
      isAdmin ? null : getUserAiKeyStatus(session.user.id),
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

  const showAiKeyBanner = shouldShowAiKeyBanner({
    role: session.user.role,
    hasUsableKey: aiKey?.configured ?? true,
  })

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your daily job-search overview
        </p>
      </div>

      {showAiKeyBanner && <AiKeyBanner />}

      <NextActionCard action={nextAction} />

      <NeedsAttention
        overdueFollowUps={attention.overdueFollowUps}
        overdueTotal={attention.overdueTotal}
        awaitingOutcome={attention.awaitingOutcome}
        decideQueue={attention.decideQueue}
        interestedTotal={attention.interestedTotal}
      />

      <GettingStarted
        hasResume={resumeCount > 0}
        hasAtsScan={atsScannedCount > 0}
        hasJob={jobCount > 0}
        hasProfile={hasCareerProfile}
      />

      <JobsOverview
        todayStart={jobStats.todayStart}
        appliedToday={jobStats.appliedToday}
        statusCounts={jobStats.statusCounts}
        upcomingEvents={jobStats.upcomingEvents}
        recentApplications={jobStats.recentApplications}
      />
    </PageShell>
  )
}
