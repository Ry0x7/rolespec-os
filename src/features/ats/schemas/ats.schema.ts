import { z } from "zod"

export const atsFieldSchema = z
  .object({
    fieldId: z.string().min(1).max(80),
    label: z.string().min(1).max(300),
    name: z.string().max(120).optional(),
    type: z.string().max(40).optional(),
    tagName: z.string().max(20).optional(),
    autocomplete: z.string().max(60).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().max(200)).max(40).optional(),
    requiresSelection: z.boolean().optional(),
    frameId: z.number().int().min(0).max(1000).optional(),
  })
  .strict()

export const atsFieldResultSchema = z
  .object({
    fieldId: z.string().min(1).max(80),
    questionKey: z.string().max(180).optional(),
    status: z.enum(["FILLED", "SKIPPED", "FAILED", "REVIEW_REQUIRED"]),
    reason: z.string().max(300).optional(),
  })
  .strict()

export const createAtsPreparationSchema = z
  .object({
    sourceUrl: z.string().url().max(4000),
    vendor: z.string().max(40).optional(),
    pageTitle: z.string().max(300).optional(),
    jobTitle: z.string().max(200).optional(),
    companyName: z.string().max(200).optional(),
    jobApplicationId: z.string().min(1).max(64).optional(),
    resumeId: z.string().min(1).max(64).optional(),
    fields: z.array(atsFieldSchema).max(150),
    results: z.array(atsFieldResultSchema).max(150).optional(),
  })
  .strict()

export const updateAtsPreparationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("RECORD_RESULTS"),
      results: z.array(atsFieldResultSchema).max(150),
    })
    .strict(),
  z
    .object({
      action: z.literal("ATTACH_RESUME"),
      resumeId: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      action: z.literal("CONFIRM_SUBMISSION"),
      submitted: z.boolean(),
      note: z.string().max(2000).optional(),
    })
    .strict(),
  z.object({ action: z.literal("ABANDON") }).strict(),
])

export const approveAtsAnswerSchema = z
  .object({
    preparationId: z.string().min(1).max(64).optional(),
    questionText: z.string().min(1).max(2000),
    value: z.union([
      z.string().max(2000),
      z.boolean(),
      z.array(z.string().max(200)).max(20),
    ]),
    scope: z.enum(["APPLICATION", "GLOBAL"]).optional(),
    replace: z.boolean().optional(),
  })
  .strict()

export const revokeAtsAnswerSchema = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict()

export const extensionReviewActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("RESOLVE"),
      value: z.unknown(),
      scope: z.enum(["APPLICATION", "GLOBAL"]).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("DISMISS"),
      reason: z.string().max(1000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("ATTACH_RESUME"),
      resumeId: z.string().min(1).max(64),
    })
    .strict(),
])
