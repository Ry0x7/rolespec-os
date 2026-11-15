import { z } from "zod"
import {
  ApplicationStatus,
  JobType,
  SalaryCurrency,
  SalaryPeriod,
  WorkType,
} from "@/generated/prisma/enums"

export const createJobApplicationSchema = z.object({
  companyName: z.string().min(1, "Company name is required").max(200),
  jobTitle: z.string().min(1, "Job title is required").max(200),
  status: z.nativeEnum(ApplicationStatus).default(ApplicationStatus.INTERESTED),
  jobLink: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  contact: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
  jobType: z.nativeEnum(JobType).optional(),
  workType: z.nativeEnum(WorkType).optional(),
  salary: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().positive().optional()
  ),
  salaryPeriod: z.nativeEnum(SalaryPeriod).optional(),
  salaryCurrency: z.nativeEnum(SalaryCurrency).optional(),
  dateApplied: z.string().optional(),
  deadline: z.string().optional(),
  interviewDate: z.string().optional(),
  followUpAt: z.string().optional(),
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
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional(),
  salaryPeriod: z.nativeEnum(SalaryPeriod).optional().or(z.literal("")),
  // The currency column is non-null with a default, so there is nothing to
  // clear: an empty submission just means "leave it alone".
  salaryCurrency: z.nativeEnum(SalaryCurrency).optional().or(z.literal("")),
})

export type CreateJobApplicationInput = z.infer<typeof createJobApplicationSchema>
export type UpdateJobApplicationInput = z.infer<typeof updateJobApplicationSchema>
