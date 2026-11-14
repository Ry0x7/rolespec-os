import { redactText } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"

import type { WorkflowStepOutcome } from "../types"

/**
 * The application slice every executor reads. Loaded fresh on each attempt so a
 * resumed workflow sees the user's latest profile, resume choice and answers —
 * the run input is an id snapshot, not stale personal data.
 */
export async function loadWorkflowApplication(userId: string, jobApplicationId: string | null) {
  if (!jobApplicationId) return null
  return prisma.jobApplication.findFirst({
    where: { id: jobApplicationId, userId },
    select: {
      id: true,
      userId: true,
      status: true,
      dateApplied: true,
      followUpAt: true,
      lastFollowedUpAt: true,
      resumeId: true,
      job: {
        select: {
          id: true,
          title: true,
          companyName: true,
          description: true,
          location: true,
          workType: true,
          url: true,
          salary: true,
          salaryPeriod: true,
          salaryCurrency: true,
          postedAt: true,
          requirementFlags: true,
        },
      },
    },
  })
}

export type WorkflowApplication = NonNullable<
  Awaited<ReturnType<typeof loadWorkflowApplication>>
>

/** A deleted application is unrecoverable but must still be actionable. */
export function missingApplicationOutcome(step: string): WorkflowStepOutcome {
  return {
    status: "FAILED",
    error: `The tracked application for ${step} no longer exists.`,
    retryable: false,
    fallback: "Open the tracker, recreate the application, and start a new workflow.",
  }
}

/** Long text stored in an event or output is capped rather than unbounded. */
export function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Safe, stable provider failure text without a stack, request URL or key. */
export function providerFailure(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "The provider call timed out."
    return redactText(error.message.split("\n")[0] || "The provider call failed.", 300)
  }
  return "The provider call failed."
}
