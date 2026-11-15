import type { WorkflowStepDefinition, WorkflowStepName } from "./types"

/**
 * The assisted application pipeline. Dependencies are explicit rather than an
 * array index, so the worker can run independent branches concurrently and a
 * future step can be inserted without renumbering meaning.
 *
 * `DISCOVER` is optional: failing to find more postings must not stop an
 * application the user already chose. Everything after research is required,
 * and `HUMAN_REVIEW` is the deliberate checkpoint before staging.
 */
export const APPLICATION_PIPELINE: readonly WorkflowStepDefinition[] = [
  {
    name: "PROFILE",
    order: 0,
    dependsOn: [],
    required: true,
    timeoutMs: 20_000,
    maxAttempts: 1,
  },
  {
    name: "DISCOVER",
    order: 1,
    dependsOn: ["PROFILE"],
    required: false,
    timeoutMs: 30_000,
    maxAttempts: 2,
  },
  {
    name: "RANK",
    order: 2,
    dependsOn: ["PROFILE"],
    required: true,
    timeoutMs: 20_000,
    maxAttempts: 1,
  },
  {
    name: "RESEARCH",
    order: 3,
    dependsOn: ["RANK"],
    required: true,
    timeoutMs: 120_000,
    maxAttempts: 2,
  },
  {
    name: "TAILOR",
    order: 4,
    dependsOn: ["RESEARCH"],
    required: true,
    timeoutMs: 120_000,
    maxAttempts: 2,
  },
  {
    name: "VALIDATE",
    order: 5,
    dependsOn: ["TAILOR"],
    required: true,
    timeoutMs: 30_000,
    maxAttempts: 1,
  },
  {
    name: "PREPARE_ATS",
    order: 6,
    dependsOn: ["VALIDATE"],
    required: true,
    timeoutMs: 20_000,
    maxAttempts: 1,
  },
  {
    name: "HUMAN_REVIEW",
    order: 7,
    dependsOn: ["PREPARE_ATS"],
    required: true,
    timeoutMs: 20_000,
    maxAttempts: 1,
  },
  {
    name: "SUBMISSION_STAGING",
    order: 8,
    dependsOn: ["HUMAN_REVIEW"],
    required: true,
    timeoutMs: 20_000,
    maxAttempts: 1,
  },
  {
    name: "TRACKING",
    order: 9,
    dependsOn: ["SUBMISSION_STAGING"],
    required: true,
    timeoutMs: 20_000,
    maxAttempts: 1,
  },
  {
    name: "FOLLOW_UP",
    order: 10,
    dependsOn: ["TRACKING"],
    required: false,
    timeoutMs: 20_000,
    maxAttempts: 1,
  },
]

export const PIPELINE_STEP_NAMES: readonly WorkflowStepName[] = APPLICATION_PIPELINE.map(
  (step) => step.name
)

/** The definition for a step, or a hard error naming an unknown step. */
export function stepDefinition(name: string): WorkflowStepDefinition {
  const definition = APPLICATION_PIPELINE.find((step) => step.name === name)
  if (!definition) throw new Error(`Unknown workflow step: ${name}`)
  return definition
}
