import type {
  ApplicationStatus,
  JobType,
  SalaryCurrency,
  SalaryPeriod,
  WorkType,
} from "@/generated/prisma/enums"

/**
 * The flat, form-shaped view of an application. Its field names are the
 * `FormData` keys `createJobApplication` / `updateJobApplication` understand,
 * so this shape stays flat even though the posting data itself now lives on
 * the `Job` relation — the create/edit form and the detail header work off it.
 */
export interface JobFormApplication {
  id: string
  companyName: string
  jobTitle: string
  status: ApplicationStatus
  location: string | null
  salary: number | null
  salaryPeriod: SalaryPeriod | null
  salaryCurrency: SalaryCurrency
  dateApplied: Date | null
  deadline: Date | null
  interviewDate: Date | null
  followUpAt: Date | null
  jobLink: string | null
  contact: string | null
  jobDescription: string | null
  notes: string | null
  jobType: JobType | null
  workType: WorkType | null
}
