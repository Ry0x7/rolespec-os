import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { groundKeywords } from "@/shared/lib/evidence-grounding"
import { logger, redactText } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { SectionType, Template } from "@/generated/prisma/enums"
import { extractJobTerms } from "../lib/job-terms"
import { serializeSections } from "../lib/serialize-sections"
import type { Section } from "../hooks/use-resume-store"
import {
  generateJobTailorSuggestions,
  type JobTailorSuggestions,
} from "../services/tailor-resume"
import { applyTailoringSuggestions } from "./apply-suggestions"
import { validateTailoredResume } from "./claim-validator"
import {
  mapRequirements,
  profileEvidenceAtoms,
  resumeEvidenceAtoms,
  serializeEvidence,
} from "./evidence-map"
import {
  buildSourceSnapshot,
  hashSourceSnapshot,
  parseSourceSnapshot,
} from "./snapshot"
import { buildTailorTargets } from "./targets"
import type {
  RequirementEvidence,
  ResumeSectionSnapshot,
  TailoringResult,
  TailoringValidationReport,
} from "./types"

const log = logger("resume/tailoring")

/** Initial generation plus at most two bounded repair passes. */
export const MAX_TAILORING_GENERATIONS = 3

const MAX_TITLE_LENGTH = 200

interface TailoringSource {
  id: string
  version: number
  title: string
  template: string
  targetRole: string | null
  targetCompany: string | null
  careerProfileId: string | null
  roleFamilyId: string | null
  sections: ResumeSectionSnapshot[]
}

export interface TailoringServiceInput {
  userId: string
  jobApplicationId: string
  /** Explicit source; otherwise the application's chosen resume, then master. */
  sourceResumeId?: string
  title?: string
  mode?: "MANUAL" | "WORKFLOW"
  /** Cancels provider work and prevents persistence after a step timeout. */
  signal?: AbortSignal
}

export type TailoringServiceOutcome =
  | { ok: true; result: TailoringResult }
  | {
      ok: false
      reason:
        | "NO_APPLICATION"
        | "NO_RESUME"
        | "NO_CONTENT"
        | "NO_CHANGES"
        | "VALIDATION_FAILED"
        | "PROVIDER_CONFIGURATION"
        | "PROVIDER_FAILURE"
        | "PERSISTENCE_FAILED"
      message: string
      runId?: string
      retryable?: boolean
      validation?: TailoringValidationReport
    }

function resumeSelect() {
  return {
    id: true,
    version: true,
    title: true,
    template: true,
    targetRole: true,
    targetCompany: true,
    careerProfileId: true,
    roleFamilyId: true,
    sections: {
      select: {
        id: true,
        type: true,
        title: true,
        order: true,
        visible: true,
        items: {
          select: { id: true, content: true, metadata: true, order: true },
          orderBy: { order: "asc" as const },
        },
      },
      orderBy: { order: "asc" as const },
    },
  }
}

function asSnapshotRows(
  rows: Array<{
    id?: string
    type: string
    title: string
    order: number
    visible: boolean
    items: Array<{
      id?: string
      content: unknown
      metadata?: unknown
      order: number
    }>
  }>
): ResumeSectionSnapshot[] {
  return rows.map((section) => ({
    id: section.id,
    type: section.type,
    title: section.title,
    order: section.order,
    visible: section.visible,
    items: section.items.map((item) => ({
      id: item.id,
      content:
        item.content && typeof item.content === "object" && !Array.isArray(item.content)
          ? (item.content as Record<string, unknown>)
          : {},
      ...(item.metadata === undefined ? {} : { metadata: item.metadata }),
      order: item.order,
    })),
  }))
}

