import { prisma } from "@/shared/lib/prisma"
import { addCalendarDays, calendarDayStart } from "@/shared/lib/dates"
import { todoAgendaKey } from "./agenda-key"
import type { ApplicationStatus } from "@/generated/prisma/enums"
import { FOLLOW_UP_STATUSES } from "@/features/jobs/services/follow-up.service"

export type AgendaItemType = "interview" | "deadline" | "todo" | "follow-up"

/**
 * How far back the agenda looks for things that have already slipped. Mirrors
 * the 30-day forward window — an eight-month-old deadline is history, not a
 * task, and an unbounded lookback would bury the live items.
 */
export const OVERDUE_LOOKBACK_DAYS = 30

export interface AgendaItem {
  /** Composite id: unique per source event (a job can produce two items). */
  key: string
  type: AgendaItemType
  date: Date
  /** Primary label — job title for job events, todo title for todos. */
  title: string
  /** Company name for job events and job-linked todos; null otherwise. */
  company: string | null
  jobApplicationId: string | null
  /** Only present for todo items. */
  done?: boolean
  /** The date has already passed — the item belongs in the Overdue section. */
  overdue?: boolean
}

export interface AgendaJobInput {
  id: string
  /** Only live applications can go overdue; see `FOLLOW_UP_STATUSES`. */
  status: ApplicationStatus
  companyName: string
  jobTitle: string
  deadline: Date | null
  interviewDate: Date | null
  /** When to chase the application; null when no follow-up is scheduled. */
  followUpAt: Date | null
}

export interface AgendaTodoInput {
  id: string
  title: string
  dueDate: Date | null
  done: boolean
  jobApplicationId: string | null
  /**
   * The linked application, when the todo hangs off one. Carries the company so
   * a job-linked todo reads like the job rows around it; explicitly null for a
   * standalone todo. Required rather than optional so a caller that forgets to
   * select it fails to compile instead of silently rendering no company.
   */
  jobApplication: { job: { companyName: string } } | null
}

/**
 * Pure merge/sort/tag logic: combine job deadlines + interview dates and todo
 * due dates into one chronologically-sorted agenda within [from, to).
 *
 * When `overdueFrom` is given, deadlines and follow-ups that fell in
 * [overdueFrom, from) on a still-live application, and todos due in that span
 * that are still not done, are included too, tagged `overdue`. They sort first
 * because their dates are earlier.
 */
export function buildAgenda(
  jobs: AgendaJobInput[],
  todos: AgendaTodoInput[],
  from: Date,
  to: Date,
  overdueFrom?: Date
): AgendaItem[] {
  const inRange = (d: Date) => d >= from && d < to
  const isOverdue = (d: Date) =>
    overdueFrom !== undefined && d >= overdueFrom && d < from
  const items: AgendaItem[] = []

  for (const job of jobs) {
    const isLive = FOLLOW_UP_STATUSES.includes(job.status)

    if (isLive && job.deadline && isOverdue(job.deadline)) {
      items.push({
        key: `deadline:${job.id}`,
        type: "deadline",
        date: job.deadline,
        title: job.jobTitle,
        company: job.companyName,
        jobApplicationId: job.id,
        overdue: true,
      })
    }
    if (isLive && job.followUpAt && isOverdue(job.followUpAt)) {
      items.push({
        key: `follow-up:${job.id}`,
        type: "follow-up",
        date: job.followUpAt,
        title: job.jobTitle,
        company: job.companyName,
        jobApplicationId: job.id,
        overdue: true,
      })
    }

    if (job.interviewDate && inRange(job.interviewDate)) {
      items.push({
        key: `interview:${job.id}`,
        type: "interview",
        date: job.interviewDate,
        title: job.jobTitle,
        company: job.companyName,
        jobApplicationId: job.id,
      })
    }
    if (job.deadline && inRange(job.deadline)) {
      items.push({
        key: `deadline:${job.id}`,
        type: "deadline",
        date: job.deadline,
        title: job.jobTitle,
        company: job.companyName,
        jobApplicationId: job.id,
      })
    }
    // Same live-status guard as the overdue branch: a finished application
    // has nobody left to chase, so its Done/Snooze would only error.
    if (isLive && job.followUpAt && inRange(job.followUpAt)) {
      items.push({
        key: `follow-up:${job.id}`,
        type: "follow-up",
        date: job.followUpAt,
        title: job.jobTitle,
        company: job.companyName,
        jobApplicationId: job.id,
      })
    }
  }

  for (const todo of todos) {
    // A todo that slipped past its day is still a task until it is ticked off.
    if (!todo.done && todo.dueDate && isOverdue(todo.dueDate)) {
      items.push({
        key: todoAgendaKey(todo.id),
        type: "todo",
        date: todo.dueDate,
        title: todo.title,
        company: todo.jobApplication?.job.companyName ?? null,
        jobApplicationId: todo.jobApplicationId,
        done: todo.done,
        overdue: true,
      })
    }
    if (todo.dueDate && inRange(todo.dueDate)) {
      items.push({
        key: todoAgendaKey(todo.id),
        type: "todo",
        date: todo.dueDate,
        title: todo.title,
        company: todo.jobApplication?.job.companyName ?? null,
        jobApplicationId: todo.jobApplicationId,
        done: todo.done,
      })
    }
  }

  return items.sort((a, b) => a.date.getTime() - b.date.getTime())
}

