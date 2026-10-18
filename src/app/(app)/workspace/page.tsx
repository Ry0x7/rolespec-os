import Link from "next/link"
import { redirect } from "next/navigation"
import { Briefcase } from "lucide-react"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { getUserDayStart } from "@/shared/lib/user-day"
import { WorkspaceBoard } from "@/features/workspace/components/workspace-board"
import { PageShell } from "@/shared/components/page-shell"
import { buttonVariants } from "@/shared/ui/button"

export default async function WorkspacePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const userId = session.user.id

  // UTC day/week boundaries to match how dateApplied is persisted
  // (actions store `new Date("YYYY-MM-DD")` → UTC midnight).
  const now = new Date()
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  // Week starts Monday (UTC). getUTCDay(): 0 = Sunday … 6 = Saturday.
  const daysSinceMonday = (startOfToday.getUTCDay() + 6) % 7
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - daysSinceMonday)

  // The user's own calendar day, the framing Job Detail uses for follow-ups, so
  // a card's "due today" / "overdue" agrees with the Track section.
  const followUpToday = await getUserDayStart(now)

  const [jobs, playerProfile, appliedToday, appliedThisWeek] = await Promise.all([
    prisma.jobApplication.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        dateApplied: true,
        interviewDate: true,
        followUpAt: true,
        job: {
          select: {
            title: true,
            companyName: true,
            deadline: true,
          },
        },
      },
    }),
    prisma.playerProfile.findUnique({
      where: { userId },
      select: { applicationGoalTarget: true, applicationGoalPeriod: true },
    }),
    prisma.jobApplication.count({
      where: { userId, dateApplied: { gte: startOfToday } },
    }),
    prisma.jobApplication.count({
      where: { userId, dateApplied: { gte: startOfWeek } },
    }),
  ])

  // The posting fields come off the `job` relation now; WorkspaceBoard still
  // takes the flat shapes it always has.
  const jobRows = jobs.map((application) => ({
    id: application.id,
    status: application.status,
    dateApplied: application.dateApplied,
    interviewDate: application.interviewDate,
    followUpAt: application.followUpAt,
    job: {
      companyName: application.job.companyName,
      title: application.job.title,
      deadline: application.job.deadline,
    },
  }))

  return (
    <PageShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Workspace</h1>
          <p className="text-sm text-muted-foreground">
            Your goal, pipeline and quick add in one place — rearrange and
            collapse panels to fit how you work.
          </p>
        </div>
        {/* Paired with the "Board" link in the `/jobs` header, so the board and
            the list are one hop from each other either way. */}
        <Link href="/jobs" className={buttonVariants({ variant: "secondary" })}>
          <Briefcase className="h-4 w-4" aria-hidden="true" />
          List
        </Link>
      </div>

      <WorkspaceBoard
        jobs={jobRows}
        goal={{
          target: playerProfile?.applicationGoalTarget ?? 10,
          period: playerProfile?.applicationGoalPeriod ?? "WEEKLY",
        }}
        appliedToday={appliedToday}
        appliedThisWeek={appliedThisWeek}
        today={followUpToday}
      />
    </PageShell>
  )
}
