import { findIntroducedKeywords } from "@/shared/lib/evidence-grounding"
import { prisma } from "@/shared/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { validateTailoredResume } from "@/features/resume/tailoring/claim-validator"
import { parseSourceSnapshot } from "@/features/resume/tailoring/snapshot"
import type {
  RequirementEvidence,
  ResumeSectionSnapshot,
} from "@/features/resume/tailoring/types"

import type { JsonObject, JsonValue, WorkflowExecutor } from "../types"
import { truncate } from "./context"

/** Numbers and scope words a rewrite may not invent. */
const NUMERIC_CLAIM = /\b\d[\d,]*(?:\.\d+)?\s?(?:[%+kKmMbB])?/g
const SCOPE_CLAIM = /\b(?:all|every|entire|company-wide|organization-wide|global|worldwide|thousands|millions)\b/gi

interface StoredSuggestion {
  targetId: string
  originalText: string
  action: string
  suggested?: string
  reason: string
}

interface TailorOutput {
  suggestions: StoredSuggestion[]
  generatedSummary?: string
  grounded?: { supported?: string[]; ambiguous?: string[]; unsupported?: string[] }
}

function normalize(value: string): string {
  return value.replace(/[,\s]/g, "").toLowerCase()
}

function claimSet(text: string, pattern: RegExp): Set<string> {
  return new Set(Array.from(text.matchAll(pattern), (match) => normalize(match[0])))
}

function introducedFacts(original: string, suggested: string): string[] {
  const problems: string[] = []

  const allowedNumbers = claimSet(original, NUMERIC_CLAIM)
  for (const match of suggested.matchAll(NUMERIC_CLAIM)) {
    if (!allowedNumbers.has(normalize(match[0]))) problems.push(`number "${match[0]}"`)
  }

  const allowedScopes = new Set(
    Array.from(original.matchAll(SCOPE_CLAIM), (match) => match[0].toLowerCase())
  )
  for (const match of suggested.matchAll(SCOPE_CLAIM)) {
    if (!allowedScopes.has(match[0].toLowerCase())) problems.push(`scope "${match[0]}"`)
  }
  return problems
}

function parseTailorOutput(value: JsonValue | null): TailorOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.suggestions)) return null
  const suggestions = record.suggestions.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
    const item = entry as Record<string, unknown>
    if (
      typeof item.targetId !== "string" ||
      typeof item.originalText !== "string" ||
      typeof item.action !== "string" ||
      !["rewrite", "remove", "remove-item"].includes(item.action)
    ) {
      return []
    }
    return [
      {
        targetId: item.targetId,
        originalText: item.originalText,
        action: item.action,
        ...(typeof item.suggested === "string" ? { suggested: item.suggested } : {}),
        reason: typeof item.reason === "string" ? item.reason : "",
      },
    ]
  })
  return {
    suggestions,
    ...(typeof record.generatedSummary === "string"
      ? { generatedSummary: record.generatedSummary }
      : {}),
    grounded:
      record.grounded && typeof record.grounded === "object" && !Array.isArray(record.grounded)
        ? (record.grounded as TailorOutput["grounded"])
        : undefined,
  }
}

/**
 * Deterministic post-check on the tailoring output before anything is shown as
 * ready. It never calls a model and never edits the resume: it either confirms
 * the suggestions stayed inside the candidate's own text, or names the exact
 * target that did not.
 */
