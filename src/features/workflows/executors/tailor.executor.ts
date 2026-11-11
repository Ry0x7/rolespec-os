import type { JsonObject, WorkflowExecutor } from "../types"
import { loadWorkflowApplication, missingApplicationOutcome, truncate } from "./context"
import {
  countEvidenceReferences,
  tailorResumeForApplication,
} from "@/features/resume/tailoring/tailoring.service"

/**
 * TAILOR now runs the full evidence-grounded tailoring pipeline: requirement
 * mapping, provider generation, bounded repair, deterministic validation and a
 * persisted DRAFT resume with an immutable source snapshot. It never selects the
 * draft for the application and never submits anything; HUMAN_REVIEW is still
 * the checkpoint that decides whether the draft is used.
 *
 * When no claim-clean resume can be produced, the step pauses for a human with
 * the exact violations. Manual resume editing remains available throughout.
 */
export const tailorExecutor: WorkflowExecutor = async (context) => {
  const application = await loadWorkflowApplication(
    context.userId,
    context.jobApplicationId
  )
  if (!application) return missingApplicationOutcome("tailoring")

  const outcome = await tailorResumeForApplication({
    userId: context.userId,
    jobApplicationId: application.id,
    sourceResumeId: application.resumeId ?? context.input.resumeId,
    mode: "WORKFLOW",
  })

  if (!outcome.ok) {
    switch (outcome.reason) {
      case "NO_RESUME":
        return {
          status: "WAITING_FOR_USER",
          review: {
            kind: "MISSING_PROFILE_FACT",
            question: `Which resume should be tailored for ${application.job.title} at ${application.job.companyName}?`,
            reason:
              "No resume is selected for this application and no master resume exists.",
            category: "resume",
            fallback: "Choose a resume for this application in the tracker, then resume.",
          },
        }
      case "NO_CONTENT":
        return {
          status: "WAITING_FOR_USER",
          review: {
            kind: "AMBIGUOUS_TAILORING",
            question: `Which parts of your resume should be tailored for ${application.job.title}?`,
            reason: outcome.message,
            category: "resume",
            fallback: "Add structured experience, skills or a summary in the resume editor, then resume.",
            suggestedValue: { runId: outcome.runId ?? null } as JsonObject,
          },
        }
      case "NO_CHANGES":
        return {
          status: "WAITING_FOR_USER",
          review: {
            kind: "AMBIGUOUS_TAILORING",
            question: `No supportable tailoring changes were found for ${application.job.title}. How should the application proceed?`,
            reason: outcome.message,
            category: "resume",
            fallback:
              "Open the resume editor, add concrete achievements, or apply manually; the workflow does not fabricate content.",
            suggestedValue: {
              runId: outcome.runId ?? null,
              validationStatus: outcome.validation?.status ?? null,
            } as JsonObject,
          },
        }
      case "VALIDATION_FAILED": {
        const errors =
          outcome.validation?.issues
            .filter((issue) => issue.severity === "error")
            .slice(0, 3)
            .map((issue) => `${issue.code}: ${truncate(issue.message, 160)}`) ?? []
        return {
          status: "WAITING_FOR_USER",
          review: {
            kind: "AMBIGUOUS_TAILORING",
            question: `The tailored draft for ${application.job.title} failed evidence validation. Fix it or apply manually?`,
            reason: truncate(
              `${outcome.message}${errors.length > 0 ? ` First failures: ${errors.join(" | ")}` : ""}`,
              900
            ),
            category: "resume",
            fallback:
              "Open the resume editor, fix the flagged claims, or apply manually. No invalid draft was saved.",
            suggestedValue: {
              runId: outcome.runId ?? null,
              issues: outcome.validation?.issues.slice(0, 5) ?? [],
            } as unknown as JsonObject,
          },
        }
      }
      case "PROVIDER_CONFIGURATION":
        return {
          status: "FAILED",
          error: outcome.message,
          retryable: false,
          fallback:
            "Configure an AI provider in Settings, or tailor the resume manually, then retry.",
        }
      case "PROVIDER_FAILURE":
        return {
          status: "FAILED",
          error: outcome.message,
          retryable: outcome.retryable !== false,
          fallback:
            "Retry the step; if it keeps failing, tailor the resume manually in the editor.",
        }
      default:
        return {
          status: "FAILED",
          error: outcome.message,
          retryable: outcome.retryable ?? false,
          fallback:
            "Open the tracker and verify the application still exists, or continue with the manual application.",
        }
    }
  }

  const { result } = outcome
  const errorCount = result.validation.issues.filter(
    (issue) => issue.severity === "error"
  ).length
  const warningCount = result.validation.issues.filter(
    (issue) => issue.severity === "warning"
  ).length

  const output: JsonObject = {
    resumeId: result.resumeId,
    tailoringRunId: result.runId,
    validationStatus: result.validation.status,
    suggestionCount: result.validation.claims.length,
    claimCount: result.validation.claims.length,
    evidenceReferenceCount: countEvidenceReferences(result.validation),
    errorCount,
    warningCount,
    issueCount: result.validation.issues.length,
    requirementCoverage: {
      supported: result.validation.requirementCoverage.supported,
      partial: result.validation.requirementCoverage.partial,
      unsupported: result.validation.requirementCoverage.unsupported,
      total: result.validation.requirementCoverage.total,
    },
    snapshotHash: result.snapshotHash,
    sourceVersion: result.sourceVersion,
    attempts: result.attempts,
    needsReview: result.validation.status !== "PASS",
    issues: result.validation.issues.slice(0, 8).map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: truncate(issue.message, 300),
    })),
  }

  // Nothing to persist separately: the service already wrote the run, snapshot,
  // validation row and DRAFT resume. A human still decides whether to use it.
  return {
    status: "COMPLETED",
    summary:
      result.validation.status === "PASS"
        ? `Created an evidence-checked draft resume with ${result.validation.claims.length} referenced change${result.validation.claims.length === 1 ? "" : "s"}.`
        : `Created a draft resume with ${warningCount} review warning${warningCount === 1 ? "" : "s"}; nothing was selected or submitted.`,
    output,
  }
}
