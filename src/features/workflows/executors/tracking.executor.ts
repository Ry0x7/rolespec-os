import { prisma } from "@/shared/lib/prisma"

import type { WorkflowExecutor } from "../types"
import {
  loadWorkflowApplication,
  missingApplicationOutcome,
} from "./context"

function nextAction(status: string): string {
  if (status === "INTERESTED") {
    return "You still need to submit the application; nothing was submitted automatically."
  }
  if (status === "APPLIED") {
    return "Submitted by you. Record any response in the tracker and schedule a follow-up."
  }
  if (status === "SCREENING") {
    return "A screening is in progress; note its outcome before the next workflow run."
  }
  if (status === "INTERVIEW") {
    return "An interview is in progress; prepare and record the outcome in the tracker."
  }
  if (status === "OFFER") {
    return "An offer is recorded; review it and record your decision in the tracker."
  }
  if (status === "REJECTED" || status === "WITHDRAWN") {
    return "This application is closed; no further automation is needed."
  }
  return "Review the application in the tracker and decide the next step."
}

/**
 * TRACKING is a read-only checkpoint. It confirms what the tracker actually
 * records; it never stamps `APPLIED` because a workflow staged a bundle.
 */
export const trackingExecutor: WorkflowExecutor = async (context) => {
  const application = await loadWorkflowApplication(
    context.userId,
    context.jobApplicationId
  )
  if (!application) return missingApplicationOutcome("tracking")

  const statusEventCount = await prisma.applicationStatusEvent.count({
    where: { jobApplicationId: application.id },
  })

  return {
    status: "COMPLETED",
    summary: `Tracking check: application is ${application.status}; ${statusEventCount} status event(s).`,
    output: {
      applicationStatus: application.status,
      dateApplied: application.dateApplied
        ? application.dateApplied.toISOString().slice(0, 10)
        : null,
      statusEventCount,
      nextAction: nextAction(application.status),
      submittedByWorkflow: false,
    },
  }
}
