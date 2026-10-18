import { redirect } from "next/navigation"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { getUpcomingAgenda } from "@/features/planner/services/calendar.service"
import { PlannerTabs } from "@/features/planner/components/planner-tabs"
import { PageShell } from "@/shared/components/page-shell"
import { getUserDayStart } from "@/shared/lib/user-day"

export default async function PlannerPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const userId = session.user.id
  // The user's calendar day, shared by the agenda and the todo list's Overdue
  // group so the two cannot disagree about which day "today" is.
  const todayStart = await getUserDayStart()

  const [jobOptions, todos, notes, agenda] = await Promise.all([
    prisma.jobApplication.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, job: { select: { title: true, companyName: true } } },
    }),
    prisma.todo.findMany({
      where: { userId },
      orderBy: [{ done: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        done: true,
        dueDate: true,
        jobApplicationId: true,
        jobApplication: {
          select: { id: true, job: { select: { title: true, companyName: true } } },
        },
      },
    }),
    prisma.note.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        content: true,
        updatedAt: true,
      },
    }),
    // Framed on the user's calendar day so the agenda and the dates shown on a
    // job cannot disagree about which day "today" is.
    getUpcomingAgenda(userId, todayStart),
  ])

  // The posting fields come off the `job` relation now; the planner components
  // still take the flat `{ id, companyName, jobTitle }` shape they always have.
  const toJobOption = (application: {
    id: string
    job: { title: string; companyName: string }
  }) => ({
    id: application.id,
    companyName: application.job.companyName,
    jobTitle: application.job.title,
  })

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl font-bold">Planner</h1>
        <p className="text-sm text-muted-foreground">
          Track todos, notes, and upcoming interviews and deadlines for your job hunt.
        </p>
      </div>

      <PlannerTabs
        todos={todos.map((t) => ({
          id: t.id,
          title: t.title,
          done: t.done,
          dueDate: t.dueDate,
          jobApplicationId: t.jobApplicationId,
          job: t.jobApplication ? toJobOption(t.jobApplication) : null,
        }))}
        notes={notes.map((n) => ({
          id: n.id,
          content: n.content,
          updatedAt: n.updatedAt,
        }))}
        agenda={agenda}
        jobOptions={jobOptions.map(toJobOption)}
        today={todayStart}
      />
    </PageShell>
  )
}
