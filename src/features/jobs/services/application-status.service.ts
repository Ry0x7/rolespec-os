import type { Prisma } from "@/generated/prisma/client"
import type { ApplicationStatus } from "@/generated/prisma/enums"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"

/**
 * Application status history.
 *
 * The tracker column answers "where is this application now"; this service
 * records how it got there. Rows are append-only and scoped through their
 * application, so the ownership check is the same `userId` read used everywhere
 * else — a foreign application id can never surface another user's history.
 */

const log = logger("application-status")

/** Who caused a move. Free text in the database, named here for callers. */
export const STATUS_EVENT_SOURCES = {
  USER: "USER",
  EXTENSION: "EXTENSION",
  MIGRATION: "MIGRATION",
} as const

export type StatusEventSource =
  (typeof STATUS_EVENT_SOURCES)[keyof typeof STATUS_EVENT_SOURCES]

/**
 * Either the root client or a transaction client. Both expose the delegate, so
 * a transition can be written in the same transaction as the status update it
 * describes.
 */
export type StatusEventWriter = Prisma.TransactionClient

export interface RecordStatusTransitionInput {
  jobApplicationId: string
  /** Null only when tracking starts. */
  fromStatus: ApplicationStatus | null
  toStatus: ApplicationStatus
  note?: string | null
  source?: StatusEventSource | string
  createdAt?: Date
}

/**
 * Appends one history row when — and only when — the status actually moved.
 * Returns false for a no-op save so callers can keep using it unconditionally.
 */
export async function recordStatusTransition(
  client: StatusEventWriter,
  input: RecordStatusTransitionInput
): Promise<boolean> {
  if (input.fromStatus === input.toStatus) return false

  const note = input.note?.trim()

  await client.applicationStatusEvent.create({
    data: {
      jobApplicationId: input.jobApplicationId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      note: note ? note.slice(0, 2000) : null,
      source: input.source ?? STATUS_EVENT_SOURCES.USER,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  })

  return true
}

export interface ApplicationStatusHistory {
  /** Oldest first, so the timeline reads top-to-bottom. */
  events: Array<{
    id: string
    fromStatus: ApplicationStatus | null
    toStatus: ApplicationStatus
    note: string | null
    source: string
    createdAt: Date
  }>
}

/**
 * Reads one application's history, scoped to its owner. Returns an empty list
 * for a missing or foreign application rather than leaking existence: the page
 * already resolves the application under the same `userId`, and a caller that
 * only has this result sees the same "nothing recorded" shape either way.
 */
export async function getApplicationStatusHistory(
  userId: string,
  jobApplicationId: string
): Promise<ApplicationStatusHistory> {
  const events = await prisma.applicationStatusEvent.findMany({
    where: {
      jobApplicationId,
      jobApplication: { userId },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      source: true,
      createdAt: true,
    },
  })

  return { events }
}

/**
 * Best-effort variant for a write path whose update already committed. A failed
 * history insert is logged rather than turned into a failed status move: the
 * application state is the product, and losing one narrative row is recoverable
 * without pretending the move did not happen.
 */
export async function recordStatusTransitionBestEffort(
  input: RecordStatusTransitionInput
): Promise<void> {
  try {
    await recordStatusTransition(prisma, input)
  } catch (err) {
    log.warn("Failed to record an application status transition", {
      err,
      jobApplicationId: input.jobApplicationId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
    })
  }
}
