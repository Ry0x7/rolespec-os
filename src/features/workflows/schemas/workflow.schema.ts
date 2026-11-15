import { z } from "zod"

const stepName = z.enum([
  "PROFILE",
  "DISCOVER",
  "RANK",
  "RESEARCH",
  "TAILOR",
  "VALIDATE",
  "PREPARE_ATS",
  "HUMAN_REVIEW",
  "SUBMISSION_STAGING",
  "TRACKING",
  "FOLLOW_UP",
])

export const workflowModeSchema = z.enum(["MANUAL", "AGENT_ASSISTED"])

export const workflowKindSchema = z.enum([
  "APPLICATION",
  "DISCOVERY",
  "RESEARCH",
  "TAILOR",
  "AUTOFILL",
  "FOLLOW_UP",
])

export const workflowStateSchema = z.enum([
  "MANUAL",
  "ASSISTED",
  "AWAITING_REVIEW",
  "PAUSED",
  "FAILED",
  "COMPLETED",
  "CANCELLED",
])

export const reviewTaskKindSchema = z.enum([
  "SENSITIVE_ANSWER",
  "UNKNOWN_FIELD",
  "MISSING_PROFILE_FACT",
  "RESTRICTED_ACCESS",
  "AMBIGUOUS_TAILORING",
  "SUBMISSION_CONFIRMATION",
  "ESSAY_ANSWER",
  "RESUME_ATTACHMENT",
  "CONFLICTING_ANSWER",
  "UNSUPPORTED_FIELD",
])

export const reviewTaskStatusSchema = z.enum([
  "OPEN",
  "RESOLVED",
  "DISMISSED",
  "EXPIRED",
])

export const createWorkflowSchema = z
  .object({
    jobApplicationId: z.string().min(1).optional(),
    mode: workflowModeSchema.default("AGENT_ASSISTED"),
    // Only the application pipeline is implemented. Other kinds remain in the
    // database enum for future pipelines but are not accepted by this API yet.
    kind: z.literal("APPLICATION").default("APPLICATION"),
    idempotencyKey: z.string().min(8).max(120).optional(),
    input: z
      .object({
        resumeId: z.string().min(1).optional(),
        targetRole: z.string().min(1).max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const advanceWorkflowSchema = z
  .object({
    action: z.enum(["START", "RESUME", "RETRY", "PAUSE", "CANCEL", "COMPLETE_STEP"]),
    stepName: stepName.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "COMPLETE_STEP" && !value.stepName) {
      ctx.addIssue({
        code: "custom",
        message: "stepName is required when completing a manual step.",
        path: ["stepName"],
      })
    }
  })

export const createReviewTaskSchema = z
  .object({
    jobApplicationId: z.string().min(1).optional(),
    kind: reviewTaskKindSchema,
    question: z.string().min(1).max(2000),
    reason: z.string().min(1).max(2000),
    category: z.string().max(100).optional(),
    fallback: z.string().max(2000).optional(),
    suggestedValue: z.unknown().optional(),
  })
  .strict()

export const resolveReviewTaskSchema = z
  .object({
    action: z.enum(["RESOLVE", "DISMISS"]),
    value: z.unknown().optional(),
    reason: z.string().max(1000).optional(),
    /**
     * ATS answers can be remembered for this application only or for every
     * future form. Omitted means application-scoped, the narrower choice.
     */
    scope: z.enum(["APPLICATION", "GLOBAL"]).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.action === "RESOLVE" && input.value === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "A value is required to resolve a review task.",
        path: ["value"],
      })
    }
  })
