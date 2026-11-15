import { CareerEvidenceSource, CareerEvidenceStatus } from "@/generated/prisma/enums"
import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/shared/lib/prisma"
import { getOrCreateCareerProfileId } from "@/features/career-profile/services/career-profile.service"
import {
  fingerprintFor,
  contactValuesMatch,
  normalizeLabel,
  skillKey,
} from "../lib/patch-fingerprint"
import { parsePatchData, parseProvenance } from "../schemas/intake.schema"
import type {
  ContactField,
  ContactPatchData,
  EvidencePatchData,
  IntakeConflictDTO,
  IntakeConflictResolution,
  IntakePatchData,
  IntakePatchKind,
  IntakeSource,
  SkillPatchData,
  TargetRolePatchData,
} from "../types"

export class IntakeApplyError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message)
    this.name = "IntakeApplyError"
  }
}

export interface ApplyIntakePatchResult {
  status: "APPLIED" | "CONFLICT" | "REJECTED"
  patchId: string
  appliedTargetType: string | null
  appliedTargetId: string | null
  conflict: IntakeConflictDTO | null
  message: string
}

const EVIDENCE_SOURCE_BY_INTAKE: Record<IntakeSource, CareerEvidenceSource> = {
  RESUME: CareerEvidenceSource.RESUME_IMPORT_CANDIDATE,
  LINKEDIN: CareerEvidenceSource.LINKEDIN_IMPORT_CANDIDATE,
  GITHUB: CareerEvidenceSource.GITHUB_IMPORT_CANDIDATE,
  WEB: CareerEvidenceSource.PORTFOLIO_IMPORT_CANDIDATE,
  CHAT: CareerEvidenceSource.INTAKE_IMPORT_CANDIDATE,
  VOICE: CareerEvidenceSource.INTAKE_IMPORT_CANDIDATE,
}

const CONTACT_SELECT = {
  contactFullName: true,
  contactEmail: true,
  contactPhone: true,
  contactLocation: true,
  linkedinUrl: true,
  githubUrl: true,
  websiteUrl: true,
} as const

function contactUpdate(field: ContactField, value: string) {
  switch (field) {
    case "contactFullName":
      return { contactFullName: value }
    case "contactEmail":
      return { contactEmail: value }
    case "contactPhone":
      return { contactPhone: value }
    case "contactLocation":
      return { contactLocation: value }
    case "linkedinUrl":
      return { linkedinUrl: value }
    case "githubUrl":
      return { githubUrl: value }
    case "websiteUrl":
      return { websiteUrl: value }
  }
}

function toDate(value: string | null): Date | null {
  if (!value) return null
  return new Date(`${value}T00:00:00.000Z`)
}

function provenanceMetadata(patch: {
  id: string
  runId: string
  source: IntakeSource
  confidence: number
  payload: unknown
  provenance: unknown
}) {
  const provenance = parseProvenance(patch.provenance)
  return {
    intakeRunId: patch.runId,
    intakePatchId: patch.id,
    intakeSource: patch.source,
    intakeConfidence: patch.confidence,
    sourceUrl: provenance.sourceUrl ?? null,
    fileName: provenance.fileName ?? null,
    externalId: provenance.externalId ?? null,
    fetchedAt: provenance.fetchedAt,
  }
}

function conflictDto(conflict: {
  id: string
  existingType: string
  existingId: string | null
  field: string | null
  incoming: unknown
  existing: unknown
  status: string
  resolution: IntakeConflictResolution | null
}): IntakeConflictDTO {
  return {
    id: conflict.id,
    existingType: conflict.existingType,
    existingId: conflict.existingId,
    field: conflict.field,
    incoming: conflict.incoming,
    existing: conflict.existing,
    status: conflict.status as IntakeConflictDTO["status"],
    resolution: conflict.resolution,
  }
}

async function findExistingEvidence(
  db: Prisma.TransactionClient,
  careerProfileId: string,
  data: EvidencePatchData
) {
  const rows = await db.careerEvidence.findMany({
    where: { careerProfileId, kind: data.evidenceKind },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      title: true,
      organization: true,
      details: true,
      outcome: true,
      startDate: true,
      endDate: true,
      status: true,
      metadata: true,
      source: true,
    },
  })
  const target = fingerprintFor("EVIDENCE", data)
  return (
    rows.find(
      (row) =>
        fingerprintFor("EVIDENCE", {
          evidenceKind: row.kind,
          title: row.title,
          organization: row.organization,
        }) === target
    ) ?? null
  )
}

