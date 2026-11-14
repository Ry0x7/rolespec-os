/**
 * The application's stored resume choice, but only when that resume is still
 * one the user can actually use.
 *
 * `JobApplication.resumeId` outlives the resume it points at: Product Delete on
 * a resume archives it (so `restoreResume` can undo it) and deliberately leaves
 * the FK intact. Every read surface loads resumes with `status: { not:
 * "ARCHIVED" }`, so an archived choice is a live id that is absent from the
 * list — and treating it as "chosen" made Job Detail select nothing while
 * suppressing the recommendation every panel would otherwise fall back to.
 *
 * Pure, so the page can apply it once to the list it already loaded and pass
 * the result to every consumer instead of each one re-checking.
 */
export function resolveChosenResumeId(
  resumes: { id: string }[],
  resumeId: string | null | undefined,
): string | null {
  if (!resumeId) return null
  return resumes.some((resume) => resume.id === resumeId) ? resumeId : null
}