async function loadSource(
  userId: string,
  applicationResumeId: string | null,
  explicitResumeId?: string
): Promise<TailoringSource | null> {
  const wanted = explicitResumeId ?? applicationResumeId
  if (wanted) {
    const chosen = await prisma.resume.findFirst({
      where: {
        id: wanted,
        userId,
        // Never tailor a tailored copy into another tailored copy: that would
        // hide the real source and make provenance a chain of drafts.
        variant: { in: ["MASTER", "ROLE_FAMILY"] },
        status: { not: "ARCHIVED" },
      },
      select: resumeSelect(),
    })
    if (chosen) return chosen as unknown as TailoringSource
  }
  const master = await prisma.resume.findFirst({
    where: { userId, variant: "MASTER", status: { not: "ARCHIVED" } },
    select: resumeSelect(),
    orderBy: { updatedAt: "desc" },
  })
  return (master as unknown as TailoringSource | null) ?? null
}

function validationMessage(report: TailoringValidationReport): string {
  const first = report.issues.find((issue) => issue.severity === "error") ?? report.issues[0]
  return first
    ? `${first.code}: ${first.message}`
    : "The generated resume failed deterministic validation."
}

function providerKind(error: unknown): "configuration" | "transient" {
  return error instanceof AiKeyRequiredError || error instanceof AiDailyLimitError
    ? "configuration"
    : "transient"
}

function safeError(error: unknown): string {
  if (error instanceof Error) {
    return redactText(error.message.split("\n")[0] || "The provider call failed.", 300)
  }
  return "The provider call failed."
}

/**
 * Produces one evidence-grounded tailored resume for a tracked application.
 *
 * The generated resume is always DRAFT: this service never selects it for the
 * application, never submits anything and never edits the source. Every
 * rewrite is checked against the source snapshot before persistence; a run that
 * cannot produce a claim-clean draft creates no resume at all and returns the
 * validation report for an explicit human-review fallback.
 */
