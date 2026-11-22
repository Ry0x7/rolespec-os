/**
 * The stable key for a saved job.
 *
 * Canonical URL when the saved posting has one (so feedback recorded during
 * discovery carries over), otherwise the saved job id. The URL column is not a
 * fallback: it can change or be an index page, while the id never moves.
 */
export function savedJobFeedbackKey(job: {
  id: string
  canonicalUrl?: string | null
}): string {
  return job.canonicalUrl?.trim() || job.id
}
