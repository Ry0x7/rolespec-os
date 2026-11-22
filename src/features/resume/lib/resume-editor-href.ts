/**
 * `/resumes/:id`, optionally carrying the job application the user came from as
 * `?jobId=` so the editor keeps that job in context: the Job Target panel is
 * prefilled from it and the header offers the way back to it. Plain string
 * helper so server and client components share it.
 */
const SAFE_RESUME_ID = /^[A-Za-z0-9_-]+$/

export function resumeEditorHref(resumeId: string, jobId?: string | null): string {
  if (!SAFE_RESUME_ID.test(resumeId)) throw new Error("Invalid resume id")
  const id = encodeURIComponent(resumeId)
  return jobId
    ? `/resumes/${id}?jobId=${encodeURIComponent(jobId)}`
    : `/resumes/${id}`
}
