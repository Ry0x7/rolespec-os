"use client"

import { useState, useTransition } from "react"
import { useResumeStore } from "../hooks/use-resume-store"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { Briefcase } from "lucide-react"
import { MAX_ATS_JOB_DESCRIPTION_LENGTH } from "../constants/ats"
import { getJobDescriptionForResume } from "../actions/get-job-description"

/** Saved job applications the editor can pull a job description from. */
export interface JobOption {
  id: string
  companyName: string
  jobTitle: string
  hasJobDescription: boolean
}

interface Props {
  jobOptions?: JobOption[]
  /**
   * From `/resumes/[id]?jobId=`. `ResumeEditor` (always mounted) already
   * fetched and stored that job's description once on mount — this panel
   * only uses it to preselect the picker, since the panel itself now mounts
   * only while the drawer is open and must not re-fetch on every open.
   */
  initialJobId?: string
  /** Drop the card chrome when embedded inside a drawer that already supplies it. */
  bare?: boolean
}

export function JobTargetPanel({ jobOptions, initialJobId, bare }: Props) {
  const resume = useResumeStore((s) => s.resume)
  const jobDescription = useResumeStore((s) => s.jobDescription)
  const setJobDescription = useResumeStore((s) => s.setJobDescription)

  const [selectedJobId, setSelectedJobId] = useState(initialJobId ?? "")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function loadJobDescription(jobApplicationId: string) {
    setLoadError(null)
    startTransition(async () => {
      const result = await getJobDescriptionForResume(jobApplicationId)
      if ("error" in result) {
        setLoadError(result.error)
        return
      }
      setJobDescription(result.jobDescription)
    })
  }

  const charCount = jobDescription.length
  const isNearLimit = charCount >= MAX_ATS_JOB_DESCRIPTION_LENGTH * 0.9

  return (
    // Bare mode is the drawer: become a flex column so the description field
    // can absorb the leftover height instead of leaving dead space under a
    // fixed-height textarea. `flex-1`/`min-h-0` are inert in the block-layout
    // card variant, so that context keeps its previous stacked sizing.
    <div
      className={
        bare
          ? "flex min-h-0 flex-1 flex-col gap-3"
          : "rounded-lg border border-border bg-card p-4 space-y-3"
      }
    >
      <div className="flex shrink-0 items-center gap-2">
        <Briefcase className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Job Target</span>
        {resume?.targetRole && (
          <span className="text-xs text-muted-foreground">
            &mdash; {resume.targetRole}
          </span>
        )}
      </div>

      {jobOptions && jobOptions.length > 0 && (
        <div className="shrink-0 space-y-1.5">
          <Label htmlFor="job-target-saved-job">Load from saved job</Label>
          <Select
            id="job-target-saved-job"
            value={selectedJobId}
            disabled={isPending}
            onChange={(e) => {
              const id = e.target.value
              setSelectedJobId(id)
              if (!id) {
                setLoadError(null)
                return
              }
              loadJobDescription(id)
            }}
          >
            <option value="">Paste manually or pick a job…</option>
            {jobOptions.map((job) => (
              <option key={job.id} value={job.id} disabled={!job.hasJobDescription}>
                {`${job.jobTitle} — ${job.companyName}${
                  job.hasJobDescription ? "" : " (no description)"
                }`}
              </option>
            ))}
          </Select>
          {loadError && <p className="text-[11px] text-error">{loadError}</p>}
        </div>
      )}

      <div
        className={bare ? "flex min-h-0 flex-1 flex-col space-y-1.5" : "space-y-1.5"}
      >
        <Label htmlFor="job-description" className="shrink-0">
          Job Description
        </Label>
        <textarea
          id="job-description"
          value={jobDescription}
          onChange={(e) => {
            // A manual edit means the text no longer mirrors the picked job.
            if (selectedJobId) setSelectedJobId("")
            setLoadError(null)
            setJobDescription(e.target.value)
          }}
          maxLength={MAX_ATS_JOB_DESCRIPTION_LENGTH}
          placeholder="Paste the job listing here — ATS analysis scores your resume against it..."
          // `rows` was 5 back when this panel sat inline in the editor column
          // and every row cost the section list vertical space. It holds up to
          // 20,000 characters of pasted listing, so it gets real room.
          //
          // In the drawer (`bare`) it grows to whatever height is left over
          // rather than a fixed one, so there is no dead space under it and no
          // second inner scrollbar competing with the drawer body; `rows` is
          // then only the intrinsic floor, reinforced by `min-h`. Outside the
          // drawer the old fixed sizing (plus `resize-y`) is kept, since a
          // block-layout parent has no leftover height to hand down.
          rows={12}
          className={`w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
            bare
              ? "min-h-[12rem] flex-1"
              : "min-h-[18rem] resize-y lg:min-h-[45vh]"
          }`}
        />
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-[11px] text-muted-foreground">
            Required for Analyze — keyword scoring is measured against this text.
          </p>
          <p
            className={`text-xs ${isNearLimit ? "text-amber-500" : "text-muted-foreground"}`}
          >
            {charCount}/{MAX_ATS_JOB_DESCRIPTION_LENGTH}
          </p>
        </div>
      </div>
    </div>
  )
}
