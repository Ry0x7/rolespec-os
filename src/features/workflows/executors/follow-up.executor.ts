import { listFollowUpTasks } from "@/features/jobs/services/follow-up-task.service"
import { recommendFollowUpSchedule } from "@/features/jobs/services/follow-up-schedule.service"

import type { WorkflowExecutor } from "../types"
import {
  loadWorkflowApplication,
  missingApplicationOutcome,
} from "./context"

/**
 * FOLLOW_UP reads the durable reminders that APPLIED created. Sending remains
 * manual; the workflow never drafts a chase the user did not accept.
 */
export const followUpExecutor: WorkflowExecutor = async (context) => {
  const application = await loadWorkflowApplication(
    context.userId,
    context.jobApplicationId
  )
  if (!application) return missingApplicationOutcome("follow-up")

  const followUpTasks = await listFollowUpTasks(context.userId, {
    jobApplicationId: application.id,
    limit: 10,
  })
  const pending = followUpTasks.filter((task) => task.status === "PENDING")
  const emailTask = pending.find((task) => task.channel === "EMAIL")
  const linkedInTask = pending.find((task) => task.channel === "LINKEDIN")

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
      : `Follow-up suggested for ${emailTask?.dueAt ?? advice.recommendedDate}.`,
    output: {
      recommendedDate: emailTask?.dueAt ?? advice.recommendedDate,
      recommendedLinkedInDate: linkedInTask?.dueAt ?? null,
      recommendedChannel: "EMAIL",
      rationale,
      followUpTasks: followUpTasks.map((task) => ({
        id: task.id,
        applicationId: task.jobApplicationId,
        channel: task.channel,
        status: task.status,
        dueAt: task.dueAt,
        reason: task.reason,
      })),
      alreadyScheduled: pending.length > 0 || application.followUpAt !== null,
      existingFollowUpAt: application.followUpAt
        ? application.followUpAt.toISOString().slice(0, 10)
        : null,
      scheduled: pending.length > 0,
      sent: false,
    },
  }
}