export async function tailorResumeForApplication(
  input: TailoringServiceInput
): Promise<TailoringServiceOutcome> {
  // A step that was already aborted must not create a run or a draft. The
  // worker has committed its timeout independently, so no local side effect is
  // useful here.
  if (input.signal?.aborted) {
    return {
      ok: false,
      reason: "PROVIDER_FAILURE",
      message: "The tailoring step was cancelled.",
      retryable: false,
    }
  }

  const application = await prisma.jobApplication.findFirst({
    where: { id: input.jobApplicationId, userId: input.userId },
    select: {
      id: true,
      resumeId: true,
      job: {
        select: {
          title: true,
          companyName: true,
          description: true,
        },
      },
    },
  })
  if (!application) {
    return {
      ok: false,
      reason: "NO_APPLICATION",
      message: "That job application does not exist.",
    }
  }

  const source = await loadSource(
    input.userId,
    application.resumeId,
    input.sourceResumeId
  )
  if (!source) {
    return {
      ok: false,
      reason: "NO_RESUME",
      message:
        "No resume is selected for this application and no master resume exists.",
    }
  }

  const sourceSections = asSnapshotRows(source.sections)
  const targets = buildTailorTargets(sourceSections)
  const hasContent = sourceSections.some((section) =>
    section.items.some((item) => Object.keys(item.content ?? {}).length > 0)
  )
  if (targets.length === 0) {
    return {
      ok: false,
      reason: "NO_CONTENT",
      message: hasContent
        ? "This resume has no structured summary, skills, experience or project text to tailor."
        : "This resume has no content to tailor.",
    }
  }

  const capturedAt = new Date()
  const snapshot = buildSourceSnapshot(source, capturedAt)
  const snapshotHash = hashSourceSnapshot(snapshot)

  const profile = source.careerProfileId
    ? await prisma.careerProfile.findFirst({
        where: { id: source.careerProfileId, userId: input.userId },
        select: {
          id: true,
          evidence: {
            where: { status: "CONFIRMED" },
            select: {
              id: true,
              kind: true,
              title: true,
              organization: true,
              details: true,
              outcome: true,
              status: true,
            },
          },
        },
      })
    : null

  const resumeAtoms = resumeEvidenceAtoms(sourceSections)
  const profileAtoms = profile
    ? profileEvidenceAtoms(profile.evidence, profile.id)
    : []
  const requirements: RequirementEvidence[] = mapRequirements({
    jobTitle: application.job.title,
    jobDescription: application.job.description,
    atoms: [...resumeAtoms, ...profileAtoms],
  })

  let run: { id: string }
  try {
    run = await prisma.resumeTailoringRun.create({
      data: {
        userId: input.userId,
        sourceResumeId: source.id,
        jobApplicationId: application.id,
        status: "RUNNING",
        mode: input.mode ?? "WORKFLOW",
        attempts: 0,
        sourceVersion: snapshot.sourceVersion,
        snapshotHash,
        requirementMap: requirements as unknown as Prisma.InputJsonValue,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    })
  } catch (error) {
    log.error("Could not record the tailoring run", { error })
    return {
      ok: false,
      reason: "PERSISTENCE_FAILED",
      message: "The tailoring run could not be recorded. Please try again.",
      retryable: true,
    }
  }

  const resumeText = serializeSections(sourceSections as unknown as Section[])
  const evidenceText = [
    resumeText,
    ...targets.map((target) => target.text),
  ].join("\n")
  const terms = [
    ...new Set([
      ...extractJobTerms(application.job.title, { minLength: 2 }),
      ...extractJobTerms(application.job.description ?? ""),
    ]),
  ]
  const grounded = groundKeywords(terms, evidenceText)
  const barredKeywords = [...grounded.unsupported, ...grounded.ambiguous]
  const needsSummary = !targets.some((target) => target.field === "summary")

  let attempts = 0
  let best:
    | {
        sections: ResumeSectionSnapshot[]
        report: TailoringValidationReport
        rejected: ReturnType<typeof applyTailoringSuggestions>["rejected"]
        appliedCount: number
      }
    | null = null
  let repairIssues: string[] = []
  let repairRejected: string[] = []

  try {
    for (let generation = 1; generation <= MAX_TAILORING_GENERATIONS; generation += 1) {
      input.signal?.throwIfAborted()
      attempts = generation
      const generated: JobTailorSuggestions = await generateJobTailorSuggestions({
        userId: input.userId,
        targets,
        jobTitle: application.job.title,
        companyName: application.job.companyName,
        jobDescription: application.job.description ?? undefined,
        targetRole: source.targetRole ?? undefined,
        groundedKeywords: grounded,
        needsSummary,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(generation > 1
          ? {
              repair: {
                attempt: generation - 1,
                issues: repairIssues,
                rejected: repairRejected,
              },
            }
          : {}),
      })
      input.signal?.throwIfAborted()

      const applied = applyTailoringSuggestions({
        sections: sourceSections,
        targets,
        suggestions: generated.suggestions,
        generatedSummary: generated.generatedSummary,
        needsSummary,
        barredKeywords,
        evidenceText,
      })

      if (!applied.changed) {
        // A rejected suggestion is a repair signal, not "nothing to do": the
        // model claimed something the source cannot back, so ask it again with
        // the exact rejection. Only a genuinely empty response ends the loop.
        if (applied.rejected.length > 0 && generation < MAX_TAILORING_GENERATIONS) {
          repairRejected = applied.rejected
            .slice(0, 12)
            .map((rejection) => `${rejection.targetId}: ${rejection.reason}`)
          repairIssues = repairRejected.map((rejection) => `GROUNDING: ${rejection}`)
          continue
        }
        best = best ?? {
          sections: applied.sections,
          report: validateTailoredResume({
            source: sourceSections,
            tailored: applied.sections,
            requirements,
            sourceHash: snapshotHash,
            now: capturedAt,
          }),
          rejected: applied.rejected,
          appliedCount: 0,
        }
        break
      }

      const report = validateTailoredResume({
        source: sourceSections,
        tailored: applied.sections,
        requirements,
        sourceHash: snapshotHash,
        now: capturedAt,
      })

      if (!best || report.issues.filter((i) => i.severity === "error").length <
          best.report.issues.filter((i) => i.severity === "error").length) {
        best = {
          sections: applied.sections,
          report,
          rejected: applied.rejected,
          appliedCount: applied.appliedCount,
        }
      }

      if (report.status !== "FAIL") break

      repairIssues = report.issues
        .filter((issue) => issue.severity === "error")
        .slice(0, 12)
        .map((issue) => `${issue.code}: ${issue.message}`)
      repairRejected = applied.rejected
        .slice(0, 12)
        .map((rejection) => `${rejection.targetId}: ${rejection.reason}`)
    }
  } catch (error) {
    const kind = providerKind(error)
    const message =
      error instanceof AiKeyRequiredError || error instanceof AiDailyLimitError
        ? error.message
        : "AI tailoring failed. Please try again."
    await prisma.resumeTailoringRun
      .update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          attempts,
          finishedAt: new Date(),
          lastError: safeError(error),
        },
      })
      .catch(() => undefined)
    return {
      ok: false,
      reason: kind === "configuration" ? "PROVIDER_CONFIGURATION" : "PROVIDER_FAILURE",
      message,
      runId: run.id,
      retryable: kind !== "configuration",
    }
  }

  if (!best) {
    await prisma.resumeTailoringRun
      .update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          attempts,
          finishedAt: new Date(),
          lastError: "No generation was produced.",
        },
      })
      .catch(() => undefined)
    return {
      ok: false,
      reason: "PROVIDER_FAILURE",
      message: "AI tailoring produced no usable output. Please try again.",
      runId: run.id,
      retryable: true,
    }
  }

  if (best.appliedCount === 0 && best.report.claims.length === 0) {
    await prisma.resumeTailoringRun
      .update({
        where: { id: run.id },
        data: {
          status: "NEEDS_REVIEW",
          attempts,
          finishedAt: new Date(),
          lastError:
            "No supportable changes were found for this posting. The source resume was left unchanged.",
          validation: best.report as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined)
    return {
      ok: false,
      reason: "NO_CHANGES",
      message:
        "No supportable changes were found for this posting. Your source resume was left unchanged; add concrete achievements or tailor it manually.",
      runId: run.id,
      validation: best.report,
    }
  }

  if (best.report.status === "FAIL") {
    await prisma.resumeTailoringRun
      .update({
        where: { id: run.id },
        data: {
          status: "NEEDS_REVIEW",
          attempts,
          finishedAt: new Date(),
          lastError: validationMessage(best.report),
          validation: best.report as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined)
    return {
      ok: false,
      reason: "VALIDATION_FAILED",
      message: `The generated resume could not be made evidence-safe after ${attempts} bounded attempt${attempts === 1 ? "" : "s"}. ${validationMessage(best.report)}`,
      runId: run.id,
      validation: best.report,
    }
  }

  // This is the last safe cancellation point: once the transaction starts, a
  // committed draft is preferable to a half-written resume. Mark the run as
  // cancelled rather than leaving it RUNNING after the worker timed out.
  if (input.signal?.aborted) {
    await prisma.resumeTailoringRun
      .update({
        where: { id: run.id },
        data: { status: "CANCELLED", attempts, finishedAt: new Date(), lastError: "The step was cancelled." },
      })
      .catch(() => undefined)
    return {
      ok: false,
      reason: "PROVIDER_FAILURE",
      message: "The tailoring step was cancelled.",
      runId: run.id,
      retryable: false,
    }
  }

  const title = (input.title?.trim() || `${application.job.title} — ${source.title}`).slice(
    0,
    MAX_TITLE_LENGTH
  )
  const runStatus = best.report.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "COMPLETED"

  try {
    const created = await prisma.$transaction(async (tx) => {
      input.signal?.throwIfAborted()
      const resume = await tx.resume.create({
        data: {
          userId: input.userId,
          careerProfileId: source.careerProfileId,
          roleFamilyId: source.roleFamilyId,
          jobApplicationId: application.id,
          sourceResumeId: source.id,
          variant: "JOB_TAILORED",
          status: "DRAFT",
          title,
          targetRole: source.targetRole,
          targetCompany: application.job.companyName,
          template: source.template as Template,
          sections: {
            create: best.sections.map((section) => ({
              type: section.type as SectionType,
              title: section.title,
              order: section.order,
              visible: section.visible,
              items: {
                create: section.items.map((item) => ({
                  content: item.content as Prisma.InputJsonValue,
                  ...(item.metadata === undefined || item.metadata === null
                    ? {}
                    : { metadata: item.metadata as Prisma.InputJsonValue }),
                  order: item.order,
                })),
              },
            })),
          },
        },
        select: { id: true, version: true },
      })

      const snapshotRow = await tx.resumeSnapshot.create({
        data: {
          resumeId: resume.id,
          userId: input.userId,
          sourceResumeId: source.id,
          sourceVersion: snapshot.sourceVersion,
          hash: snapshotHash,
          payload: snapshot as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      })

      const validationRow = await tx.resumeValidation.create({
        data: {
          resumeId: resume.id,
          userId: input.userId,
          tailoringRunId: run.id,
          status: best.report.status,
          sourceHash: snapshotHash,
          report: best.report as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      })

      await tx.resumeEditEvent.create({
        data: {
          resumeId: resume.id,
          userId: input.userId,
          kind: "TAILORING_APPLIED",
          versionBefore: resume.version,
          versionAfter: resume.version,
          summary:
            best.report.status === "PASS"
              ? `Tailored for ${application.job.title} at ${application.job.companyName}`
              : `Tailored for ${application.job.title} — validation needs review`,
          metadata: {
            tailoringRunId: run.id,
            snapshotId: snapshotRow.id,
            validationId: validationRow.id,
            claims: best.report.claims.length,
            issues: best.report.issues.length,
            mode: input.mode ?? "WORKFLOW",
          } as Prisma.InputJsonValue,
        },
      })

      await tx.resumeTailoringRun.update({
        where: { id: run.id },
        data: {
          resumeId: resume.id,
          status: runStatus,
          attempts,
          validation: best.report as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
          ...(best.report.status === "NEEDS_REVIEW"
            ? { lastError: validationMessage(best.report) }
            : {}),
        },
      })

      return { resumeId: resume.id, snapshotId: snapshotRow.id, validationId: validationRow.id }
    })

    return {
      ok: true,
      result: {
        status: runStatus,
        runId: run.id,
        resumeId: created.resumeId,
        sourceResumeId: source.id,
        sourceVersion: snapshot.sourceVersion,
        snapshotHash,
        validation: best.report,
        requirements,
        attempts,
        rejected: best.rejected,
        review:
          best.report.status === "NEEDS_REVIEW"
            ? {
                question: `Review the tailored resume for ${application.job.title} at ${application.job.companyName} before using it.`,
                reason: `${best.report.issues.length} validation issue${best.report.issues.length === 1 ? " requires" : "s require"} a human decision. The draft was not selected for the application.`,
                fallback:
                  "Open the draft in the resume editor, fix the flagged claims, or tailor manually.",
              }
            : null,
      },
    }
  } catch (error) {
    log.error("Could not persist the tailored resume", { error })
    await prisma.resumeTailoringRun
      .update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          attempts,
          finishedAt: new Date(),
          lastError: "The tailored resume could not be saved.",
        },
      })
      .catch(() => undefined)
    return {
      ok: false,
      reason: "PERSISTENCE_FAILED",
      message: "The tailored resume could not be saved. Please try again.",
      runId: run.id,
      retryable: true,
    }
  }
}

/**
 * Records provenance for a resume created by the manual editor action. The
 * caller has already validated and written the resume; this writes the
 * immutable snapshot, run, validation and first edit event together.
 */
export async function recordManualTailoringArtifacts(input: {
  userId: string
  resumeId: string
  source: {
    id: string
    version?: number | null
    title: string
    template: string
    targetRole?: string | null
    targetCompany?: string | null
    sections: ResumeSectionSnapshot[]
  }
  tailoredSections: ResumeSectionSnapshot[]
  requirements: RequirementEvidence[]
  report: TailoringValidationReport
  jobApplicationId: string
  title: string
}): Promise<{ runId: string; snapshotId: string; validationId: string } | null> {
  const snapshot = buildSourceSnapshot(input.source)
  const hash = hashSourceSnapshot(snapshot)

  try {
    return await prisma.$transaction(async (tx) => {
      const run = await tx.resumeTailoringRun.create({
        data: {
          userId: input.userId,
          resumeId: input.resumeId,
          sourceResumeId: input.source.id,
          jobApplicationId: input.jobApplicationId,
          status: input.report.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "COMPLETED",
          mode: "MANUAL",
          attempts: 1,
          sourceVersion: snapshot.sourceVersion,
          snapshotHash: hash,
          requirementMap: input.requirements as unknown as Prisma.InputJsonValue,
          validation: input.report as unknown as Prisma.InputJsonValue,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
          ...(input.report.status === "NEEDS_REVIEW"
            ? { lastError: validationMessage(input.report) }
            : {}),
        },
        select: { id: true },
      })

      const snapshotRow = await tx.resumeSnapshot.create({
        data: {
          resumeId: input.resumeId,
          userId: input.userId,
          sourceResumeId: input.source.id,
          sourceVersion: snapshot.sourceVersion,
          hash,
          payload: snapshot as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      })

      const validationRow = await tx.resumeValidation.create({
        data: {
          resumeId: input.resumeId,
          userId: input.userId,
          tailoringRunId: run.id,
          status: input.report.status,
          sourceHash: hash,
          report: input.report as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      })

      await tx.resumeEditEvent.create({
        data: {
          resumeId: input.resumeId,
          userId: input.userId,
          kind: "TAILORING_APPLIED",
          versionBefore: 1,
          versionAfter: 1,
          summary: `Tailored for ${input.title}`,
          metadata: {
            tailoringRunId: run.id,
            snapshotId: snapshotRow.id,
            validationId: validationRow.id,
            claims: input.report.claims.length,
            issues: input.report.issues.length,
            mode: "MANUAL",
          } as Prisma.InputJsonValue,
        },
      })

      return { runId: run.id, snapshotId: snapshotRow.id, validationId: validationRow.id }
    })
  } catch (error) {
    log.error("Could not record manual tailoring provenance", { error })
    return null
  }
}

/** Re-reads a stored snapshot for rollback/restore, scoped by owner. */
export async function findResumeSnapshot(
  userId: string,
  resumeId: string,
  snapshotId?: string
) {
  return prisma.resumeSnapshot.findFirst({
    where: {
      userId,
      resumeId,
      ...(snapshotId ? { id: snapshotId } : {}),
    },
    orderBy: { capturedAt: "desc" },
    select: {
      id: true,
      sourceResumeId: true,
      sourceVersion: true,
      hash: true,
      payload: true,
      capturedAt: true,
      restoredAt: true,
      restoreCount: true,
    },
  })
}

/** Parses a stored snapshot row, or null when its payload is malformed. */
export function snapshotPayloadOf(row: { payload: unknown }) {
  return parseSourceSnapshot(row.payload)
}

/** Exposed for the acceptance tests and the review UI. */
export function countEvidenceReferences(report: TailoringValidationReport): number {
  return report.claims.reduce((total, claim) => total + claim.evidenceRefs.length, 0)
}

export { serializeEvidence }
