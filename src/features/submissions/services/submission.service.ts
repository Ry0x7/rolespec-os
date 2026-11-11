import { Prisma } from "@/generated/prisma/client"
import type {
  SubmissionAttemptStatus,
  SubmissionSource,
} from "@/generated/prisma/enums"
import { scheduleFollowUpTasks } from "@/features/jobs/services/follow-up-task.service"
import { logger, redactText } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"

const log = logger("submissions")

export class SubmissionError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT" | "TERMINAL"
  ) {
    super(message)
    this.name = "SubmissionError"
  }
}

export interface SubmissionAttemptView {
  id: string
  jobApplicationId: string | null
  workflowRunId: string | null
  atsPreparationId: string | null
  resumeId: string | null
  source: SubmissionSource
  status: SubmissionAttemptStatus
  jobTitle: string | null
  companyName: string | null
  sourceUrl: string | null
  evidence: Prisma.JsonValue | null
  confirmedAt: string | null
  confirmationNote: string | null
  createdAt: string
  updatedAt: string
}

const ATTEMPT_SELECT = {
  id: true,
  jobApplicationId: true,
  workflowRunId: true,
  atsPreparationId: true,
  resumeId: true,
  source: true,
  status: true,
  jobTitle: true,
  companyName: true,
  sourceUrl: true,
  evidence: true,
  confirmedAt: true,
  confirmationNote: true,
  createdAt: true,
  updatedAt: true,
} as const