async function findExistingSkill(
  db: Prisma.TransactionClient,
  careerProfileId: string,
  data: SkillPatchData
) {
  const rows = await db.careerCapability.findMany({
    where: { careerProfileId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, category: true, confirmed: true },
  })
  const target = skillKey(data.name)
  return rows.find((row) => skillKey(row.name) === target) ?? null
}

async function findExistingTargetRole(
  db: Prisma.TransactionClient,
  careerProfileId: string,
  data: TargetRolePatchData
) {
  const rows = await db.careerTargetRole.findMany({
    where: { careerProfileId },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, active: true, priority: true },
  })
  const target = normalizeLabel(data.title)
  return rows.find((row) => normalizeLabel(row.title) === target) ?? null
}

type ExistingCollision = {
  existingType: string
  existingId: string
  field: string | null
  incoming: unknown
  existing: unknown
}

/**
 * Finds the profile row this patch would touch, without writing anything.
 * Contact fields collide on the profile itself; other kinds collide on their
 * normalized identity inside the same profile.
 */
async function findCollision(
  db: Prisma.TransactionClient,
  careerProfileId: string,
  kind: IntakePatchKind,
  data: IntakePatchData
): Promise<ExistingCollision | null> {
  if (kind === "CONTACT") {
    const contact = data as ContactPatchData
    const profile = await db.careerProfile.findUnique({
      where: { id: careerProfileId },
      select: CONTACT_SELECT,
    })
    const existingValue = profile?.[contact.field] ?? null
    if (!existingValue) return null
    // The same value is not a conflict: applying it is an idempotent no-op.
    if (contactValuesMatch(contact.field, existingValue, contact.value)) return null
    return {
      existingType: "career_profile",
      existingId: careerProfileId,
      field: contact.field,
      incoming: { value: contact.value },
      existing: { value: existingValue },
    }
  }

  if (kind === "EVIDENCE") {
    const existing = await findExistingEvidence(db, careerProfileId, data as EvidencePatchData)
    if (!existing) return null
    return {
      existingType: "career_evidence",
      existingId: existing.id,
      field: null,
      incoming: data,
      existing: {
        title: existing.title,
        organization: existing.organization,
        details: existing.details,
        outcome: existing.outcome,
        startDate: existing.startDate?.toISOString().slice(0, 10) ?? null,
        endDate: existing.endDate?.toISOString().slice(0, 10) ?? null,
        status: existing.status,
      },
    }
  }

  if (kind === "SKILL") {
    const existing = await findExistingSkill(db, careerProfileId, data as SkillPatchData)
    if (!existing) return null
    return {
      existingType: "career_capability",
      existingId: existing.id,
      field: "name",
      incoming: data,
      existing,
    }
  }

  const existing = await findExistingTargetRole(
    db,
    careerProfileId,
    data as TargetRolePatchData
  )
  if (!existing) return null
  return {
    existingType: "career_target_role",
    existingId: existing.id,
    field: "title",
    incoming: data,
    existing,
  }
}

async function recordConflict(
  db: Prisma.TransactionClient,
  patchId: string,
  runId: string,
  collision: ExistingCollision
) {
  const conflict = await db.intakeConflict.upsert({
      where: { patchId },
      create: {
        patchId,
        runId,
        existingType: collision.existingType,
        existingId: collision.existingId,
        field: collision.field,
        incoming: collision.incoming as object,
        existing: collision.existing as object,
        status: "OPEN",
      },
      update: {
        existingType: collision.existingType,
        existingId: collision.existingId,
        field: collision.field,
        incoming: collision.incoming as object,
        existing: collision.existing as object,
        status: "OPEN",
        resolution: null,
        resolvedAt: null,
      },
    })
  await db.intakePatch.update({
    where: { id: patchId },
    data: { status: "CONFLICT", rejectionReason: null },
  })
  return conflict
}

async function resolveConflict(
  db: Prisma.TransactionClient,
  patchId: string,
  resolution: IntakeConflictResolution
) {
  await db.intakeConflict.updateMany({
    where: { patchId, status: "OPEN" },
    data: { status: "RESOLVED", resolution, resolvedAt: new Date() },
  })
}

async function markApplied(
  db: Prisma.TransactionClient,
  patchId: string,
  targetType: string,
  targetId: string,
  resolution?: IntakeConflictResolution
) {
  await db.intakePatch.update({
    where: { id: patchId },
    data: {
      status: "APPLIED",
      appliedTargetType: targetType,
      appliedTargetId: targetId,
      rejectionReason: null,
      correctedAt: null,
    },
  })
  if (resolution) await resolveConflict(db, patchId, resolution)
}

