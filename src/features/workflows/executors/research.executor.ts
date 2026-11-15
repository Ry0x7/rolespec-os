import { researchJob } from "@/features/jobs/services/three-layer-research.service"

import {
  loadWorkflowApplication,
  missingApplicationOutcome,
  providerFailure,
} from "./context"
import type { JsonObject, WorkflowExecutor } from "../types"

const MAX_CITATIONS = 4

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

/**
 * RESEARCH stores a compact, source-linked summary of the three layers. Full
 * company overviews and posting text stay in the research service/company
 * result; the workflow output keeps the flags, culture states, host count and
 * citations needed to explain the step. A degraded company layer still
 * completes, with its uncertainty carried forward.
 */
export const researchExecutor: WorkflowExecutor = async ({
  userId,
  jobApplicationId,
  now,
  signal,
}) => {
  const application = await loadWorkflowApplication(userId, jobApplicationId)
  if (!application) return missingApplicationOutcome("research")

  try {
    const research = await researchJob({
      userId,
      companyName: application.job.companyName,
      jobTitle: application.job.title,
      url: application.job.url,
      location: application.job.location,
      description: application.job.description,
      useAi: true,
      now,
      signal,
    })

    const uncertainty = [
      ...research.requirements.uncertainty,
      ...research.culture.conflicts,
      ...(research.company.confidence === "LOW"
        ? [research.company.confidenceExplanation]
        : []),
    ]

    return {
      status: "COMPLETED",
      summary: `Research complete: ${research.requirements.flags.length} requirement flag(s), ${research.sourceSummary.independentSources} independent source(s).`,
      output: {
        companyConfidence: research.company.confidence,
        requirementFlags: research.requirements.flags,
        required: research.requirements.required,
        preferred: research.requirements.preferred,
        independentSources: research.sourceSummary.independentSources,
        cultureConfidence: research.culture.confidence,
        cultureSignals: jsonObject(
          research.culture.signals.map((signal) => ({
            label: signal.label,
            value: signal.value,
            state: signal.state,
          }))
        ),
        citations: jsonObject(
          research.company.citations.slice(0, MAX_CITATIONS).map((citation) => ({
            title: citation.title,
            url: citation.url,
            sourceType: citation.sourceType ?? "POSTING",
            verified: citation.verified === true,
          }))
        ),
        uncertainty,
      },
    }
  } catch (error) {
    return {
      status: "FAILED",
      error: providerFailure(error),
      retryable: true,
      fallback:
        "Open the job and run company research manually, then retry this step. The rest of the workflow has not been changed.",
    }
  }
}
