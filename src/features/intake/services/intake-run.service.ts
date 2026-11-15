import { Prisma } from "@/generated/prisma/client"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import { getIntakeAdapter } from "../adapters/registry"
import { dedupeDrafts, dedupeKeyFor, fingerprintFor } from "../lib/patch-fingerprint"
import { parsePatchData, patchDraftSchema } from "../schemas/intake.schema"
import { IntakeAdapterError } from "../types"
import type {
  IntakeAdapterResult,
  IntakePatchDraft,
  IntakeSource,
  IntakeSourceStatus,
} from "../types"
import type { IntakeSourceRequest } from "../schemas/intake.schema"
import { INTAKE_RUN_INCLUDE, toIntakeRunDTO } from "./intake-dto"

const log = logger("intake/run")

export class IntakeRunError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message)
    this.name = "IntakeRunError"
  }
}

/** In-process handles so `cancel` can interrupt an adapter between awaits. */
const activeRuns = new Map<string, AbortController>()

const TERMINAL_SOURCE_STATUSES: IntakeSourceStatus[] = [
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
  "SKIPPED",
]

function isTerminal(status: string): boolean {
  return (
    status === "COMPLETED" ||
    status === "PARTIAL" ||
    status === "FAILED" ||
    status === "CANCELLED"
  )
}

/**
 * Source content is kept on the source row because a retry must be able to run
 * after a process restart; raw file bytes and provider credentials are never
 * stored. The DTO never returns this field.
 */
function summarizeSourceInput(
  request: IntakeSourceRequest
): Record<string, unknown> {
  switch (request.source) {
    case "RESUME":
      return {
        resumeId: request.input.resumeId ?? null,
        text: request.input.text ?? null,
        fileName: request.input.fileName ?? null,
      }
    case "LINKEDIN":
      return {
        text: request.input.text,
        fileName: request.input.fileName ?? null,
        useAi: request.input.useAi ?? false,
      }
    case "GITHUB":
    case "WEB":
      return { url: request.input.url, consent: request.input.consent }
    case "CHAT":
      return {
        transcript: request.input.transcript,
        missingFields: request.input.missingFields ?? [],
        useAi: request.input.useAi ?? false,
      }
    case "VOICE":
      return {
        transcript: request.input.transcript,
        inputMode: request.input.inputMode,
        useAi: request.input.useAi ?? false,
      }
  }
  // Exhaustive switch: a new source must add a summary here.
  return {}
}

export async function createIntakeRun(
  userId: string,
  requests: IntakeSourceRequest[],
  idempotencyKey?: string
) {
  if (idempotencyKey) {
    const existing = await prisma.intakeRun.findFirst({
      where: { userId, idempotencyKey },
      select: { id: true },
    })
    if (existing) return existing.id
  }

  try {
    const run = await prisma.intakeRun.create({
      data: {
        userId,
        idempotencyKey: idempotencyKey ?? null,
        status: "PENDING",
        requestedSources: requests.map((request) => request.source),
        sources: {
          create: requests.map((request) => ({
            source: request.source,
            input: summarizeSourceInput(request) as Prisma.InputJsonObject,
          })),
        },
      },
      select: { id: true },
    })
    return run.id
  } catch (error) {
    // Two identical submissions can race on the unique replay key. Returning
    // the winner is the whole point of the key.
    if (
      idempotencyKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.intakeRun.findFirst({
        where: { userId, idempotencyKey },
        select: { id: true },
      })
      if (existing) return existing.id
    }
    throw error
  }
}

