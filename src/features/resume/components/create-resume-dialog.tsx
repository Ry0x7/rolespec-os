"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Crosshair, FileStack, Plus } from "lucide-react"
import { createResume, createRoleFamilyResume } from "../actions"
import { createJobTailoredResume } from "../actions/tailor"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "@/shared/ui/dialog"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"

type Mode = "master" | "role-family" | "job-tailored"

interface SourceResumeOption {
  id: string
  title: string
  /** Master: target role. Role family: family name. Disambiguates same titles. */
  detail?: string | null
}

interface CreateResumeDialogProps {
  masterResumes: SourceResumeOption[]
  roleFamilies: Array<{ id: string; name: string }>
  roleFamilyResumes: SourceResumeOption[]
  jobApplications: Array<{ id: string; jobTitle: string; companyName: string }>
  /**
   * From `/resumes?tailorJobId=<id>`: opens straight into job-tailored mode
   * with this job preselected. Ignored when the id isn't one of `jobApplications`.
   */
  tailorJobId?: string
  /**
   * Job Detail opens this dialog in place for one job: job-tailored mode only,
   * no mode switching, and the job is fixed rather than picked from a list.
   */
  tailorOnly?: boolean
  /** Trigger copy. Defaults to "Create Resume". */
  triggerLabel?: string
  /**
   * Resumes already tailored to the fixed job. Shown as a notice so a returning
   * user opens the one they made instead of generating a near-duplicate.
   */
  existingTailoredResumes?: Array<{ id: string; title: string }>
  /** Opens the source Select on this resume; the user can still change it. */
  defaultSourceResumeId?: string
}

/** "Title — Master · Account Executive": kind, then detail when present. */
function sourceOptionLabel(resume: SourceResumeOption, kind: string): string {
  return `${resume.title} — ${kind}${resume.detail ? ` · ${resume.detail}` : ""}`
}

const HEADINGS: Record<Mode, { title: string; description: string }> = {
  master: {
    title: "Create a master resume",
    description:
      "Start with your confirmed career profile. You can tailor it later.",
  },
  "role-family": {
    title: "Create a role family resume",
    description: "Create a reusable variant for a group of similar roles.",
  },
  "job-tailored": {
    title: "Create a job tailored resume",
    description:
      "Copy an existing resume and tailor it to one tracked job application.",
  },
}

