import { z } from "zod"
import {
  CareerCapabilityDepth,
  CareerCapabilitySelfRating,
  CareerEvidenceKind,
  ExperienceLevel,
  SalaryCurrency,
  SalaryPeriod,
  WorkType,
} from "@/generated/prisma/enums"

/** `""` is how a `<select>`/`<input>` submits "no value"; it must clear, not fail. */
const emptyToUndefined = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v

const optionalId = z.string().min(1).max(64).optional()

const optionalPositiveInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().max(100_000_000).optional()
)

/**
 * A real calendar date, as `<input type="date">` submits it.
 *
 * The shape check alone is not enough: `new Date("2026-02-31")` silently rolls
 * forward to 2 March, so a forged value would have been *stored* rather than
 * rejected. Re-deriving the parts from a UTC date and requiring them to match
 * the input is what turns an impossible date into a validation error. UTC is
 * used because the column is `@db.Date` and must not shift by timezone.
 */
const calendarDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD format")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number)
    if (month < 1 || month > 12 || day < 1 || day > 31) return false
    const parsed = new Date(Date.UTC(year, month - 1, day))
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    )
  }, "That date does not exist")

/** An empty date field means "not stated" and must clear rather than fail. */
const optionalCalendarDate = z.union([z.literal(""), calendarDate]).optional()

/**
 * Preference/direction fields only. Durable facts are `CareerEvidence` and
 * skills are `CareerCapability`, so this schema deliberately accepts neither.
 */
export const updateCareerPreferencesSchema = z.object({
  experienceLevel: z.nativeEnum(ExperienceLevel).optional().or(z.literal("")),
  /** Newline-separated in the form; split and trimmed by the action. */
  locations: z.string().max(2000).optional(),
  openToRelocation: z
    .preprocess(
      (v) => v === true || v === "true" || v === "on",
      z.boolean()
    )
    .optional(),
  workModes: z.array(z.nativeEnum(WorkType)).max(3).optional(),
  workAuthorization: z.string().max(2000).optional(),
  /** Tri-state: "" leaves it unanswered. */
  requiresSponsorship: z.enum(["", "yes", "no"]).optional(),
  salaryMin: optionalPositiveInt,
  salaryMax: optionalPositiveInt,
  salaryPeriod: z.nativeEnum(SalaryPeriod).optional().or(z.literal("")),
  salaryCurrency: z.nativeEnum(SalaryCurrency).optional().or(z.literal("")),
  careerGoals: z.string().max(5000).optional(),
})

/**
 * A contact field that is allowed to be blank but must be well-formed once it
 * is not. The preprocess trims first so a field holding only spaces clears the
 * column instead of failing an email/URL check on whitespace.
 */
function optionalContactField<T extends z.ZodType<string>>(inner: T) {
  return z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.union([z.literal(""), inner]).optional()
  )
}

/**
 * The resume header block. Deliberately separate from the account: `User.email`
 * is the sign-in address, which is often not the address a candidate wants on a
 * resume. Every field is optional — an empty one clears rather than fails.
 */
export const updateContactInfoSchema = z.object({
  contactFullName: optionalContactField(z.string().max(200)),
  contactEmail: optionalContactField(
    z.string().email("Enter a valid email address").max(320)
  ),
  contactPhone: optionalContactField(z.string().max(50)),
  contactLocation: optionalContactField(z.string().max(200)),
  linkedinUrl: optionalContactField(z.string().url("Must be a valid URL").max(500)),
  githubUrl: optionalContactField(z.string().url("Must be a valid URL").max(500)),
  websiteUrl: optionalContactField(z.string().url("Must be a valid URL").max(500)),
})

export const createRoleFamilySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  notes: z.string().max(2000).optional(),
})

export const createTargetRoleSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  roleFamilyId: optionalId.or(z.literal("")),
  priority: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(999).optional()
  ),
})

/**
 * Creation is always a first-party statement by the signed-in user, so `source`
 * is not an input: the action pins it to USER_ENTERED. A
 * RESUME_IMPORT_CANDIDATE row can only be produced by a future import path, and
 * only ever as a CANDIDATE.
 */
export const createEvidenceSchema = z.object({
  kind: z.nativeEnum(CareerEvidenceKind),
  title: z.string().trim().min(1, "Title is required").max(200),
  organization: z.string().max(200).optional(),
  details: z.string().max(5000).optional(),
  outcome: z.string().max(2000).optional(),
  startDate: optionalCalendarDate,
  endDate: optionalCalendarDate,
})

/**
 * The same editable fields as creation, plus the row id. `source`, `status` and
 * `confirmedAt` are deliberately absent: an edit is a correction of what the
 * user already stated, so it must not change provenance or confirmation state.
 */
export const updateEvidenceSchema = createEvidenceSchema.extend({
  id: z.string().min(1, "Not found").max(64),
})

export const createCapabilitySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  category: z.string().max(120).optional(),
  selfAssessment: z
    .nativeEnum(CareerCapabilitySelfRating)
    .optional()
    .or(z.literal("")),
  notes: z.string().max(2000).optional(),
})

/**
 * Bulk entry. The action does the splitting/trimming/de-duplication; this only
 * validates the resulting list, with the same per-name cap as the single form.
 */
export const createCapabilitiesSchema = z.object({
  names: z
    .array(z.string().trim().min(1, "Name is required").max(120))
    .min(1, "Add at least one skill")
    .max(20, "Add at most 20 skills at a time"),
  /** Applied to every name in the batch — they came from one submission. */
  category: z.string().max(120).optional(),
  selfAssessment: z
    .nativeEnum(CareerCapabilitySelfRating)
    .optional()
    .or(z.literal("")),
})

export const linkEvidenceCapabilitySchema = z.object({
  evidenceId: z.string().min(1, "Pick a piece of evidence").max(64),
  capabilityId: z.string().min(1, "Pick a capability").max(64),
  depth: z.nativeEnum(CareerCapabilityDepth).default(CareerCapabilityDepth.WORKING),
  hasMeasuredOutcome: z
    .preprocess((v) => v === true || v === "true" || v === "on", z.boolean())
    .optional(),
  outcomeNote: z.string().max(2000).optional(),
  lastUsedAt: optionalCalendarDate,
})

export type UpdateCareerPreferencesInput = z.infer<typeof updateCareerPreferencesSchema>
export type UpdateContactInfoInput = z.infer<typeof updateContactInfoSchema>
export type CreateRoleFamilyInput = z.infer<typeof createRoleFamilySchema>
export type CreateTargetRoleInput = z.infer<typeof createTargetRoleSchema>
export type CreateEvidenceInput = z.infer<typeof createEvidenceSchema>
export type UpdateEvidenceInput = z.infer<typeof updateEvidenceSchema>
export type CreateCapabilityInput = z.infer<typeof createCapabilitySchema>
export type CreateCapabilitiesInput = z.infer<typeof createCapabilitiesSchema>
export type LinkEvidenceCapabilityInput = z.infer<typeof linkEvidenceCapabilitySchema>
