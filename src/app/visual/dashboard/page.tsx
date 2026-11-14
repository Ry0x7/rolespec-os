import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ApplicationStatus } from "@/generated/prisma/enums"
import { DailyStatus } from "@/features/dashboard/components/daily-status"
import { GettingStarted } from "@/features/dashboard/components/getting-started"
import { JobsOverview } from "@/features/dashboard/components/jobs-overview"
import { NeedsAttention } from "@/features/dashboard/components/needs-attention"
import {
  NextActionCard,
  resolveNextAction,
} from "@/features/dashboard/components/next-action"
import type {
  AwaitingOutcomeItem,
  DecideQueueItem,
  OverdueFollowUp,
} from "@/features/jobs/services/dashboard-attention.service"
import type {
  RecentApplication,
  StatusCount,
  UpcomingEvent,
} from "@/features/jobs/services/dashboard-stats.service"
import { PageShell } from "@/shared/components/page-shell"

/**
 * Deterministic dashboard fixture for the local visual-regression script.
 *
 * The real `/dashboard` is database-backed and time-framed, so its date labels
 * and counts change between runs. This route renders the same cards with fixed
 * dates and two data shapes: `?state=worst` feeds deliberately hostile job data
 * (long unbroken names, four-digit counts, nine events) to catch reflow bugs.
 *
 * It is a development harness. Production requests get a 404, and the page is
 * never linked from the app or included in the sitemap.
 */
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Dashboard visual harness",
  robots: { index: false, follow: false },
}

const TODAY = new Date("2026-11-14T00:00:00.000Z")

type HarnessState = "default" | "worst"

function event(
  id: string,
  title: string,
  subtitle: string | null,
  status: ApplicationStatus | null,
  day: number,
  type: UpcomingEvent["type"],
): UpcomingEvent {
  return {
    id,
    title,
    subtitle,
    status,
    date: new Date(`2026-11-${String(day).padStart(2, "0")}T12:00:00.000Z`),
    type,
    href: `/jobs/${id}`,
  }
}

function statusCounts(values: number[]): StatusCount[] {
  return Object.values(ApplicationStatus).map((status, index) => ({
    status,
    count: values[index] ?? 0,
  }))
}

