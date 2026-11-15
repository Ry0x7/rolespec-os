/**
 * `/resumes/:id`, optionally carrying the job application the user came from as
 * `?jobId=` so the editor keeps that job in context: the Job Target panel is
 * prefilled from it and the header offers the way back to it. Plain string
 * helper so server and client components share it.
 */
export function resumeEditorHref(resumeId: string, jobId?: string | null): string {
  return jobId
    ? `/resumes/${resumeId}?jobId=${encodeURIComponent(jobId)}`
    : `/resumes/${resumeId}`
}
