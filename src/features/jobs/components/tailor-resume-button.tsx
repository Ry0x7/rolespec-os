"use client"

import { CreateResumeDialog } from "@/features/resume/components/create-resume-dialog"
import type { ResumeSourceOptions } from "@/features/resume/services/resume-source-options"

interface Props extends ResumeSourceOptions {
  jobApplicationId: string
  jobTitle: string
  companyName: string
  /** Resumes already tailored to this application. Changes the label and
   * surfaces a notice; making another one stays allowed. */
  tailoredResumes: Array<{ id: string; title: string }>
  /** Opened-on source resume, from the shared tier-2 role-token rule. */
  defaultSourceResumeId?: string
}

/**
 * Tailoring starts where the job is, not on another page. Opens the same
 * `CreateResumeDialog` `/resumes?tailorJobId=` opens, already in job-tailored
 * mode with this job fixed, so the only decisions left are source and title.
 */
export function TailorResumeButton({
  jobApplicationId,
  jobTitle,
  companyName,
  tailoredResumes,
  defaultSourceResumeId,
  masterResumes,
  roleFamilies,
  roleFamilyResumes,
}: Props) {
  return (
    <CreateResumeDialog
      masterResumes={masterResumes}
      roleFamilies={roleFamilies}
      roleFamilyResumes={roleFamilyResumes}
      jobApplications={[{ id: jobApplicationId, jobTitle, companyName }]}
      tailorJobId={jobApplicationId}
      tailorOnly
      existingTailoredResumes={tailoredResumes}
      defaultSourceResumeId={defaultSourceResumeId}
      triggerLabel={
        tailoredResumes.length > 0 ? "Tailor another" : "Tailor a resume"
      }
    />
  )
}
