import { z } from "zod"
import { CareerEvidenceKind } from "@/generated/prisma/enums"
import { INTAKE_SOURCES } from "../types"
import type {
  ContactField,
  IntakePatchKind,
  IntakeProvenance,
} from "../types"

const isoDate = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Use an ISO timestamp")

const optionalHttpUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value === "" || /^https?:\/\//i.test(value),
    "Use an http(s) URL"
  )
  .optional()
  .nullable()
  .transform((value) => (value ? value : null))

export const intakeProvenanceSchema = z.object({
  adapter: z.string().trim().min(1).max(80),
  sourceUrl: optionalHttpUrl,
  fileName: z.string().trim().max(255).optional().nullable().transform((v) => v || null),
  externalId: z.string().trim().max(200).optional().nullable().transform((v) => v || null),
  locator: z.string().trim().max(200).optional().nullable().transform((v) => v || null),
  fetchedAt: isoDate,
  detail: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
})

/** A real calendar date, or null when the source did not state one. */
const optionalCalendarDate = z
  .union([z.literal(""), z.string().trim().max(10), z.null()])
  .optional()
  .transform((value) => (value ? value : null))
  .refine((value) => {
    if (value === null) return true
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const [year, month, day] = value.split("-").map(Number)
    if (month < 1 || month > 12 || day < 1 || day > 31) return false
    const parsed = new Date(Date.UTC(year, month - 1, day))
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    )
  }, "Use a real date in YYYY-MM-DD format")

const nullableText = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((value) => {
      const trimmed = value?.trim()
      return trimmed ? trimmed : null
    })

export const contactFieldSchema = z.enum([
  "contactFullName",
  "contactEmail",
  "contactPhone",
  "contactLocation",
  "linkedinUrl",
  "githubUrl",
  "websiteUrl",
])

export const contactPatchDataSchema = z
  .object({
    field: contactFieldSchema,
    value: z.string().trim().min(1).max(500),
  })
  // The profile's own contact form enforces these shapes. A patch must not be
  // able to write a value that form would reject, especially after a manual
  // correction through the API.
  .superRefine((data, ctx) => {
    const valid =
      data.field === "contactEmail"
        ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.value) && data.value.length <= 320
        : data.field === "contactFullName" || data.field === "contactLocation"
          ? data.value.length <= 200
          : data.field === "contactPhone"
            ? data.value.length <= 50
            : /^https?:\/\/\S+$/i.test(data.value)
    if (!valid) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message:
          data.field === "contactEmail"
            ? "Enter a valid email address"
            : data.field === "linkedinUrl" ||
                data.field === "githubUrl" ||
                data.field === "websiteUrl"
              ? "Enter a valid http(s) URL"
              : "That value is too long for this field",
      })
    }
  })
  .superRefine((data, ctx) => {
    // A malformed email or non-http URL must be rejected here, because apply
    // writes the value into the same columns the manual form validates.
    if (data.field === "contactEmail" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a valid email address" })
    }
    if (
      (data.field === "linkedinUrl" ||
        data.field === "githubUrl" ||
        data.field === "websiteUrl") &&
      !/^https?:\/\/\S+$/i.test(data.value)
    ) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter an http(s) URL" })
    }
  })

export const evidencePatchDataSchema = z.object({
  evidenceKind: z.nativeEnum(CareerEvidenceKind),
  title: z.string().trim().min(1).max(300),
  organization: nullableText(300),
  details: nullableText(4000),
  outcome: nullableText(2000),
  startDate: optionalCalendarDate,
  endDate: optionalCalendarDate,
})

export const skillPatchDataSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: nullableText(80),
})

export const targetRolePatchDataSchema = z.object({
  title: z.string().trim().min(1).max(200),
})

/**
 * The one schema every adapter's output must satisfy. `kind` and `data` are
 * separate fields on disk, but together they are the canonical intake event.
 */
export const patchDraftSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("CONTACT"),
    data: contactPatchDataSchema,
    confidence: z.number().int().min(0).max(100),
    provenance: intakeProvenanceSchema,
  }),
  z.object({
    kind: z.literal("EVIDENCE"),
    data: evidencePatchDataSchema,
    confidence: z.number().int().min(0).max(100),
    provenance: intakeProvenanceSchema,
  }),
  z.object({
    kind: z.literal("SKILL"),
    data: skillPatchDataSchema,
    confidence: z.number().int().min(0).max(100),
    provenance: intakeProvenanceSchema,
  }),
  z.object({
    kind: z.literal("TARGET_ROLE"),
    data: targetRolePatchDataSchema,
    confidence: z.number().int().min(0).max(100),
    provenance: intakeProvenanceSchema,
  }),
])

