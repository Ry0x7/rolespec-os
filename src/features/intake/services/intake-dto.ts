import { parsePatchData, parseProvenance } from "../schemas/intake.schema"
import type {
  IntakeConflictResolution,
  IntakePatchKind,
  IntakeRunDTO,
  IntakeSource,
  IntakeSourceStatus,
} from "../types"

type SourceRow = {
  id: string
  source: string
  status: string
  progress: number
  message: string | null
  error: string | null
  startedAt: Date | null
  finishedAt: Date | null
}

type ConflictRow = {
  id: string
  existingType: string
  existingId: string | null
  field: string | null
  incoming: unknown
  existing: unknown
  status: string
  resolution: IntakeConflictResolution | null
}

type PatchRow = {
  id: string
  kind: string
  source: string
  status: string
  confidence: number
  payload: unknown
  provenance: unknown
  rejectionReason: string | null
  appliedTargetType: string | null
  appliedTargetId: string | null
  correctedAt: Date | null
  conflict: ConflictRow | null
}

export type RunRow = {
  id: string
  status: string
  requestedSources: string[]
  error: string | null
  warnings: unknown
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  sources: SourceRow[]
  patches: PatchRow[]
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

/**
 * The API and UI both read this shape. Payloads were validated before insert;
 * parsing again here means a malformed historical row fails loudly rather than
 * being rendered as `undefined`.
 */
export function toIntakeRunDTO(run: RunRow): IntakeRunDTO {
  const warnings = Array.isArray(run.warnings)
    ? run.warnings.filter((item): item is string => typeof item === "string")
    : []

  const patches = run.patches.map((patch) => ({
    id: patch.id,
    kind: patch.kind as IntakePatchKind,
    source: patch.source as IntakeSource,
    status: patch.status as "PENDING" | "APPLIED" | "CONFLICT" | "REJECTED",
    confidence: patch.confidence,
    data: parsePatchData(patch.kind as IntakePatchKind, patch.payload),
    provenance: parseProvenance(patch.provenance),
    rejectionReason: patch.rejectionReason,
    appliedTargetType: patch.appliedTargetType,
    appliedTargetId: patch.appliedTargetId,
    correctedAt: iso(patch.correctedAt),
    conflict: patch.conflict
      ? {
          id: patch.conflict.id,
          existingType: patch.conflict.existingType,
          existingId: patch.conflict.existingId,
          field: patch.conflict.field,
          incoming: patch.conflict.incoming,
          existing: patch.conflict.existing,
          status: patch.conflict.status as "OPEN" | "RESOLVED" | "DISMISSED",
          resolution: patch.conflict.resolution,
        }
      : null,
  }))

  return {
    id: run.id,
    status: run.status as IntakeRunDTO["status"],
    requestedSources: run.requestedSources as IntakeSource[],
    error: run.error,
    warnings,
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    createdAt: run.createdAt.toISOString(),
    sources: run.sources.map((source) => ({
      id: source.id,
      source: source.source as IntakeSource,
      status: source.status as IntakeSourceStatus,
      progress: source.progress,
      message: source.message,
      error: source.error,
      startedAt: iso(source.startedAt),
      finishedAt: iso(source.finishedAt),
    })),
    patches,
    counts: {
      pending: patches.filter((patch) => patch.status === "PENDING").length,
      applied: patches.filter((patch) => patch.status === "APPLIED").length,
      conflicts: patches.filter((patch) => patch.status === "CONFLICT").length,
      rejected: patches.filter((patch) => patch.status === "REJECTED").length,
    },
  }
}

export const INTAKE_RUN_INCLUDE = {
  sources: { orderBy: { source: "asc" as const } },
  patches: {
    orderBy: { createdAt: "asc" as const },
    include: { conflict: true },
  },
}
