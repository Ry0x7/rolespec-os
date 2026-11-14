import type { ResumeSummary } from "./types"

/** The empty value both resume pickers start on: "let the server pick the newest". */
export const LATEST_RESUME_VALUE = ""

/**
 * Label for one option. The ATS score is what tells two similarly named resumes apart,
 * so it rides along when the server has one; an untitled resume still gets a label.
 */
export function resumeOptionLabel(resume: ResumeSummary): string {
  const title = resume.title.trim() || "Untitled resume"
  return resume.atsScore === null ? title : `${title} — ATS ${resume.atsScore}`
}

/**
 * The selection to restore after refilling a picker. A resume that is gone from the new
 * list (archived, deleted, or a different account) falls back to "Latest resume" rather
 * than leaving a value the select cannot show.
 */
export function preservedSelection(current: string, resumes: ResumeSummary[]): string {
  if (!current) return LATEST_RESUME_VALUE
  return resumes.some((resume) => resume.id === current) ? current : LATEST_RESUME_VALUE
}