function buildDefault() {
  const upcomingEvents: UpcomingEvent[] = [
    event("app-1", "Stripe", "Infrastructure Engineer", ApplicationStatus.INTERVIEW, 15, "interview"),
    event("app-2", "Linear", "Product Engineer", ApplicationStatus.APPLIED, 16, "deadline"),
    event("app-3", "Vercel", "Platform Engineer", ApplicationStatus.SCREENING, 17, "follow-up"),
    event("app-4", "Figma", "Design Engineer", ApplicationStatus.APPLIED, 18, "deadline"),
    event("app-5", "Notion", "Frontend Engineer", ApplicationStatus.INTERVIEW, 20, "interview"),
    event("app-6", "Raycast", "Product Engineer", ApplicationStatus.INTERESTED, 21, "follow-up"),
    event("todo-1", "Send the take-home", "Stripe", null, 19, "todo"),
  ]

  const recentApplications: RecentApplication[] = [
    { id: "app-1", companyName: "Stripe", jobTitle: "Infrastructure Engineer", status: ApplicationStatus.INTERVIEW, createdAt: new Date("2026-11-10T00:00:00.000Z") },
    { id: "app-2", companyName: "Linear", jobTitle: "Product Engineer", status: ApplicationStatus.APPLIED, createdAt: new Date("2026-11-09T00:00:00.000Z") },
    { id: "app-3", companyName: "Vercel", jobTitle: "Platform Engineer", status: ApplicationStatus.SCREENING, createdAt: new Date("2026-11-08T00:00:00.000Z") },
    { id: "app-4", companyName: "Figma", jobTitle: "Design Engineer", status: ApplicationStatus.APPLIED, createdAt: new Date("2026-11-07T00:00:00.000Z") },
    { id: "app-5", companyName: "Notion", jobTitle: "Frontend Engineer", status: ApplicationStatus.INTERVIEW, createdAt: new Date("2026-11-06T00:00:00.000Z") },
  ]

  const overdueFollowUps: OverdueFollowUp[] = [
    {
      id: "app-2",
      companyName: "Linear",
      jobTitle: "Product Engineer",
      followUpAt: new Date("2026-11-09T00:00:00.000Z"),
      daysOverdue: 5,
    },
  ]

  const awaitingOutcome: AwaitingOutcomeItem[] = [
    {
      id: "app-5",
      companyName: "Notion",
      jobTitle: "Frontend Engineer",
      interviewDate: new Date("2026-11-10T15:00:00.000Z"),
      daysSince: 4,
    },
  ]

  const decideQueue: DecideQueueItem[] = [
    {
      id: "app-4",
      companyName: "Figma",
      jobTitle: "Design Engineer",
      verdict: "STRONG",
      reason: "Strong fit — prepare and apply",
      confidence: {
        level: "HIGH",
        summary: "Official ATS board, posted 4 days ago, named employer.",
      },
    },
    {
      id: "app-6",
      companyName: "Raycast",
      jobTitle: "Product Engineer",
      verdict: "WORTH_A_LOOK",
      reason: "Worth a look — review the posting and decide",
      confidence: {
        level: "MEDIUM",
        summary: "Named employer, but the posting does not state a location.",
      },
    },
  ]

  return {
    appliedToday: 1,
    dailyGoal: 3,
    followUpDue: 1,
    upcomingEvents,
    statusCounts: statusCounts([2, 4, 1, 2, 0, 1, 0]),
    recentApplications,
    overdueFollowUps,
    awaitingOutcome,
    decideQueue,
    nextAction: resolveNextAction({
      hasProfile: true,
      resumeCount: 2,
      applicationCount: 10,
      interestedCount: 2,
      stagedAttempt: {
        jobApplicationId: "app-1",
        companyName: "Stripe",
        jobTitle: "Infrastructure Engineer",
      },
      followUpDueCount: 1,
      topDecide: {
        id: "app-4",
        companyName: "Figma",
        jobTitle: "Design Engineer",
        reason: "Strong fit — prepare and apply",
      },
      topFollowUpDaysOverdue: 5,
    }),
    completedSetup: true,
  }
}