async function executeSource(
  runId: string,
  userId: string,
  sourceRun: {
    id: string
    source: string
    status: string
    input: unknown
  },
  runSignal: AbortSignal
): Promise<void> {
  if (sourceRun.status !== "PENDING" || runSignal.aborted) return

  const source = sourceRun.source as IntakeSource
  const adapter = getIntakeAdapter(source)
  const controller = new AbortController()
  const abortSource = () => controller.abort()
  runSignal.addEventListener("abort", abortSource, { once: true })
  let lastWrite = 0

  // Conditional claim: a cancel that landed between the run query and this
  // write must win. Without the status filter, a cancelled source could be
  // resurrected as RUNNING and then overwrite its own cancellation.
  const claimed = await prisma.intakeSourceRun.updateMany({
    where: { id: sourceRun.id, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date(), progress: 0, error: null },
  })
  if (claimed.count === 0) {
    runSignal.removeEventListener("abort", abortSource)
    return
  }

  const reportProgress = async (progress: number, message?: string) => {
    if (controller.signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }
    const now = Date.now()
    if (now - lastWrite < 300 && progress < 100) return
    lastWrite = now

    const current = await prisma.intakeRun.findUnique({
      where: { id: runId },
      select: { status: true },
    })
    if (current?.status === "CANCELLED") {
      controller.abort()
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }
    await prisma.intakeSourceRun.updateMany({
      where: { id: sourceRun.id, status: "RUNNING" },
      data: {
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        message: message?.slice(0, 300) ?? null,
      },
    })
  }

  try {
    const result: IntakeAdapterResult = await adapter.run({
      input:
        sourceRun.input && typeof sourceRun.input === "object"
          ? (sourceRun.input as Record<string, unknown>)
          : {},
      userId,
      runId,
      sourceRunId: sourceRun.id,
      signal: controller.signal,
      reportProgress,
    })

    if (controller.signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }

    const validated: IntakePatchDraft[] = result.patches.map((draft) => {
      const parsed = patchDraftSchema.parse(draft)
      return parsed as IntakePatchDraft
    })
    const { kept, duplicates } = dedupeDrafts(validated)

    if (kept.length > 0) {
      await prisma.intakePatch.createMany({
        data: kept.map((draft) => ({
          runId,
          sourceRunId: sourceRun.id,
          source,
          kind: draft.kind,
          fingerprint: fingerprintFor(draft.kind, draft.data),
          confidence: draft.confidence,
          payload: draft.data as object,
          provenance: draft.provenance as object,
          status: "PENDING",
        })),
      })
    }

    const warnings = [...(result.warnings ?? [])]
    if (duplicates > 0) {
      warnings.push(`${duplicates} duplicate fact${duplicates === 1 ? "" : "s"} removed.`)
    }

    await prisma.intakeSourceRun.update({
      where: { id: sourceRun.id },
      data: {
        status: warnings.length > 0 ? "PARTIAL" : "SUCCEEDED",
        progress: 100,
        message:
          kept.length === 0
            ? "No new facts found. You can add them manually."
            : `${kept.length} fact${kept.length === 1 ? "" : "s"} ready for review.`,
        metadata: {
          patchCount: kept.length,
          duplicates,
          warnings,
        },
        finishedAt: new Date(),
      },
    })
  } catch (error) {
    if (controller.signal.aborted || error instanceof IntakeAdapterError) {
      const cancelled =
        controller.signal.aborted ||
        (error instanceof IntakeAdapterError && error.code === "CANCELLED")
      await prisma.intakeSourceRun.update({
        where: { id: sourceRun.id },
        data: {
          status: cancelled ? "CANCELLED" : "FAILED",
          progress: 0,
          error:
            error instanceof Error
              ? error.message.slice(0, 1000)
              : "The source could not be read.",
          finishedAt: new Date(),
        },
      })
      return
    }
    log.error("Intake source failed", { err: error, source, runId })
    await prisma.intakeSourceRun.update({
      where: { id: sourceRun.id },
      data: {
        status: "FAILED",
        error: "The source could not be read. Try again, or enter the facts manually.",
        finishedAt: new Date(),
      },
    })
  } finally {
    runSignal.removeEventListener("abort", abortSource)
  }
}

/**
 * After every adapter finishes, exact duplicate claims from different sources
 * are marked rejected — but still visible — so the review queue is one row per
 * fact. The highest-confidence version wins; ties keep the oldest.
 */
async function dedupeRunPatches(runId: string) {
  const patches = await prisma.intakePatch.findMany({
    where: { runId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      payload: true,
      fingerprint: true,
      confidence: true,
      source: true,
      createdAt: true,
    },
  })

  const winners = new Map<string, (typeof patches)[number]>()
  const duplicates: string[] = []

  for (const patch of patches) {
    const key = dedupeKeyFor(
      patch.kind as IntakePatchDraft["kind"],
      parsePatchData(patch.kind as IntakePatchDraft["kind"], patch.payload)
    )
    const winner = winners.get(key)
    if (!winner) {
      winners.set(key, patch)
      continue
    }
    if (patch.confidence > winner.confidence) {
      duplicates.push(winner.id)
      winners.set(key, patch)
    } else {
      duplicates.push(patch.id)
    }
  }

  if (duplicates.length === 0) return
  await prisma.intakePatch.updateMany({
    where: { id: { in: duplicates } },
    data: {
      status: "REJECTED",
      rejectionReason:
        "Duplicate claim in this intake run. The highest-confidence version is kept for review.",
    },
  })
}