export function CreateResumeDialog({
  masterResumes,
  roleFamilies,
  roleFamilyResumes,
  jobApplications,
  tailorJobId,
  tailorOnly = false,
  triggerLabel,
  existingTailoredResumes = [],
  defaultSourceResumeId,
}: CreateResumeDialogProps) {
  const preselectedJobId = jobApplications.some((job) => job.id === tailorJobId)
    ? tailorJobId
    : undefined
  // In `tailorOnly` the job is fixed, so it is shown read-only and submitted
  // through a hidden field — a disabled Select would post nothing.
  const fixedJob = tailorOnly
    ? jobApplications.find((job) => job.id === preselectedJobId)
    : undefined
  // Only the `?tailorJobId=` deep link opens on mount; the in-place trigger
  // waits for the click that asked for it.
  const [open, setOpen] = useState(Boolean(preselectedJobId) && !tailorOnly)
  const [mode, setMode] = useState<Mode>(
    preselectedJobId ? "job-tailored" : "master"
  )
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(formData: FormData) {
    setError(null)
    setIsSubmitting(true)
    try {
      const result =
        mode === "master"
          ? await createResume(formData)
          : mode === "role-family"
            ? await createRoleFamilyResume(formData)
            : await createJobTailoredResume(formData)
      if (result?.error) setError(result.error)
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleClose() {
    setOpen(false)
    setMode(tailorOnly ? "job-tailored" : "master")
    setError(null)
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode)
    setError(null)
  }

  if (!open) {
    return tailorOnly ? (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
        {triggerLabel ?? "Tailor a resume"}
      </Button>
    ) : (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {triggerLabel ?? "Create Resume"}
      </Button>
    )
  }

  const roleFamilyUnavailable =
    masterResumes.length === 0 || roleFamilies.length === 0
  const jobTailoredUnavailable =
    (masterResumes.length === 0 && roleFamilyResumes.length === 0) ||
    jobApplications.length === 0

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="max-w-lg"
      aria-labelledby="create-resume-dialog-title"
    >
      <DialogHeader>
        <h2 id="create-resume-dialog-title" className="text-lg font-semibold">
          {HEADINGS[mode].title}
        </h2>
        <p className="text-sm text-muted-foreground">
          {HEADINGS[mode].description}
        </p>
      </DialogHeader>

      <form action={handleSubmit}>
        <DialogBody className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title">Resume Title</Label>
            <Input
              id="title"
              name="title"
              placeholder={
                mode === "master"
                  ? "e.g. Registered Nurse Resume"
                  : mode === "role-family"
                    ? "e.g. Platform Engineering Resume"
                    : "e.g. Acme Platform Engineer Resume"
              }
              required
              maxLength={100}
            />
          </div>

          {mode === "master" ? (
            <MasterFields
              onChooseRoleFamily={() => switchMode("role-family")}
              onChooseJobTailored={() => switchMode("job-tailored")}
            />
          ) : mode === "role-family" ? (
            <RoleFamilyFields
              masterResumes={masterResumes}
              roleFamilies={roleFamilies}
              onChooseMaster={() => switchMode("master")}
            />
          ) : (
            <JobTailoredFields
              masterResumes={masterResumes}
              roleFamilyResumes={roleFamilyResumes}
              jobApplications={jobApplications}
              preselectedJobId={preselectedJobId}
              fixedJob={fixedJob}
              defaultSourceResumeId={defaultSourceResumeId}
              existingTailoredResumes={
                fixedJob ? existingTailoredResumes : []
              }
              onChooseMaster={
                tailorOnly ? undefined : () => switchMode("master")
              }
            />
          )}

          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={
              (mode === "role-family" && roleFamilyUnavailable) ||
              (mode === "job-tailored" && jobTailoredUnavailable)
            }
          >
            {isSubmitting
              ? "Creating..."
              : mode === "master"
                ? "Create Master Resume"
                : mode === "role-family"
                  ? "Create Role Family Resume"
                  : "Create Job Tailored Resume"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

function MasterFields({
  onChooseRoleFamily,
  onChooseJobTailored,
}: {
  onChooseRoleFamily: () => void
  onChooseJobTailored: () => void
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="targetRole">Target Role (optional)</Label>
          <Input
            id="targetRole"
            name="targetRole"
            maxLength={100}
            placeholder="e.g. Account Executive"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="targetCompany">Target Company (optional)</Label>
          <Input
            id="targetCompany"
            name="targetCompany"
            maxLength={100}
            placeholder="e.g. Mercy General Hospital"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-sm font-medium">Building on an existing resume?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Reuse a master for a group of roles, or tailor one to a tracked job.
        </p>
        <div className="mt-1 flex flex-col items-start">
          <Button
            type="button"
            variant="link"
            className="h-auto justify-start p-0"
            onClick={onChooseRoleFamily}
          >
            <FileStack className="h-4 w-4" />
            Create a role family resume instead
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-auto justify-start p-0"
            onClick={onChooseJobTailored}
          >
            <Crosshair className="h-4 w-4" />
            Create a job tailored resume instead
          </Button>
        </div>
      </div>
    </>
  )
}

function RoleFamilyFields({
  masterResumes,
  roleFamilies,
  onChooseMaster,
}: {
  masterResumes: SourceResumeOption[]
  roleFamilies: Array<{ id: string; name: string }>
  onChooseMaster: () => void
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="sourceResumeId">Source master resume</Label>
        <Select
          id="sourceResumeId"
          name="sourceResumeId"
          defaultValue=""
          required
          disabled={masterResumes.length === 0}
          aria-describedby="source-resume-help"
        >
          <option value="" disabled>
            {masterResumes.length === 0
              ? "No master resumes available"
              : "Choose a master resume"}
          </option>
          {masterResumes.map((resume) => (
            <option key={resume.id} value={resume.id}>
              {sourceOptionLabel(resume, "Master")}
            </option>
          ))}
        </Select>
        <p id="source-resume-help" className="text-xs text-muted-foreground">
          Your master stays unchanged. Its factual content and template are copied.
        </p>
        {masterResumes.length === 0 && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Create a master resume first</p>
            <p className="mt-1 text-muted-foreground">
              A role family resume needs a factual master as its source.
            </p>
            <Button
              type="button"
              variant="link"
              className="mt-1 h-auto justify-start p-0"
              onClick={onChooseMaster}
            >
              Create a master resume
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="roleFamilyId">Role family</Label>
        <Select
          id="roleFamilyId"
          name="roleFamilyId"
          defaultValue=""
          required
          disabled={roleFamilies.length === 0}
          aria-describedby="role-family-help"
        >
          <option value="" disabled>
            {roleFamilies.length === 0
              ? "No role families available"
              : "Choose a role family"}
          </option>
          {roleFamilies.map((family) => (
            <option key={family.id} value={family.id}>
              {family.name}
            </option>
          ))}
        </Select>
        <p id="role-family-help" className="text-xs text-muted-foreground">
          Use this version across similar roles; tailor for a specific job later.
        </p>
        {roleFamilies.length === 0 && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Add a role family to continue</p>
            <p className="mt-1 text-muted-foreground">
              Group similar target roles in your Career Profile, then return here.
            </p>
            <Link
              href="/career-profile"
              className="mt-1 inline-flex rounded-sm text-sm font-medium text-brand-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open Career Profile
            </Link>
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        className="h-auto p-0"
        onClick={onChooseMaster}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to master resume
      </Button>
    </>
  )
}

function JobTailoredFields({
  masterResumes,
  roleFamilyResumes,
  jobApplications,
  preselectedJobId,
  fixedJob,
  defaultSourceResumeId,
  existingTailoredResumes,
  onChooseMaster,
}: {
  masterResumes: SourceResumeOption[]
  roleFamilyResumes: SourceResumeOption[]
  jobApplications: Array<{ id: string; jobTitle: string; companyName: string }>
  preselectedJobId?: string
  /** Set when the dialog was opened from one job: the job is not a choice. */
  fixedJob?: { id: string; jobTitle: string; companyName: string }
  defaultSourceResumeId?: string
  existingTailoredResumes: Array<{ id: string; title: string }>
  /** Omitted when mode switching is not offered. */
  onChooseMaster?: () => void
}) {
  const noSources = masterResumes.length === 0 && roleFamilyResumes.length === 0
  const tailoredCount = existingTailoredResumes.length
  const scopedJobId = fixedJob?.id ?? preselectedJobId

  return (
    <>
      {tailoredCount > 0 && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <p>
            You already have {tailoredCount} tailored{" "}
            {tailoredCount === 1 ? "resume" : "resumes"} for this job:{" "}
            {existingTailoredResumes.map((resume, index) => (
              <span key={resume.id}>
                {index > 0 && ", "}
                <Link
                  href={`/resumes/${resume.id}`}
                  className="rounded-sm text-brand-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {resume.title}
                </Link>
              </span>
            ))}
            .
          </p>
          <p className="mt-1 text-muted-foreground">
            Create another only if you need a different angle.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="sourceResumeId">Source resume</Label>
        <Select
          id="sourceResumeId"
          name="sourceResumeId"
          defaultValue={defaultSourceResumeId ?? ""}
          required
          disabled={noSources}
          aria-describedby="tailor-source-help"
        >
          <option value="" disabled>
            {noSources ? "No resumes available" : "Choose a resume to tailor"}
          </option>
          {masterResumes.map((resume) => (
            <option key={resume.id} value={resume.id}>
              {sourceOptionLabel(resume, "Master")}
            </option>
          ))}
          {roleFamilyResumes.map((resume) => (
            <option key={resume.id} value={resume.id}>
              {sourceOptionLabel(resume, "Role family")}
            </option>
          ))}
        </Select>
        <p id="tailor-source-help" className="text-xs text-muted-foreground">
          Your source stays unchanged. Its content is copied, then rephrased and
          reordered for this job — never expanded with new claims.
        </p>
        {noSources && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Create a master resume first</p>
            <p className="mt-1 text-muted-foreground">
              A job tailored resume needs a master or role family resume as its
              source.
            </p>
            {onChooseMaster ? (
              <Button
                type="button"
                variant="link"
                className="mt-1 h-auto justify-start p-0"
                onClick={onChooseMaster}
              >
                Create a master resume
              </Button>
            ) : (
              <Link
                // Keep the job this dialog was opened for, so /resumes reopens
                // tailoring for it once a master exists.
                href={
                  scopedJobId
                    ? `/resumes?tailorJobId=${encodeURIComponent(scopedJobId)}`
                    : "/resumes"
                }
                className="mt-1 inline-flex rounded-sm text-sm font-medium text-brand-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Go to resumes
              </Link>
            )}
          </div>
        )}
      </div>

      {fixedJob ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Job application
          </p>
          <p className="text-sm">
            {fixedJob.jobTitle} — {fixedJob.companyName}
          </p>
          <input type="hidden" name="jobApplicationId" value={fixedJob.id} />
          <p className="text-xs text-muted-foreground">
            The posting only guides emphasis and wording of your existing content.
          </p>
        </div>
      ) : (
      <div className="space-y-2">
        <Label htmlFor="jobApplicationId">Job application</Label>
        <Select
          id="jobApplicationId"
          name="jobApplicationId"
          defaultValue={preselectedJobId ?? ""}
          required
          disabled={jobApplications.length === 0}
          aria-describedby="job-application-help"
        >
          <option value="" disabled>
            {jobApplications.length === 0
              ? "No job applications available"
              : "Choose a job application"}
          </option>
          {jobApplications.map((job) => (
            <option key={job.id} value={job.id}>
              {job.jobTitle} — {job.companyName}
            </option>
          ))}
        </Select>
        <p id="job-application-help" className="text-xs text-muted-foreground">
          The posting only guides emphasis and wording of your existing content.
        </p>
        {jobApplications.length === 0 && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Track a job application to continue</p>
            <p className="mt-1 text-muted-foreground">
              Add the job to your tracker first, then return here to tailor.
            </p>
            <Link
              href="/jobs"
              className="mt-1 inline-flex rounded-sm text-sm font-medium text-brand-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open Job Tracker
            </Link>
          </div>
        )}
      </div>
      )}

      {onChooseMaster && (
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0"
          onClick={onChooseMaster}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to master resume
        </Button>
      )}
    </>
  )
}