export const validateExecutor: WorkflowExecutor = async (context) => {
  const step = await prisma.workflowStep.findFirst({
    where: { runId: context.runId, name: "TAILOR" },
    select: { status: true, output: true },
  })
  if (!step || step.status === "SKIPPED" || !step.output) {
    return {
      status: "SKIPPED",
      reason: "No tailoring output exists to validate.",
      output: { skipped: true } as JsonObject,
    }
  }

  const rawOutput =
    step.output && typeof step.output === "object" && !Array.isArray(step.output)
      ? (step.output as Record<string, unknown>)
      : {}

  // Current tailoring step: a persisted DRAFT resume plus immutable source
  // snapshot. Re-validate the STORED document instead of trusting the stored
  // report — if anything changed between TAILOR and VALIDATE, this fails closed.
  if (typeof rawOutput.resumeId === "string") {
    const runId =
      typeof rawOutput.tailoringRunId === "string" ? rawOutput.tailoringRunId : null
    const [run, resume] = await Promise.all([
      runId
        ? prisma.resumeTailoringRun.findFirst({
            where: { id: runId, userId: context.userId },
            select: { id: true, snapshot: true, requirementMap: true, snapshotHash: true },
          })
        : null,
      prisma.resume.findFirst({
        where: {
          id: rawOutput.resumeId,
          userId: context.userId,
          status: { not: "ARCHIVED" },
        },
        select: {
          id: true,
          sections: {
            select: {
              id: true,
              type: true,
              title: true,
              order: true,
              visible: true,
              items: {
                select: { id: true, content: true, metadata: true, order: true },
                orderBy: { order: "asc" },
              },
            },
            orderBy: { order: "asc" },
          },
        },
      }),
    ])

    if (!run || !resume) {
      return {
        status: "FAILED",
        error: "The tailored draft or its source snapshot no longer exists.",
        retryable: false,
        fallback: "Re-run tailoring, or review the resume manually.",
      }
    }

    const snapshot = parseSourceSnapshot(run.snapshot)
    if (!snapshot) {
      return {
        status: "FAILED",
        error: "The tailored draft has no readable source snapshot.",
        retryable: false,
        fallback: "Re-run tailoring, or review the resume manually.",
      }
    }

    const requirements = Array.isArray(run.requirementMap)
      ? (run.requirementMap as unknown as RequirementEvidence[])
      : []
    const tailoredSections: ResumeSectionSnapshot[] = resume.sections.map((section) => ({
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

    const report = validateTailoredResume({
      source: snapshot.sections,
      tailored: tailoredSections,
      requirements,
      sourceHash: run.snapshotHash,
      now: context.now,
    })

    // The worker may already have timed this attempt out. Do not append a
    // validation row for work whose result will be discarded by the fence.
    context.signal?.throwIfAborted()
    await prisma.resumeValidation.create({
      data: {
        resumeId: resume.id,
        userId: context.userId,
        tailoringRunId: run.id,
        status: report.status,
        sourceHash: run.snapshotHash,
        report: report as unknown as Prisma.InputJsonValue,
      },
    })

    if (report.status === "FAIL") {
      const first = report.issues.find((issue) => issue.severity === "error")
      return {
        status: "FAILED",
        error: truncate(
          `The saved draft failed re-validation: ${first?.code ?? "UNSUPPORTED_CLAIM"}: ${first?.message ?? "unsupported claim"}`,
          400
        ),
        retryable: false,
        fallback:
          "Open the draft in the resume editor, fix the flagged claims, or apply manually. Nothing was selected or submitted.",
      }
    }

    return {
      status: "COMPLETED",
      summary:
        report.status === "PASS"
          ? `Re-validated the saved draft: ${report.claims.length} evidence-referenced claim${report.claims.length === 1 ? "" : "s"}.`
          : `Re-validated the saved draft with ${report.issues.length} review warning${report.issues.length === 1 ? "" : "s"}; a human must review it.`,
      output: {
        validated: true,
        resumeId: resume.id,
        tailoringRunId: run.id,
        validationStatus: report.status,
        claims: report.claims.length,
        evidenceReferences: report.claims.reduce(
          (total, claim) => total + claim.evidenceRefs.length,
          0
        ),
        issueCount: report.issues.length,
        requirementCoverage: {
          supported: report.requirementCoverage.supported,
          partial: report.requirementCoverage.partial,
          unsupported: report.requirementCoverage.unsupported,
          total: report.requirementCoverage.total,
        },
      } as JsonObject,
    }
  }

  const output = parseTailorOutput(step.output as JsonValue)
  if (!output) {
    return {
      status: "FAILED",
      error: "The tailoring output is not the expected structured shape.",
      retryable: false,
      fallback: "Retry tailoring, or review the resume manually.",
    }
  }

  const barred = [
    ...(output.grounded?.unsupported ?? []),
    ...(output.grounded?.ambiguous ?? []),
  ]
  const violations: string[] = []
  let checkedKeywords = 0

  if (output.generatedSummary) {
    // The summary is written from resume targets only, and the barred terms are
    // exactly the posting vocabulary the resume does not back. Any of them in
    // the summary is an invented claim.
    const introduced = findIntroducedKeywords("", output.generatedSummary, barred)
    if (introduced.length > 0) {
      violations.push(`generatedSummary: ${introduced.join(", ")}`)
    }
  }

  for (const suggestion of output.suggestions) {
    if (suggestion.action !== "rewrite" || !suggestion.suggested) continue
    const introduced = findIntroducedKeywords(
      suggestion.originalText,
      suggestion.suggested,
      barred
    )
    checkedKeywords += barred.length
    const facts = introducedFacts(suggestion.originalText, suggestion.suggested)
    if (introduced.length > 0 || facts.length > 0) {
      violations.push(
        `${suggestion.targetId}: ${[...introduced, ...facts].join(", ")}`
      )
    }
  }

  if (violations.length > 0) {
    return {
      status: "FAILED",
      error: `Grounding failed for ${truncate(violations.join("; "), 280)}`,
      retryable: false,
      fallback: "Review the flagged rewrites manually; nothing was saved.",
    }
  }

  return {
    status: "COMPLETED",
    summary: `Validated ${output.suggestions.length} suggestion${output.suggestions.length === 1 ? "" : "s"}; no unbacked claims found.`,
    output: {
      validated: true,
      suggestionCount: output.suggestions.length,
      checkedKeywords,
    } as JsonObject,
  }
}