export async function executeIntakeRun(runId: string): Promise<void> {
  const claimed = await prisma.intakeRun.updateMany({
    where: { id: runId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date(), error: null },
  })
  if (claimed.count === 0) return

  const run = await prisma.intakeRun.findUnique({
    where: { id: runId },
    include: { sources: true },
  })
  if (!run) return

  const controller = new AbortController()
  activeRuns.set(runId, controller)

  try {
    await Promise.all(
      run.sources.map((source) =>
        executeSource(
          runId,
          run.userId,
          {
            id: source.id,
            source: source.source,
            status: source.status,
            input: source.input,
          },
          controller.signal
        )
      )
    )

    await dedupeRunPatches(runId)
    const sources = await prisma.intakeSourceRun.findMany({
      where: { runId },
      select: { source: true, status: true, error: true, metadata: true },
    })

    const current = await prisma.intakeRun.findUnique({
      where: { id: runId },
      select: { status: true },
    })
    if (current?.status === "CANCELLED") return

    const ok = sources.filter(
      (source) => source.status === "SUCCEEDED" || source.status === "PARTIAL"
    )
    const failed = sources.filter((source) => source.status === "FAILED")
    const cancelled = sources.some((source) => source.status === "CANCELLED")

    const status = cancelled
      ? "CANCELLED"
      : ok.length === sources.length
        ? "COMPLETED"
        : ok.length > 0
          ? "PARTIAL"
          : "FAILED"

    const warnings = sources.flatMap((source) => {
      const metadata =
        source.metadata && typeof source.metadata === "object"
          ? (source.metadata as Record<string, unknown>)
          : {}
      const sourceWarnings = Array.isArray(metadata.warnings)
        ? metadata.warnings.filter((item): item is string => typeof item === "string")
        : []
      return [
        ...sourceWarnings.map((warning) => `${source.source}: ${warning}`),
        ...(source.status === "FAILED" && source.error
          ? [`${source.source}: ${source.error}`]
          : []),
      ]
    })

    await prisma.intakeRun.update({
      where: { id: runId },
      data: {
        status,
        warnings,
        error:
          status === "FAILED"
            ? failed
                .map((source) => `${source.source}: ${source.error ?? "failed"}`)
                .join(" ")
                .slice(0, 2000)
            : null,
        finishedAt: new Date(),
      },
    })
  } catch (error) {
    log.error("Intake run failed unexpectedly", { err: error, runId })
    await prisma.intakeRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: {
        status: "FAILED",
        error: "The intake run failed unexpectedly. You can retry the failed sources.",
        finishedAt: new Date(),
      },
    })
  } finally {
    activeRuns.delete(runId)
  }
}

export async function cancelIntakeRun(userId: string, runId: string) {
  const run = await prisma.intakeRun.findFirst({
    where: { id: runId, userId },
    select: { id: true, status: true },
  })
  if (!run) throw new IntakeRunError(404, "Intake run not found")
  if (run.status === "CANCELLED") {
    return getIntakeRun(userId, runId)
  }
  if (isTerminal(run.status)) {
    throw new IntakeRunError(409, "This intake run has already finished.")
  }

  activeRuns.get(runId)?.abort()
  await prisma.$transaction([
    prisma.intakeRun.update({
      where: { id: runId },
      data: { status: "CANCELLED", finishedAt: new Date() },
    }),
    prisma.intakeSourceRun.updateMany({
      where: {
        runId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      data: { status: "CANCELLED", finishedAt: new Date() },
    }),
  ])
  return getIntakeRun(userId, runId)
}

/**
 * Retries only sources that actually failed or were cancelled. A source that
 * succeeded is never re-read, so a retry cannot silently replace reviewed facts.
 */
export async function retryIntakeRun(userId: string, runId: string) {
  const run = await prisma.intakeRun.findFirst({
    where: { id: runId, userId },
    include: { sources: { select: { id: true, status: true } } },
  })
  if (!run) throw new IntakeRunError(404, "Intake run not found")
  if (run.status === "RUNNING" || run.status === "PENDING") {
    throw new IntakeRunError(409, "This intake run is still in progress.")
  }
  const retryable = run.sources.filter(
    (source) => source.status === "FAILED" || source.status === "CANCELLED"
  )
  if (retryable.length === 0) {
    throw new IntakeRunError(409, "There is no failed source to retry.")
  }
  const ids = retryable.map((source) => source.id)

  await prisma.$transaction([
    // Unreviewed output from the cancelled attempt is replaced, not duplicated.
    prisma.intakePatch.deleteMany({
      where: { sourceRunId: { in: ids }, status: { not: "APPLIED" } },
    }),
    prisma.intakeSourceRun.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "PENDING",
        progress: 0,
        message: null,
        error: null,
        metadata: Prisma.DbNull,
        startedAt: null,
        finishedAt: null,
      },
    }),
    prisma.intakeRun.update({
      where: { id: runId },
      data: {
        status: "PENDING",
        error: null,
        warnings: [],
        finishedAt: null,
        // The run keeps its original requested sources; retries only fill holes.
      },
    }),
  ])

  return getIntakeRun(userId, runId)
}

export async function getIntakeRun(userId: string, runId: string) {
  const run = await prisma.intakeRun.findFirst({
    where: { id: runId, userId },
    include: INTAKE_RUN_INCLUDE,
  })
  if (!run) throw new IntakeRunError(404, "Intake run not found")
  return toIntakeRunDTO(run)
}

export async function listIntakeRuns(userId: string, limit = 10) {
  const runs = await prisma.intakeRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(50, limit)),
    include: INTAKE_RUN_INCLUDE,
  })
  return runs.map(toIntakeRunDTO)
}

/** Guarded so a completed source can never be silently re-executed. */
export function isTerminalSourceStatus(status: string): boolean {
  return TERMINAL_SOURCE_STATUSES.includes(status as IntakeSourceStatus)
}
