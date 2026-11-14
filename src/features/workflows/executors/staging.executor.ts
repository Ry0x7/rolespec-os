import { prisma } from "@/shared/lib/prisma"
import { stageSubmissionAttempt } from "@/features/submissions/services/submission.service"

import type { JsonObject, WorkflowExecutor } from "../types"
import {
  loadWorkflowApplication,
  missingApplicationOutcome,
} from "./context"

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * SUBMISSION_STAGING is the last automated step. It assembles the evidence the
 * user approved into one bundle and stops: no submission row, no status write,
 * no `dateApplied`. Without `HUMAN_REVIEW.approved === true` it refuses.
 */
export const stagingExecutor: WorkflowExecutor = async (context) => {
  const application = await loadWorkflowApplication(
    context.userId,
    context.jobApplicationId
  )
  if (!application) return missingApplicationOutcome("submission staging")

  const steps = await prisma.workflowStep.findMany({
    where: {
      runId: context.runId,
      name: {
        in: [
          "RANK",
          "RESEARCH",
          "TAILOR",
          "VALIDATE",
          "PREPARE_ATS",
          "HUMAN_REVIEW",
        ],
      },
    },
    select: { name: true, status: true, output: true },
  })
  const byName = new Map(steps.map((step) => [step.name, step]))

  const review = byName.get("HUMAN_REVIEW")
  const reviewOutput = asObject(review?.output)
  if (reviewOutput.approved !== true) {
    return {
      status: "FAILED",
      error: "Submission staging requires an approved human review.",
      retryable: false,
      fallback:
        "Start a new workflow and approve the human review, or continue with the manual application.",
    }
  }

  const rank = asObject(byName.get("RANK")?.output)
  const research = asObject(byName.get("RESEARCH")?.output)
  const tailor = asObject(byName.get("TAILOR")?.output)
  const validate = asObject(byName.get("VALIDATE")?.output)
  const ats = asObject(byName.get("PREPARE_ATS")?.output)

  const atsFields =
    ats.fields && typeof ats.fields === "object" && !Array.isArray(ats.fields)
      ? Object.keys(ats.fields).length
      : 0
  const blockedQuestions = Array.isArray(ats.needsUserAnswer)
    ? ats.needsUserAnswer.length
    : 0
  const suggestionCount = Array.isArray(tailor.suggestions)
    ? tailor.suggestions.length
    : numberOrNull(tailor.suggestionCount) ?? 0
  const tailoredResumeId =
    typeof tailor.resumeId === "string" ? tailor.resumeId : null
  const validationStatus =
    typeof tailor.validationStatus === "string" ? tailor.validationStatus : null

  const approvedAt =
    typeof reviewOutput.approvedAt === "string"
      ? reviewOutput.approvedAt
      : context.now.toISOString()

  const evidence: JsonObject = {
    rankScore: numberOrNull(rank.score),
    researchConfidence:
      typeof research.companyConfidence === "string"
        ? research.companyConfidence
        : null,
    tailoringSuggestionCount: suggestionCount,
    tailoredResumeId,
    validationStatus,
    validated: validate.validated === true && validationStatus !== "FAIL",
    atsFields,
    blockedQuestions,
  }

  const attempt = await stageSubmissionAttempt({
    userId: context.userId,
    jobApplicationId: application.id,
    workflowRunId: context.runId,
    resumeId: tailoredResumeId ?? application.resumeId,
    source: "WORKFLOW",
    jobTitle: application.job.title,
    companyName: application.job.companyName,
    sourceUrl: application.job.url,
    evidence,
    signal: context.signal,
  })

  return {
    status: "COMPLETED",
    summary: `Staged ${application.job.title} at ${application.job.companyName}; nothing was submitted.`,
    output: {
      staged: true,
      submitted: false,
      submissionAttemptId: attempt.id,
      submissionAttemptStatus: attempt.status,
      job: {
        id: application.job.id,
        title: application.job.title,
        companyName: application.job.companyName,
        url: application.job.url,
      },
      evidence,
      approvedAt,
    },
  }
}
