import { Prisma } from "@/generated/prisma/client"
import type {
  FollowUpChannel,
  FollowUpStatus,
} from "@/generated/prisma/enums"
import { addBusinessDays, toCalendarDateString } from "@/shared/lib/dates"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"

const log = logger("jobs/follow-up-task")

/**
 * The two follow-ups Recruitt recommends, expressed as weekday counts. They are
 * separate channels rather than one reminder because the message and the place
 * it goes are different: email at +5, a short LinkedIn note at +12.
 *
 * No holiday calendar is applied. A due date can therefore fall on a public
 * holiday; the user can snooze it, and the task remains a reminder, never an
 * automatic send.
 */
export const FOLLOW_UP_PLAN: ReadonlyArray<{
  channel: FollowUpChannel
  businessDays: number
  reason: string
}> = [
  {
    channel: "EMAIL",
    businessDays: 5,
    reason: "Check in by email five business days after applying.",
  },
  {
    channel: "LINKEDIN",
    businessDays: 12,
    reason: "Send a short LinkedIn follow-up twelve business days after applying.",
  },
]

export interface FollowUpTaskView {
  id: string
  jobApplicationId: string
  channel: FollowUpChannel
  status: FollowUpStatus
  dueAt: string
  appliedOn: string | null
  reason: string | null
  source: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

const TASK_SELECT = {
  id: true,
  jobApplicationId: true,
  channel: true,
  status: true,
  dueAt: true,
  appliedOn: true,
  reason: true,
  source: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

type TaskRow = {
  id: string
  jobApplicationId: string
  channel: FollowUpChannel
  status: FollowUpStatus
  dueAt: Date
  appliedOn: Date | null
  reason: string | null
  source: string
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function toView(row: TaskRow): FollowUpTaskView {
  return {
    id: row.id,
    jobApplicationId: row.jobApplicationId,
    channel: row.channel,
    status: row.status,
    dueAt: toCalendarDateString(row.dueAt),
    appliedOn: row.appliedOn ? toCalendarDateString(row.appliedOn) : null,
    reason: row.reason,
    source: row.source,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The weekday-based due day for one channel, anchored to the application day. */
export function followUpDueDate(
  appliedOn: Date,
  channel: FollowUpChannel
): Date {
  const plan = FOLLOW_UP_PLAN.find((entry) => entry.channel === channel)
  const days = plan?.businessDays ?? 5
  return addBusinessDays(appliedOn, days)
}

/**
 * Creates or refreshes the two durable tasks for an application that just
 * reached APPLIED. Called inside the caller's transaction so the status move and
 * its reminders cannot disagree.
 *
 * Idempotent: an existing PENDING row keeps its original due date, so a repeated
 * confirmation or a restart does not push the reminder further out. A completed
 * or dismissed row is reset only when the application is applied again.
 */
export async function scheduleFollowUpTasks(
  tx: Prisma.TransactionClient,
  input: {
    userId: string
    jobApplicationId: string
    appliedOn: Date
    source?: string
  }
): Promise<TaskRow[]> {
  const rows: TaskRow[] = []
  for (const plan of FOLLOW_UP_PLAN) {
    const dueAt = addBusinessDays(input.appliedOn, plan.businessDays)
    const existing = await tx.followUpTask.findFirst({
      where: {
        userId: input.userId,
        jobApplicationId: input.jobApplicationId,
        channel: plan.channel,
      },
      select: TASK_SELECT,
    })

    if (existing?.status === "PENDING") {
      rows.push(existing)
      continue
    }

    if (existing) {
      const updated = await tx.followUpTask.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          dueAt,
          appliedOn: input.appliedOn,
          reason: plan.reason,
          source: input.source ?? "AUTO",
          completedAt: null,
        },
        select: TASK_SELECT,
      })
      rows.push(updated)
      continue
    }

    try {
      const created = await tx.followUpTask.create({
        data: {
          userId: input.userId,
          jobApplicationId: input.jobApplicationId,
          channel: plan.channel,
          status: "PENDING",
          dueAt,
          appliedOn: input.appliedOn,
          reason: plan.reason,
          source: input.source ?? "AUTO",
        },
        select: TASK_SELECT,
      })
      rows.push(created)
    } catch (error) {
      // Two concurrent confirmations can race on the per-channel unique key.
      // The winner's task is the reminder; the loser reads it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await tx.followUpTask.findFirst({
          where: {
            userId: input.userId,
            jobApplicationId: input.jobApplicationId,
            channel: plan.channel,
          },
          select: TASK_SELECT,
        })
        if (raced) {
          rows.push(raced)
          continue
        }
      }
      throw error
    }
  }
  return rows
}

/** Cancels reminders that no longer make sense because the application closed. */
export async function cancelFollowUpTasks(
  tx: Prisma.TransactionClient,
  input: { userId: string; jobApplicationId: string }
): Promise<number> {
  const result = await tx.followUpTask.updateMany({
    where: {
      userId: input.userId,
      jobApplicationId: input.jobApplicationId,
      status: "PENDING",
    },
    data: { status: "CANCELLED", completedAt: new Date() },
  })
  return result.count
}

export async function listFollowUpTasks(
  userId: string,
  options: {
    status?: FollowUpStatus
    jobApplicationId?: string
    dueOnly?: boolean
    limit?: number
    now?: Date
  } = {}
): Promise<FollowUpTaskView[]> {
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 50)))
  const rows = await prisma.followUpTask.findMany({
    where: {
      userId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.jobApplicationId
        ? { jobApplicationId: options.jobApplicationId }
        : {}),
      ...(options.dueOnly
        ? {
            status: "PENDING",
            dueAt: { lte: options.now ?? new Date() },
          }
        : {}),
    },
    select: TASK_SELECT,
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  })
  return rows.map(toView)
}

export async function completeFollowUpTask(
  userId: string,
  id: string,
  status: "DONE" | "DISMISSED"
): Promise<FollowUpTaskView | null> {
  const existing = await prisma.followUpTask.findFirst({
    where: { id, userId },
    select: TASK_SELECT,
  })
  if (!existing) return null
  if (existing.status === "CANCELLED") {
    throw new FollowUpTaskError(
      "That follow-up was cancelled because the application closed.",
      "TERMINAL"
    )
  }
  const updated = await prisma.followUpTask.update({
    where: { id },
    data: { status, completedAt: new Date() },
    select: TASK_SELECT,
  })
  log.info("Follow-up task closed", { userId, taskId: id, status })
  return toView(updated)
}

export class FollowUpTaskError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "TERMINAL" | "INVALID_INPUT"
  ) {
    super(message)
    this.name = "FollowUpTaskError"
  }
}
