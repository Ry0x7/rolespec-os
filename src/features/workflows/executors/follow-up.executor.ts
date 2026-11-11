import { recommendFollowUpSchedule } from "@/features/jobs/services/follow-up-schedule.service"

import type { WorkflowExecutor } from "../types"
import {
  loadWorkflowApplication,
  missingApplicationOutcome,
} from "./context"

/**
 * FOLLOW_UP only recommends. The schedule lives on `JobApplication.followUpAt`
 * and is written by the user's own action; sending is manual too. A workflow
 * must never create a chase the user did not accept.
 */
export const followUpExecutor: WorkflowExecutor = async (context) => {
  const application = await loadWorkflowApplication(
    context.userId,
    context.jobApplicationId
  )
  if (!application) return missingApplicationOutcome("follow-up")

  const advice = recommendFollowUpSchedule({
    status: application.status,
    dateApplied: application.dateApplied,
    now: context.now,
  })

  const needsApplication = application.dateApplied === null
  const rationale = needsApplication
    ? `${advice.reason} This becomes actionable after you submit the application.`
    : advice.isDeadlineUrgent && advice.deadlineNote
      ? `${advice.reason} ${advice.deadlineNote}`
      : advice.reason

  return {
    status: "COMPLETED",
    summary: needsApplication
      ? "Follow-up timing suggested; no application submitted yet."
      : `Follow-up suggested for ${advice.recommendedDate}.`,
    output: {
      recommendedDate: advice.recommendedDate,
      recommendedChannel: "EMAIL",
      rationale,
      alreadyScheduled: application.followUpAt !== null,
      existingFollowUpAt: application.followUpAt
        ? application.followUpAt.toISOString().slice(0, 10)
        : null,
      scheduled: false,
      sent: false,
    },
  }
}
