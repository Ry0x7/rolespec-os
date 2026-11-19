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

const MAX_INT4 = 2_147_483_647

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

export const createJobApplicationSchema = z.object({
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
  salary: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce
      .number()
      .int("Salary must be a whole number")
      .positive("Salary must be greater than 0")
      .max(MAX_INT4, "Salary is too large")
      .optional()
  ),
  salaryPeriod: z.nativeEnum(SalaryPeriod).optional(),
  salaryCurrency: z.nativeEnum(SalaryCurrency).optional(),
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

export const updateJobApplicationSchema = createJobApplicationSchema.partial().extend({
  status: z.nativeEnum(ApplicationStatus).optional(),
  // The inline table clears a cell by submitting "", which must stay
  // distinguishable from "field absent" so the action can write null.
  jobType: z.nativeEnum(JobType).optional().or(z.literal("")),
  workType: z.nativeEnum(WorkType).optional().or(z.literal("")),
  salary: z
    .union([
      z.literal(""),
      z.coerce
        .number()
        .int("Salary must be a whole number")
        .positive("Salary must be greater than 0")
        .max(MAX_INT4, "Salary is too large"),
    ])
    .optional(),
  salaryPeriod: z.nativeEnum(SalaryPeriod).optional().or(z.literal("")),
  // The currency column is non-null with a default, so there is nothing to
  // clear: an empty submission just means "leave it alone".
  salaryCurrency: z.nativeEnum(SalaryCurrency).optional().or(z.literal("")),
})

export type CreateJobApplicationInput = z.infer<typeof createJobApplicationSchema>
export type UpdateJobApplicationInput = z.infer<typeof updateJobApplicationSchema>
