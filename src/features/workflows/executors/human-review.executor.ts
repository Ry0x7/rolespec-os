import { prisma } from "@/shared/lib/prisma"

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

/**
 * HUMAN_REVIEW is a real checkpoint, not a status message. It always asks for
 * explicit approval before staging, names the actual role and company, and says
 * plainly that nothing has been submitted. The suggested value carries counts
 * only — never an answer, never an approval.
 */
export const humanReviewExecutor: WorkflowExecutor = async (context) => {
  const application = await loadWorkflowApplication(
    context.userId,
    context.jobApplicationId
  )
  if (!application) return missingApplicationOutcome("human review")

  const atsStep = await prisma.workflowStep.findFirst({
    where: { runId: context.runId, name: "PREPARE_ATS" },
    select: { output: true },
  })
  const ats = asObject(atsStep?.output)
  const preparedFieldCount =
    ats.fields && typeof ats.fields === "object" && !Array.isArray(ats.fields)
      ? Object.keys(ats.fields).length
      : 0
  const blockedQuestionCount = Array.isArray(ats.needsUserAnswer)
    ? ats.needsUserAnswer.length
    : 0

  // The tailoring step now produces a real DRAFT resume plus a validation
  // report. Surface both here so the human reviews the actual document rather
  // than a count of suggestions. Neither is selected for the application yet.
  const tailorStep = await prisma.workflowStep.findFirst({
    where: { runId: context.runId, name: "TAILOR" },
    select: { output: true },
  })
  const tailor = asObject(tailorStep?.output)
  const tailoredResumeId =
    typeof tailor.resumeId === "string" ? tailor.resumeId : null
  const validationStatus =
    typeof tailor.validationStatus === "string" ? tailor.validationStatus : null
  const validationIssueCount =
    typeof tailor.issueCount === "number" && Number.isFinite(tailor.issueCount)
      ? tailor.issueCount
      : 0
  const needsReview = tailor.needsReview === true

  const suggestedValue: JsonObject = {
    preparedFieldCount,
    blockedQuestionCount,
    tailoredResumeId,
    validationStatus,
    validationIssueCount,
    needsReview,
  }

  return {
    status: "WAITING_FOR_USER",
    review: {
      kind: "SUBMISSION_CONFIRMATION",
      question: needsReview
        ? `Review the tailored draft and prepared application for ${application.job.title} at ${application.job.companyName}. Continue?`
        : `Review the prepared application for ${application.job.title} at ${application.job.companyName}. Continue?`,
      reason: needsReview
        ? `Nothing has been submitted. The tailored draft has ${validationIssueCount} validation issue${validationIssueCount === 1 ? "" : "s"} and has NOT been selected for this application; review it in the resume editor before approving.`
        : "Nothing has been submitted. The tailored draft is evidence-checked but not selected for the application until you approve.",
      category: "submission_confirmation",
      fallback:
        "You can apply manually in the ATS at any time; this workflow will not submit anything for you.",
      suggestedValue,
    },
  }
}