async function markRejected(
  db: Prisma.TransactionClient,
  patchId: string,
  reason: string,
  resolution?: IntakeConflictResolution
) {
  await db.intakePatch.update({
    where: { id: patchId },
    data: { status: "REJECTED", rejectionReason: reason },
  })
  if (resolution) await resolveConflict(db, patchId, resolution)
}

/**
 * Applies one patch. Every write is an explicit user action; a collision without
 * a disposition returns a review task instead of overwriting the profile.
 */
export async function applyIntakePatch(
  userId: string,
  patchId: string,
  disposition?: IntakeConflictResolution
): Promise<ApplyIntakePatchResult> {
  const owned = await prisma.intakePatch.findFirst({
    where: { id: patchId, run: { userId } },
    select: { id: true },
  })
  if (!owned) throw new IntakeApplyError(404, "Intake fact not found")

  // The profile is created before the transaction because it is a per-user
  // container, not a fact this patch owns. Both rows are then locked in a fixed
  // order so concurrent applies cannot read the same collision and double-write.
  const careerProfileId = await getOrCreateCareerProfileId(userId)

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "intake_patches" WHERE id = ${patchId} FOR UPDATE`
    const patch = await tx.intakePatch.findFirst({
      where: { id: patchId, run: { userId } },
      include: { conflict: true },
    })
    if (!patch) throw new IntakeApplyError(404, "Intake fact not found")

    if (patch.status === "APPLIED") {
      return {
        status: "APPLIED" as const,
        patchId: patch.id,
        appliedTargetType: patch.appliedTargetType,
        appliedTargetId: patch.appliedTargetId,
        conflict: patch.conflict ? conflictDto(patch.conflict) : null,
        message: "This fact is already in the profile.",
      }
    }

    await tx.$queryRaw`SELECT id FROM "career_profiles" WHERE id = ${careerProfileId} FOR UPDATE`
    const data = parsePatchData(patch.kind, patch.payload)
    const collision = await findCollision(tx, careerProfileId, patch.kind, data)

    if (collision && !disposition) {
      const conflict = await recordConflict(tx, patch.id, patch.runId, collision)
      return {
        status: "CONFLICT" as const,
        patchId: patch.id,
        appliedTargetType: null,
        appliedTargetId: null,
        conflict: conflictDto(conflict),
        message:
          "This fact already exists with different details. Choose which version to keep.",
      }
    }

    if (collision && disposition === "KEEP_EXISTING") {
      await markRejected(
        tx,
        patch.id,
        "Kept the existing profile value; the imported version was not added.",
        "KEEP_EXISTING"
      )
      return {
        status: "REJECTED" as const,
        patchId: patch.id,
        appliedTargetType: null,
        appliedTargetId: null,
        conflict: null,
        message: "Kept the existing profile value.",
      }
    }

    if (collision && disposition === "KEEP_BOTH" && patch.kind !== "EVIDENCE") {
      throw new IntakeApplyError(
        409,
        patch.kind === "CONTACT"
          ? "A contact field can hold only one value. Accept one version or correct the import."
          : "This kind of fact must be unique. Accept one version instead of keeping both."
      )
    }

    if (patch.kind === "CONTACT") {
      const contact = data as ContactPatchData
      if (!collision || disposition === "ACCEPT_INCOMING") {
        await tx.careerProfile.update({
          where: { id: careerProfileId },
          data: contactUpdate(contact.field, contact.value),
        })
      }
      await markApplied(
        tx,
        patch.id,
        "career_profile",
        careerProfileId,
        disposition ?? undefined
      )
      return {
        status: "APPLIED" as const,
        patchId: patch.id,
        appliedTargetType: "career_profile",
        appliedTargetId: careerProfileId,
        conflict: null,
        message: `${contact.field} updated from ${patch.source.toLowerCase()} intake.`,
      }
    }

    if (patch.kind === "EVIDENCE") {
      const evidence = data as EvidencePatchData
      const metadata = provenanceMetadata(patch)
      let targetId: string

      if (collision && disposition === "ACCEPT_INCOMING") {
        const existing = await tx.careerEvidence.findFirst({
          where: { id: collision.existingId, careerProfileId },
          select: { id: true, status: true, metadata: true },
        })
        if (!existing) throw new IntakeApplyError(404, "Existing evidence no longer exists")
        if (existing.status === CareerEvidenceStatus.CONFIRMED) {
          throw new IntakeApplyError(
            409,
            "That evidence is already confirmed. Keep both versions, or edit the confirmed row directly."
          )
        }
        await tx.careerEvidence.update({
          where: { id: existing.id },
          data: {
            title: evidence.title,
            organization: evidence.organization,
            details: evidence.details,
            outcome: evidence.outcome,
            startDate: toDate(evidence.startDate),
            endDate: toDate(evidence.endDate),
            metadata: {
              ...(existing.metadata && typeof existing.metadata === "object"
                ? (existing.metadata as Record<string, unknown>)
                : {}),
              ...metadata,
            },
          },
        })
        targetId = existing.id
      } else {
        const created = await tx.careerEvidence.create({
          data: {
            careerProfileId,
            kind: evidence.evidenceKind,
            source: EVIDENCE_SOURCE_BY_INTAKE[patch.source],
            status: CareerEvidenceStatus.CANDIDATE,
            title: evidence.title,
            organization: evidence.organization,
            details: evidence.details,
            outcome: evidence.outcome,
            startDate: toDate(evidence.startDate),
            endDate: toDate(evidence.endDate),
            metadata,
          },
          select: { id: true },
        })
        targetId = created.id
      }

      await markApplied(
        tx,
        patch.id,
        "career_evidence",
        targetId,
        disposition ?? undefined
      )
      return {
        status: "APPLIED" as const,
        patchId: patch.id,
        appliedTargetType: "career_evidence",
        appliedTargetId: targetId,
        conflict: null,
        message:
          "Added as candidate evidence. Confirm it on the profile before it counts as verified.",
      }
    }

    if (patch.kind === "SKILL") {
      const skill = data as SkillPatchData
      let targetId: string
      if (collision && disposition === "ACCEPT_INCOMING") {
        const existing = await tx.careerCapability.findFirst({
          where: { id: collision.existingId, careerProfileId },
          select: { id: true, category: true },
        })
        if (!existing) throw new IntakeApplyError(404, "Existing skill no longer exists")
        if (!existing.category && skill.category) {
          await tx.careerCapability.update({
            where: { id: existing.id },
            data: { category: skill.category },
          })
        }
        targetId = existing.id
      } else {
        const created = await tx.careerCapability.create({
          data: {
            careerProfileId,
            name: skill.name,
            category: skill.category,
            confirmed: false,
          },
          select: { id: true },
        })
        targetId = created.id
      }
      await markApplied(
        tx,
        patch.id,
        "career_capability",
        targetId,
        disposition ?? undefined
      )
      return {
        status: "APPLIED" as const,
        patchId: patch.id,
        appliedTargetType: "career_capability",
        appliedTargetId: targetId,
        conflict: null,
        message: "Skill added as unconfirmed. Confirm it on the profile when ready.",
      }
    }

    const role = data as TargetRolePatchData
    let targetId: string
    if (collision && disposition === "ACCEPT_INCOMING") {
      const existing = await tx.careerTargetRole.findFirst({
        where: { id: collision.existingId, careerProfileId },
        select: { id: true, active: true },
      })
      if (!existing) throw new IntakeApplyError(404, "Existing target role no longer exists")
      if (!existing.active) {
        await tx.careerTargetRole.update({
          where: { id: existing.id },
          data: { active: true },
        })
      }
      targetId = existing.id
    } else {
      const created = await tx.careerTargetRole.create({
        data: { careerProfileId, title: role.title, active: true, priority: 0 },
        select: { id: true },
      })
      targetId = created.id
    }
    await markApplied(
      tx,
      patch.id,
      "career_target_role",
      targetId,
      disposition ?? undefined
    )
    return {
      status: "APPLIED" as const,
      patchId: patch.id,
      appliedTargetType: "career_target_role",
      appliedTargetId: targetId,
      conflict: null,
      message: "Target role added to the profile.",
    }
  })
}

export async function rejectIntakePatch(
  userId: string,
  patchId: string,
  reason?: string
) {
  const patch = await prisma.intakePatch.findFirst({
    where: { id: patchId, run: { userId } },
    select: { id: true, status: true },
  })
  if (!patch) throw new IntakeApplyError(404, "Intake fact not found")
  if (patch.status === "APPLIED") {
    throw new IntakeApplyError(
      409,
      "This fact is already in the profile. Edit the profile to change it."
    )
  }
  await prisma.$transaction(async (tx) => {
    await tx.intakePatch.update({
      where: { id: patch.id },
      data: {
        status: "REJECTED",
        rejectionReason: reason?.trim() || "Rejected during review.",
      },
    })
    await resolveConflict(tx, patch.id, "KEEP_EXISTING")
  })
  return { status: "REJECTED" as const, patchId: patch.id }
}

/**
 * Corrects an imported fact before or after applying it. The correction is
 * recorded as a user-authored edit; it never silently confirms evidence.
 */
export async function correctIntakePatch(
  userId: string,
  patchId: string,
  correction: { kind: IntakePatchKind; data: IntakePatchData },
  note?: string
) {
  const patch = await prisma.intakePatch.findFirst({
    where: { id: patchId, run: { userId } },
    select: {
      id: true,
      kind: true,
      payload: true,
      status: true,
      appliedTargetType: true,
      appliedTargetId: true,
      runId: true,
      source: true,
    },
  })
  if (!patch) throw new IntakeApplyError(404, "Intake fact not found")
  if (patch.kind !== correction.kind) {
    throw new IntakeApplyError(400, "The correction does not match this fact's kind")
  }

  const parsed = parsePatchData(correction.kind, correction.data)
  // A contact correction may edit the value, never silently retarget the patch
  // at a different profile column (which would leave the old value behind).
  if (patch.kind === "CONTACT") {
    const previous = parsePatchData("CONTACT", patch.payload) as ContactPatchData
    if ((parsed as ContactPatchData).field !== previous.field) {
      throw new IntakeApplyError(
        400,
        "A correction cannot change which contact field this fact belongs to."
      )
    }
  }
  const careerProfileId = await getOrCreateCareerProfileId(userId)
  const fingerprint = fingerprintFor(correction.kind, parsed)

  if (patch.status === "APPLIED" && patch.appliedTargetType && patch.appliedTargetId) {
    if (patch.appliedTargetType === "career_profile" && correction.kind === "CONTACT") {
      const contact = parsed as ContactPatchData
      await prisma.careerProfile.update({
        where: { id: careerProfileId },
        data: contactUpdate(contact.field, contact.value),
      })
    } else if (patch.appliedTargetType === "career_evidence" && correction.kind === "EVIDENCE") {
      const evidence = parsed as EvidencePatchData
      const existing = await prisma.careerEvidence.findFirst({
        where: { id: patch.appliedTargetId, careerProfileId },
        select: { id: true },
      })
      if (!existing) throw new IntakeApplyError(404, "Applied evidence no longer exists")
      await prisma.careerEvidence.update({
        where: { id: existing.id },
        data: {
          title: evidence.title,
          organization: evidence.organization,
          details: evidence.details,
          outcome: evidence.outcome,
          startDate: toDate(evidence.startDate),
          endDate: toDate(evidence.endDate),
        },
      })
    } else if (patch.appliedTargetType === "career_capability" && correction.kind === "SKILL") {
      const skill = parsed as SkillPatchData
      const existing = await prisma.careerCapability.findFirst({
        where: { id: patch.appliedTargetId, careerProfileId },
        select: { id: true },
      })
      if (!existing) throw new IntakeApplyError(404, "Applied skill no longer exists")
      try {
        await prisma.careerCapability.update({
          where: { id: existing.id },
          data: { name: skill.name, category: skill.category },
        })
      } catch {
        throw new IntakeApplyError(409, "A skill with that name already exists")
      }
    } else if (patch.appliedTargetType === "career_target_role" && correction.kind === "TARGET_ROLE") {
      const role = parsed as TargetRolePatchData
      const existing = await prisma.careerTargetRole.findFirst({
        where: { id: patch.appliedTargetId, careerProfileId },
        select: { id: true },
      })
      if (!existing) throw new IntakeApplyError(404, "Applied target role no longer exists")
      try {
        await prisma.careerTargetRole.update({
          where: { id: existing.id },
          data: { title: role.title },
        })
      } catch {
        throw new IntakeApplyError(409, "A target role with that title already exists")
      }
    }
  }

  await prisma.$transaction([
    prisma.intakeCorrection.create({
      data: {
        patchId: patch.id,
        previousPayload: patch.payload as object,
        correctedPayload: parsed as object,
        note: note?.trim() || null,
      },
    }),
    prisma.intakePatch.update({
      where: { id: patch.id },
      data: {
        payload: parsed as object,
        fingerprint,
        correctedAt: new Date(),
        ...(patch.status === "CONFLICT"
          ? { status: "PENDING" as const, rejectionReason: null }
          : {}),
      },
    }),
    ...(patch.status === "CONFLICT"
      ? [
          prisma.intakeConflict.updateMany({
            where: { patchId: patch.id, status: "OPEN" },
            data: { status: "DISMISSED", resolvedAt: new Date() },
          }),
        ]
      : []),
  ])

  return {
    status: patch.status === "APPLIED" ? ("APPLIED" as const) : ("PENDING" as const),
    patchId: patch.id,
  }
}
