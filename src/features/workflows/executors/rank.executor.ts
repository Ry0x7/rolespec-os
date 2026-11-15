import { rankJobPool } from "@/features/ranking/services/ranking.service"
import { readRankingProfile } from "@/features/ranking/services/ranking-profile.service"

import {
  loadWorkflowApplication,
  missingApplicationOutcome,
} from "./context"
import type { WorkflowExecutor } from "../types"

function flags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

/**
 * RANK scores the one posting the application already targets. It is a read:
 * the score, factor states and explanation are stored on the step output, never
 * written onto `Job` or used to alter the qualification verdict.
 */
export const rankExecutor: WorkflowExecutor = async ({
  userId,
  jobApplicationId,
  now,
}) => {
  const application = await loadWorkflowApplication(userId, jobApplicationId)
  if (!application) return missingApplicationOutcome("ranking")

  const profile = await readRankingProfile(userId)
  const posting = application.job

  const result = rankJobPool({
    postings: [
      {
        id: posting.id,
        title: posting.title,
        companyName: posting.companyName,
        description: posting.description,
        location: posting.location,
        workType: posting.workType,
        salary: posting.salary,
        salaryCurrency: posting.salaryCurrency,
        salaryPeriod: posting.salaryPeriod,
        postedAt: posting.postedAt,
        requirementFlags: flags(posting.requirementFlags),
        url: posting.url,
      },
    ],
    profile,
    options: { now },
  })

  const entry = result.entries[0]
  if (!entry) {
    return {
      status: "FAILED",
      error: "The posting could not be scored.",
      retryable: true,
      fallback: "Re-run ranking from the job page, or continue with the manual application.",
    }
  }

  return {
    status: "COMPLETED",
    summary: `Ranked at ${entry.score}/100 with ${entry.factors.filter((factor) => factor.state !== "UNKNOWN").length} known factor(s).`,
    output: {
      jobId: posting.id,
      title: posting.title,
      companyName: posting.companyName,
      score: entry.score,
      fitScore: entry.fitScore,
      lexicalScore: entry.lexicalScore,
      coverage: entry.coverage,
      factors: JSON.parse(JSON.stringify(entry.factors)),
      explanation: entry.explanation,
    },
  }
}
