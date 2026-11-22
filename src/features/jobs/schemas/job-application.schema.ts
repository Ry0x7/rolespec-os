import { z } from "zod"
import {
  ApplicationStatus,
  JobType,
  SalaryCurrency,
  SalaryPeriod,
  WorkType,
} from "@/generated/prisma/enums"
import { parseCalendarDate } from "@/shared/lib/dates"
import { isHttpUrl } from "@/shared/lib/url"

/**
 * Pay capture is a range, a currency and a period — never one bare integer.
 *
 * A posting that says "₱30,000 – ₱45,000 per month" loses half its meaning the
 * moment it is stored as `45000`, and a figure with no currency cannot be
 * compared with anything. So the form sends three facts, the service normalizes
 * them once (`parseSalary`), and the row keeps both the original figures and
 * their annual equivalent.
 *
 * The caps mirror `Job.salaryMin/Max` (`DECIMAL(14,2)`: twelve integer digits).
 */

/** `DECIMAL(14,2)` — the largest amount the column can hold. */
const MAX_MONEY = 999_999_999_999.99

const optionalCalendarDate = z
  .string()
  .trim()
  .refine(
    (v) => v === "" || parseCalendarDate(v) !== null,
    "Enter a valid YYYY-MM-DD date"
  )
  .optional()

const optionalInstant = z
  .string()
  .trim()
  .refine(
    (v) => v === "" || !Number.isNaN(new Date(v).getTime()),
    "Enter a valid date and time"
  )
  .optional()

/** Empty means "not supplied", which is not the same as zero. */
function blankToUndefined(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed === "" ? undefined : trimmed
  }
  return value === null ? undefined : value
}

const optionalMoney = z.preprocess(
  blankToUndefined,
  z.coerce
    .number()
    .nonnegative("Pay cannot be negative")
    .max(MAX_MONEY, "Pay is too large")
    .optional()
)

/** Same as {@link optionalMoney}, but `""` survives as "clear this range". */
const clearableMoney = z
  .union([
    z.literal(""),
    z.coerce.number().nonnegative("Pay cannot be negative").max(MAX_MONEY, "Pay is too large"),
  ])
  .optional()

const optionalTermMonths = z.preprocess(
  blankToUndefined,
  z.coerce
    .number()
    .int("Contract length must be whole months")
    .min(1, "Contract length must be at least one month")
    .max(120, "Contract length must be 120 months or fewer")
    .optional()
)

interface SalaryShape {
  salaryMin?: number | ""
  salaryMax?: number | ""
  salaryPeriod?: SalaryPeriod | ""
  salaryTermMonths?: number
}

/**
 * Cross-field salary rules. Enforced on both create and update because a range
 * that is inverted is a typo the user wants told about, not silently reordered —
 * and a contract total without a length cannot be annualized at all.
 */
function checkSalaryRange(value: SalaryShape, ctx: z.RefinementCtx) {
  const min = typeof value.salaryMin === "number" ? value.salaryMin : undefined
  const max = typeof value.salaryMax === "number" ? value.salaryMax : undefined
  if (min !== undefined && max !== undefined && min > max) {
    ctx.addIssue({
      code: "custom",
      path: ["salaryMax"],
      message: "Maximum pay must be at least the minimum",
    })
  }
  if (value.salaryPeriod === SalaryPeriod.CONTRACT && value.salaryTermMonths === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["salaryTermMonths"],
      message: "Contract pay needs a contract length in months",
    })
  }
}

const createBase = z.object({
  companyName: z
    .string("Company name is required")
    .trim()
    .min(1, "Company name is required")
    .max(200, "Company name must be 200 characters or fewer"),
  jobTitle: z
    .string("Job title is required")
    .trim()
    .min(1, "Job title is required")
    .max(200, "Job title must be 200 characters or fewer"),
  status: z.nativeEnum(ApplicationStatus).default(ApplicationStatus.INTERESTED),
  jobLink: z
    .string()
    .trim()
    .max(2000, "Job link must be 2,000 characters or fewer")
    .refine((v) => v === "" || isHttpUrl(v), "Must be a valid http(s) URL")
    .optional(),
  contact: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
  jobType: z.nativeEnum(JobType).optional(),
  workType: z.nativeEnum(WorkType).optional(),
  salaryMin: optionalMoney,
  salaryMax: optionalMoney,
  /** ISO 4217 code, closed enum. Absent means "the posting did not say". */
  salaryCurrency: z.nativeEnum(SalaryCurrency).optional(),
  salaryPeriod: z.nativeEnum(SalaryPeriod).optional(),
  salaryTermMonths: optionalTermMonths,
  /** The posting's own salary line, kept verbatim for provenance. */
  salaryText: z.string().trim().max(500, "Salary note must be 500 characters or fewer").optional(),
  dateApplied: optionalCalendarDate,
  deadline: optionalCalendarDate,
  interviewDate: optionalInstant,
  followUpAt: optionalCalendarDate,
  jobDescription: z.string().max(20000).optional(),
  notes: z.string().max(5000).optional(),
  // The caller's own calendar day (`YYYY-MM-DD`), used to stamp `outcomeAt` when
  // the application is created directly at a terminal status. Same convention
  // as `updateJobApplicationStatus`'s `clientToday` — never persisted itself.
  clientToday: z.string().optional(),
})

export const createJobApplicationSchema = createBase.superRefine(checkSalaryRange)

const updateBase = createBase.partial().extend({
  status: z.nativeEnum(ApplicationStatus).optional(),
  // The inline table clears a cell by submitting "", which must stay
  // distinguishable from "field absent" so the action can write null.
  jobType: z.nativeEnum(JobType).optional().or(z.literal("")),
  workType: z.nativeEnum(WorkType).optional().or(z.literal("")),
  salaryMin: clearableMoney,
  salaryMax: clearableMoney,
  salaryCurrency: z.nativeEnum(SalaryCurrency).optional().or(z.literal("")),
  salaryPeriod: z.nativeEnum(SalaryPeriod).optional().or(z.literal("")),
  salaryText: z
    .union([z.literal(""), z.string().trim().max(500, "Salary note must be 500 characters or fewer")])
    .optional(),
})

export const updateJobApplicationSchema = updateBase.superRefine(checkSalaryRange)

export type CreateJobApplicationInput = z.infer<typeof createJobApplicationSchema>
export type UpdateJobApplicationInput = z.infer<typeof updateJobApplicationSchema>
