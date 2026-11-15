import { prisma } from "@/shared/lib/prisma"
import { calendarDayStart } from "@/shared/lib/dates"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { FOLLOW_UP_STATUSES } from "./follow-up.service"

export type UpcomingEvent = {
  /** Row identity: the application for a job event, the todo for a task. */
  id: string
  /** The bold line: the company for a job event, the task itself for a todo. */
  title: string
  /** The line under it: the role, or the company a todo hangs off. */
  subtitle: string | null
  /** Null for a todo, which is the user's own task rather than an application. */
  status: ApplicationStatus | null
  date: Date
  type: "interview" | "deadline" | "follow-up" | "todo"
  /** Where the row goes — a standalone todo has only the planner to open. */
  href: string
}

export type RecentApplication = {
  id: string
  companyName: string
  jobTitle: string
  status: ApplicationStatus
  createdAt: Date
}

export type StatusCount = {
  status: ApplicationStatus
  count: number
}

export type JobsDashboardStats = {
  /**
   * UTC midnight of the day the window was framed on — the user's own day when
   * the caller supplied it. The overview counts "Today / In N days" from this so
   * its labels can never disagree with the rows the query returned.
   */
  todayStart: Date
  appliedToday: number
  /** Live applications whose scheduled follow-up date has already passed. */
  followUpDue: number
  /** Every status, zero-filled, in `ApplicationStatus` declaration order. */
  statusCounts: StatusCount[]
  upcomingEvents: UpcomingEvent[]
  recentApplications: RecentApplication[]
}

/**
 * Computes job-application stats for the dashboard, scoped to a single user.
 *
 * Day boundaries are UTC midnights because that is how the calendar-date fields
 * (`dateApplied`, `deadline`, `followUpAt`) are persisted. *Which* midnight is
 * the caller's business: pass the user's own day (`getUserDayStart()`) and the
 * window matches the dates they see on screen. The default is the UTC day, which
 * is what a request with no timezone hint can honestly assume.
 */
export async function getJobsDashboardStats(
  userId: string,
  todayStart: Date = calendarDayStart(new Date()),
): Promise<JobsDashboardStats> {
  const startOfToday = todayStart
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setUTCDate(startOfTomorrow.getUTCDate() + 1)
  // Exclusive end of the seventh day, not its midnight: "next 7 days" has to
  // include something dated exactly seven days out, whatever time it carries.
  const windowEnd = new Date(startOfToday)
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 8)

  const [appliedToday, followUpDue, statusRows, upcomingRows, todoRows, recentRows] =
    await Promise.all([
      prisma.jobApplication.count({
        where: {
          userId,
          dateApplied: { gte: startOfToday, lt: startOfTomorrow },
        },
      }),
      // Due through the end of the user's today: `followUpAt` is a calendar
      // date, so one dated today is due all day, whatever the UTC instant.
      prisma.jobApplication.count({
        where: {
          userId,
          status: { in: FOLLOW_UP_STATUSES },
          followUpAt: { lt: startOfTomorrow },
        },
      }),
      prisma.jobApplication.groupBy({
        by: ["status"],
        where: { userId },
        _count: { _all: true },
      }),
      prisma.jobApplication.findMany({
        where: {
          userId,
          OR: [
            { interviewDate: { gte: startOfToday, lt: windowEnd } },
            // `deadline` lives on the posting now, so this arm filters the relation.
            { job: { deadline: { gte: startOfToday, lt: windowEnd } } },
            // Scheduled chases count as upcoming too, but only where a reply is
            // still outstanding, and only from tomorrow: one dated today is
            // already due, so it belongs to Needs Attention, not here.
            {
              status: { in: FOLLOW_UP_STATUSES },
              followUpAt: { gte: startOfTomorrow, lt: windowEnd },
            },
          ],
        },
        select: {
          id: true,
          status: true,
          interviewDate: true,
          followUpAt: true,
          job: {
            select: { companyName: true, title: true, deadline: true },
          },
        },
      }),
      // Open tasks due in the same window. A todo the user has already ticked
      // off is not upcoming, and one with no due date was never scheduled.
      prisma.todo.findMany({
        where: {
          userId,
          done: false,
          dueDate: { gte: startOfToday, lt: windowEnd },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          jobApplicationId: true,
          jobApplication: { select: { job: { select: { companyName: true } } } },
        },
      }),
      prisma.jobApplication.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          createdAt: true,
          job: { select: { title: true, companyName: true } },
        },
      }),
    ])

  // The posting fields come off the `job` relation now; the dashboard shapes
  // stay flat.
  const recentApplications: RecentApplication[] = recentRows.map((row) => ({
    id: row.id,
    companyName: row.job.companyName,
    jobTitle: row.job.title,
    status: row.status,
    createdAt: row.createdAt,
  }))

  const upcomingEvents: UpcomingEvent[] = []
  for (const row of upcomingRows) {
    const base = {
      id: row.id,
      title: row.job.companyName,
      subtitle: row.job.title,
      status: row.status,
      href: `/jobs/${row.id}`,
    }
    const deadline = row.job.deadline
    const inWindow = (date: Date) => date >= startOfToday && date < windowEnd

    if (row.interviewDate && inWindow(row.interviewDate)) {
      upcomingEvents.push({ ...base, date: row.interviewDate, type: "interview" })
    }
    if (deadline && inWindow(deadline)) {
      upcomingEvents.push({ ...base, date: deadline, type: "deadline" })
    }
    if (
      row.followUpAt &&
      row.followUpAt >= startOfTomorrow &&
      row.followUpAt < windowEnd &&
      FOLLOW_UP_STATUSES.includes(row.status)
    ) {
      upcomingEvents.push({ ...base, date: row.followUpAt, type: "follow-up" })
    }
  }
  for (const todo of todoRows) {
    // The `where` clause guarantees a due date; this keeps the type honest.
    if (!todo.dueDate) continue
    upcomingEvents.push({
      id: todo.id,
      title: todo.title,
      subtitle: todo.jobApplication?.job.companyName ?? null,
      status: null,
      date: todo.dueDate,
      type: "todo",
      href: todo.jobApplicationId ? `/jobs/${todo.jobApplicationId}` : "/planner",
    })
  }

  upcomingEvents.sort((a, b) => a.date.getTime() - b.date.getTime())

  // groupBy only returns statuses the user actually has, so zero-fill the rest
  // to keep the strip a fixed shape.
  const countByStatus = new Map(
    statusRows.map((row) => [row.status, row._count._all]),
  )
  const statusCounts: StatusCount[] = Object.values(ApplicationStatus).map(
    (status) => ({ status, count: countByStatus.get(status) ?? 0 }),
  )

  return {
    todayStart: startOfToday,
    appliedToday,
    followUpDue,
    statusCounts,
    upcomingEvents,
    recentApplications,
  }
}