type AttemptRow = {
  id: string
  jobApplicationId: string | null
  workflowRunId: string | null
  atsPreparationId: string | null
  resumeId: string | null
  source: SubmissionSource
  status: SubmissionAttemptStatus
  jobTitle: string | null
  companyName: string | null
  sourceUrl: string | null
  evidence: unknown
  confirmedAt: Date | null
  confirmationNote: string | null
  createdAt: Date
  updatedAt: Date
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function asJson(value: unknown): Prisma.JsonValue | null {
  if (value === null || value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue
}

function toView(row: AttemptRow): SubmissionAttemptView {
  return {
    id: row.id,
    jobApplicationId: row.jobApplicationId,
    workflowRunId: row.workflowRunId,
    atsPreparationId: row.atsPreparationId,
    resumeId: row.resumeId,
    source: row.source,
    status: row.status,
    jobTitle: row.jobTitle,
    companyName: row.companyName,
    sourceUrl: row.sourceUrl,
    evidence: asJson(row.evidence),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    confirmationNote: row.confirmationNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export interface StageSubmissionInput {
  userId: string
  jobApplicationId?: string | null
  workflowRunId?: string | null
  atsPreparationId?: string | null
  resumeId?: string | null
  source: SubmissionSource
  jobTitle?: string | null
  companyName?: string | null
  sourceUrl?: string | null
  evidence?: unknown
}

/**
 * Creates the single staging record for a workflow run or ATS preparation.
 * Replays return the existing row, including one already confirmed submitted;
 * staging must never reset a confirmed fact.
 */
export async function ensureStagedAttempt(
  tx: Prisma.TransactionClient,
  input: StageSubmissionInput
): Promise<AttemptRow> {
  const identity = input.workflowRunId
    ? { workflowRunId: input.workflowRunId }
    : input.atsPreparationId
      ? { atsPreparationId: input.atsPreparationId }
      : input.source === "MANUAL" && input.jobApplicationId
        ? { source: "MANUAL" as const, jobApplicationId: input.jobApplicationId }
        : null
  if (!identity) {
    throw new SubmissionError(
      "A staging record needs a workflow run or ATS preparation.",
      "INVALID_INPUT"
    )
  }

  const existing = await tx.submissionAttempt.findFirst({
    where: { userId: input.userId, ...identity },
    select: ATTEMPT_SELECT,
  })
  if (existing) return existing

  try {
    return await tx.submissionAttempt.create({
      data: {
        userId: input.userId,
        jobApplicationId: input.jobApplicationId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        atsPreparationId: input.atsPreparationId ?? null,
        resumeId: input.resumeId ?? null,
        source: input.source,
        status: "STAGED",
        jobTitle: input.jobTitle?.slice(0, 200) ?? null,
        companyName: input.companyName?.slice(0, 200) ?? null,
        sourceUrl: input.sourceUrl ?? null,
        ...(input.evidence === undefined ? {} : { evidence: json(input.evidence) }),
      },
      select: ATTEMPT_SELECT,
    })
  } catch (error) {
    // Two replays can race on the unique workflow/ATS key. The winner is the
    // only record; the loser reads it rather than surfacing a database error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await tx.submissionAttempt.findFirst({
        where: { userId: input.userId, ...identity },
        select: ATTEMPT_SELECT,
      })
      if (raced) return raced
    }
    throw error
  }
}

export async function stageSubmissionAttempt(
  input: StageSubmissionInput
): Promise<SubmissionAttemptView> {
  if (input.jobApplicationId) {
    const application = await prisma.jobApplication.findFirst({
      where: { id: input.jobApplicationId, userId: input.userId },
      select: { id: true },
    })
    if (!application) {
      throw new SubmissionError("Application not found.", "NOT_FOUND")
    }
  }
  const row = await prisma.$transaction((tx) => ensureStagedAttempt(tx, input))
  return toView(row)
}

interface ConfirmInput {
  submitted: boolean
  note?: string | null
}

/**
 * Applies an explicit user confirmation inside the caller's transaction. A
 * submission is one-way. The tracker only advances from INTERESTED to APPLIED;
 * a later-stage application is never downgraded by a repeated confirmation.
 */
export async function applyAttemptConfirmation(
  tx: Prisma.TransactionClient,
  userId: string,
  attempt: AttemptRow,
  input: ConfirmInput
): Promise<{ attempt: AttemptRow; applicationStatus: string | null }> {
  const note = input.note ? redactText(input.note, 2000) : null

  if (attempt.status === "ABANDONED") {
    throw new SubmissionError("That staging record was abandoned.", "TERMINAL")
  }
  if (attempt.status === "SUBMITTED" && !input.submitted) {
    throw new SubmissionError(
      "This application was already confirmed as submitted. Correct the tracker if that was a mistake.",
      "TERMINAL"
    )
  }
  if (attempt.status === "SUBMITTED" && input.submitted) {
    return { attempt, applicationStatus: "APPLIED" }
  }
  if (attempt.status === "NOT_SUBMITTED" && !input.submitted) {
    return { attempt, applicationStatus: null }
  }

  let applicationStatus: string | null = null
  if (input.submitted && attempt.jobApplicationId) {
    const application = await tx.jobApplication.findFirst({
      where: { id: attempt.jobApplicationId, userId },
      select: { id: true, status: true, dateApplied: true, followUpAt: true },
    })
    if (application) {
      const fromStatus = application.status
      applicationStatus = fromStatus
      if (fromStatus === "INTERESTED") {
        applicationStatus = "APPLIED"
        const now = new Date()
        await tx.jobApplication.update({
          where: { id: application.id },
          data: {
            status: "APPLIED",
            dateApplied:
              application.dateApplied ??
              new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
          },
        })
        await tx.applicationStatusEvent.create({
          data: {
            jobApplicationId: application.id,
            fromStatus,
            toStatus: "APPLIED",

            note:
              note ??
              (attempt.source === "EXTENSION"
                ? "Submission confirmed by the user in the browser extension."
                : "Submission confirmed by the user."),
            source:
              attempt.source === "EXTENSION"
                ? "EXTENSION"
                : attempt.source === "WORKFLOW"
                  ? "WORKFLOW"
                  : "USER",
          },
        })
      }

      if (application.status !== "REJECTED" && application.status !== "WITHDRAWN") {
        const now = new Date()
        const appliedOn =
          application.dateApplied ??
          new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        const tasks = await scheduleFollowUpTasks(tx, {
          userId,
          jobApplicationId: application.id,
          appliedOn,
          source: attempt.source,
        })
        const emailTask = tasks.find((task) => task.channel === "EMAIL")
        // Keep the tracker's legacy follow-up field aligned with the durable
        // email reminder. A user-set date is never overwritten.
        if (fromStatus === "INTERESTED" && !application.followUpAt && emailTask) {
          await tx.jobApplication.update({
            where: { id: application.id },
            data: { followUpAt: emailTask.dueAt },
          })
        }
      }
    }
  }

  const updated = await tx.submissionAttempt.update({
    where: { id: attempt.id },
    data: {
      status: input.submitted ? "SUBMITTED" : "NOT_SUBMITTED",
      confirmedAt: new Date(),
      confirmationNote: note,
    },
    select: ATTEMPT_SELECT,
  })

  log.info("Submission confirmation recorded", {
    userId,
    attemptId: attempt.id,
    submitted: input.submitted,
    applicationStatus,
  })
  return { attempt: updated, applicationStatus }
}

export async function confirmSubmissionAttempt(
  userId: string,
  id: string,
  input: ConfirmInput
): Promise<{ attempt: SubmissionAttemptView; applicationStatus: string | null }> {
  const result = await prisma.$transaction(async (tx) => {
    const attempt = await tx.submissionAttempt.findFirst({
      where: { id, userId },
      select: ATTEMPT_SELECT,
    })
    if (!attempt) throw new SubmissionError("Submission attempt not found.", "NOT_FOUND")
    return applyAttemptConfirmation(tx, userId, attempt, input)
  })
  return { attempt: toView(result.attempt), applicationStatus: result.applicationStatus }
}

export async function getSubmissionAttempt(
  userId: string,
  id: string
): Promise<SubmissionAttemptView | null> {
  const row = await prisma.submissionAttempt.findFirst({
    where: { id, userId },
    select: ATTEMPT_SELECT,
  })
  return row ? toView(row) : null
}

export async function listSubmissionAttempts(
  userId: string,
  filters: { jobApplicationId?: string; status?: SubmissionAttemptStatus; limit?: number } = {}
): Promise<SubmissionAttemptView[]> {
  const rows = await prisma.submissionAttempt.findMany({
    where: {
      userId,
      ...(filters.jobApplicationId ? { jobApplicationId: filters.jobApplicationId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(50, Math.max(1, Math.floor(filters.limit ?? 20))),
    select: ATTEMPT_SELECT,
  })
  return rows.map(toView)
}