function buildWorst() {
  const unbrokenCompany =
    "supercalifragilisticexpialidociousinternationalaerospacedefensesystems".repeat(3)
  const longRole =
    "PrincipalStaffSeniorLeadEngineerPlatformInfrastructureObservabilitySecurityReliability".repeat(2)
  const emojiName = "株式会社ノースウィンド・インターナショナル・エアロスペース 🚀🌏"
  const upcomingEvents: UpcomingEvent[] = Array.from({ length: 9 }, (_, index) =>
    event(
      `worst-${index + 1}`,
      index % 2 === 0 ? unbrokenCompany : emojiName,
      longRole,
      ApplicationStatus.INTERVIEW,
      15 + index,
      ["interview", "deadline", "follow-up", "todo"][index % 4] as UpcomingEvent["type"],
    ),
  )

  const recentApplications: RecentApplication[] = Array.from(
    { length: 5 },
    (_, index) => ({
      id: `worst-${index + 1}`,
      companyName: index % 2 === 0 ? unbrokenCompany : emojiName,
      jobTitle: longRole,
      status: Object.values(ApplicationStatus)[index],
      createdAt: new Date("2026-11-10T00:00:00.000Z"),
    }),
  )

  const overdueFollowUps: OverdueFollowUp[] = Array.from(
    { length: 3 },
    (_, index) => ({
      id: `worst-${index + 1}`,
      companyName: index % 2 === 0 ? unbrokenCompany : emojiName,
      jobTitle: longRole,
      followUpAt: new Date("2026-10-01T00:00:00.000Z"),
      daysOverdue: 1234 + index,
    }),
  )

  const awaitingOutcome: AwaitingOutcomeItem[] = Array.from(
    { length: 2 },
    (_, index) => ({
      id: `worst-${index + 1}`,
      companyName: index === 0 ? unbrokenCompany : emojiName,
      jobTitle: longRole,
      interviewDate: new Date("2025-01-01T15:00:00.000Z"),
      daysSince: 1234 + index,
    }),
  )

  const decideQueue: DecideQueueItem[] = Array.from({ length: 3 }, (_, index) => ({
    id: `worst-${index + 1}`,
    companyName: index === 0 ? unbrokenCompany : emojiName,
    jobTitle: longRole,
    verdict: (["STRONG", "WORTH_A_LOOK", "WEAK"] as const)[index],
    reason:
      "Strong fit — prepare and apply. This deliberately long decision line checks that the card clamps instead of pushing the layout wide.",
    confidence: {
      level: (["HIGH", "MEDIUM", "LOW"] as const)[index],
      summary:
        "Official ATS board, named employer, posted recently, with a summary long enough to make the badge tooltip unwieldy.",
    },
  }))

  return {
    appliedToday: 1284,
    dailyGoal: 1,
    followUpDue: 9876,
    upcomingEvents,
    statusCounts: statusCounts([1284, 9999, 8765, 4321, 123, 9876, 5432]),
    recentApplications,
    overdueFollowUps,
    awaitingOutcome,
    decideQueue,
    nextAction: resolveNextAction({
      hasProfile: true,
      resumeCount: 12,
      applicationCount: 9999,
      interestedCount: 4321,
      stagedAttempt: {
        jobApplicationId: "worst-1",
        companyName: unbrokenCompany,
        jobTitle: longRole,
      },
      followUpDueCount: 9876,
      topDecide: {
        id: "worst-1",
        companyName: unbrokenCompany,
        jobTitle: longRole,
        reason:
          "Strong fit — prepare and apply. This deliberately long reason checks the next-action card wraps instead of overflowing.",
      },
      topFollowUpDaysOverdue: 1234,
    }),
    completedSetup: false,
  }
}

export default async function DashboardVisualHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  if (process.env.NODE_ENV === "production") notFound()

  const { state } = await searchParams
  const harnessState: HarnessState = state === "worst" ? "worst" : "default"
  const data = harnessState === "worst" ? buildWorst() : buildDefault()

  return (
    // Leaving the desktop rail's width empty keeps the card grid at the same
    // measure it has inside the real authenticated shell.
    <main className="min-h-screen bg-background p-4 lg:pl-[calc(15rem+1.5rem)] lg:pr-6 lg:py-6">
      <PageShell>
        <div>
          <h1 className="text-2xl font-bold">Home</h1>
          <p className="text-sm text-muted-foreground">
            See what to do next, what the agent prepared, and what is waiting on
            your answer.
          </p>
        </div>

        <DailyStatus
          todayStart={TODAY}
          appliedToday={data.appliedToday}
          followUpDue={data.followUpDue}
          dailyGoal={data.dailyGoal}
          upcomingEvents={data.upcomingEvents}
        />

        <NextActionCard action={data.nextAction} />

        <GettingStarted
          hasProfile={data.completedSetup}
          hasResume={data.completedSetup}
          hasAtsScan={data.completedSetup}
          hasJob={data.completedSetup}
        />

        <NeedsAttention
          overdueFollowUps={data.overdueFollowUps}
          overdueTotal={data.overdueFollowUps.length}
          awaitingOutcome={data.awaitingOutcome}
          decideQueue={data.decideQueue}
          interestedTotal={data.decideQueue.length}
        />

        <JobsOverview
          todayStart={TODAY}
          statusCounts={data.statusCounts}
          upcomingEvents={data.upcomingEvents}
          recentApplications={data.recentApplications}
        />
      </PageShell>
    </main>
  )
}