export const patchCorrectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CONTACT"), data: contactPatchDataSchema }),
  z.object({ kind: z.literal("EVIDENCE"), data: evidencePatchDataSchema }),
  z.object({ kind: z.literal("SKILL"), data: skillPatchDataSchema }),
  z.object({ kind: z.literal("TARGET_ROLE"), data: targetRolePatchDataSchema }),
])

/** Validates a persisted payload, which has no confidence or provenance. */
export function parsePatchData(kind: IntakePatchKind, payload: unknown) {
  switch (kind) {
    case "CONTACT":
      return contactPatchDataSchema.parse(payload)
    case "EVIDENCE":
      return evidencePatchDataSchema.parse(payload)
    case "SKILL":
      return skillPatchDataSchema.parse(payload)
    case "TARGET_ROLE":
      return targetRolePatchDataSchema.parse(payload)
  }
}

const resumeInputSchema = z
  .object({
    resumeId: z.string().trim().min(1).max(64).optional(),
    /** Extracted text. The upload route fills this; API callers may paste it. */
    text: z.string().max(200_000).optional(),
    fileName: z.string().trim().max(255).optional(),
  })
  .refine(
    (value) =>
      Boolean(value.resumeId) ||
      Boolean(value.text && value.text.trim().length >= 20),
    "Provide an existing resume or at least 20 characters of resume text"
  )

const linkedinInputSchema = z.object({
  /** Text from a LinkedIn data export, "Save to PDF", or a user's own copy. */
  text: z.string().trim().min(20).max(200_000),
  fileName: z.string().trim().max(255).optional(),
  useAi: z.boolean().optional(),
})

const githubInputSchema = z.object({
  url: z.string().trim().min(1).max(500),
  /** Explicit, per-run permission to read public GitHub data. */
  consent: z.literal(true),
})

const webInputSchema = z.object({
  url: z.string().trim().min(1).max(500),
  consent: z.literal(true),
})

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
})

const chatInputSchema = z.object({
  transcript: z.array(chatMessageSchema).min(1).max(60),
  /** Profile fields the client knows are missing; drives the next question. */
  missingFields: z.array(z.string().max(40)).max(20).optional(),
  useAi: z.boolean().optional(),
})

const voiceInputSchema = z.object({
  transcript: z.string().trim().min(1).max(20_000),
  inputMode: z.enum(["MICROPHONE", "PASTED"]).default("PASTED"),
  useAi: z.boolean().optional(),
})

export const intakeSourceRequestSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("RESUME"), input: resumeInputSchema }),
  z.object({ source: z.literal("GITHUB"), input: githubInputSchema }),
  z.object({ source: z.literal("LINKEDIN"), input: linkedinInputSchema }),
  z.object({ source: z.literal("WEB"), input: webInputSchema }),
  z.object({ source: z.literal("CHAT"), input: chatInputSchema }),
  z.object({ source: z.literal("VOICE"), input: voiceInputSchema }),
])

export const createIntakeRunSchema = z
  .object({
    requests: z.array(intakeSourceRequestSchema).min(1).max(INTAKE_SOURCES.length),
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    for (const request of value.requests) {
      if (seen.has(request.source)) {
        ctx.addIssue({
          code: "custom",
          path: ["requests"],
          message: `Only one ${request.source} source may run per intake run`,
        })
      }
      seen.add(request.source)
    }
  })

export const chatExtractionRequestSchema = z.object({
  transcript: z.array(chatMessageSchema).min(1).max(60),
  missingFields: z.array(z.string().max(40)).max(20).optional(),
  useAi: z.boolean().optional(),
})

export const applyIntakePatchSchema = z.object({
  disposition: z.enum(["KEEP_EXISTING", "ACCEPT_INCOMING", "KEEP_BOTH"]).optional(),
})

export const rejectIntakePatchSchema = z.object({
  reason: z.string().trim().max(500).optional(),
})

export const correctIntakePatchSchema = z.object({
  correction: patchCorrectionSchema,
  note: z.string().trim().max(1000).optional(),
})

export type CreateIntakeRunInput = z.infer<typeof createIntakeRunSchema>
export type IntakeSourceRequest = z.infer<typeof intakeSourceRequestSchema>
export type ChatExtractionRequest = z.infer<typeof chatExtractionRequestSchema>

/** Provenance is produced by adapters, not supplied by clients, but the apply
 * service re-validates it because it was persisted as JSON. */
export function parseProvenance(value: unknown): IntakeProvenance {
  return intakeProvenanceSchema.parse(value)
}

export function isContactField(value: string): value is ContactField {
  return contactFieldSchema.safeParse(value).success
}