/**
 * Fetch and merge a user's agenda: job application deadlines, interview dates,
 * and todo due dates for the next 30 days, plus deadlines and follow-ups from
 * the previous 30 days that a live application has already blown past, and
 * todos from that span that are still not done.
 *
 * `todayStart` is the UTC midnight the window is framed on. Pass the user's own
 * day (`getUserDayStart()`) so the agenda starts where their calendar does; the
 * default is the server's UTC day. It used to be the server's *local* midnight,
 * which is UTC in production and so silently disagreed with the dates the
 * calendar-date fields actually hold.
 */
export async function getUpcomingAgenda(
  userId: string,
  todayStart: Date = calendarDayStart(new Date()),
): Promise<AgendaItem[]> {
  const from = todayStart
  const to = addCalendarDays(from, 30)
  const overdueFrom = addCalendarDays(from, -OVERDUE_LOOKBACK_DAYS)

  const [jobs, todos] = await Promise.all([
    prisma.jobApplication.findMany({
      where: {
        userId,
        OR: [
          // `deadline` lives on the posting now, so this arm filters the relation.
          { job: { deadline: { gte: from, lt: to } } },
          { interviewDate: { gte: from, lt: to } },
          { followUpAt: { gte: from, lt: to } },
          // Already slipped, and only on applications still waiting on a reply.
          {
            status: { in: FOLLOW_UP_STATUSES },
            job: { deadline: { gte: overdueFrom, lt: from } },
          },
          {
            status: { in: FOLLOW_UP_STATUSES },
            followUpAt: { gte: overdueFrom, lt: from },
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
    prisma.todo.findMany({
      where: {
        userId,
        OR: [
          { dueDate: { gte: from, lt: to } },
          // Already slipped and still open; bounded by the same lookback.
          { done: false, dueDate: { gte: overdueFrom, lt: from } },
        ],
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        done: true,
        jobApplicationId: true,
        jobApplication: { select: { job: { select: { companyName: true } } } },
      },
    }),
  ])

  // The posting fields come off the `job` relation now; `buildAgenda` still
  // takes the flat shape it always has.
  const jobInputs: AgendaJobInput[] = jobs.map((application) => ({
    id: application.id,
    status: application.status,
    companyName: application.job.companyName,
    jobTitle: application.job.title,
    deadline: application.job.deadline,
    interviewDate: application.interviewDate,
    followUpAt: application.followUpAt,
  }))

  return buildAgenda(jobInputs, todos, from, to, overdueFrom)
}
