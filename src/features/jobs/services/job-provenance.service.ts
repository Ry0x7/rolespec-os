import { providerLabel } from "@/features/discovery/constants/providers"
import type { JobSource } from "@/generated/prisma/enums"
import { formatDate } from "@/shared/lib/utils"

/**
 * One muted line saying where a posting came from and how old it is —
 * "Kalibrr · Posted Sep 8, 2026", "Added manually · Posting date unknown ·
 * Seen Sep 1, 2026".
 *
 * Extracted from the job detail page so the tracker cards say it in exactly the
 * same words. Server-safe: no client module is imported, so a server component
 * reading it gets the string rather than a client reference proxy.
 */

/**
 * How a job with no recorded provider describes where it came from. The provider
 * label is the stronger statement; this keeps a manual or extension-captured job
 * from claiming a provider it never had.
 */
const SOURCE_FALLBACK_LABEL: Record<JobSource, string> = {
  MANUAL: "Added manually",
  EXTENSION: "Captured from browser",
  DISCOVERY: "From discovery",
}

export interface JobProvenanceInput {
  /** Discovery source adapter id, when the posting came from a discovery run. */
  sourceProvider: string | null
  source: JobSource
  /** The employer's own posting date, when it is known. */
  postedAt: Date | null
  /** When discovery first saw it; falls back to the `Job` row's own stamp. */
  discoveredAt: Date | null
  /** `Job.createdAt` — the fallback for `discoveredAt`. */
  jobCreatedAt: Date
  /** `JobApplication.createdAt` — the day the user saved it. */
  savedAt: Date
}

export interface JobProvenanceOptions {
  /**
   * Whether to end with the "Saved <date>" segment. Defaults to true; the
   * `/jobs` card turns it off because its footer already says when it was saved.
   */
  includeSaved?: boolean
}

export function describeJobProvenance(
  input: JobProvenanceInput,
  { includeSaved = true }: JobProvenanceOptions = {},
): string {
  const sourceLabel = input.sourceProvider
    ? providerLabel(input.sourceProvider)
    : SOURCE_FALLBACK_LABEL[input.source]

  // "Posted" only when the employer's own date is known. Otherwise say the
  // posting date is unknown and give the date we do have, in the same words the
  // confidence signal uses — saying only "Seen" read as a posting date.
  const seenAt = input.postedAt ? null : (input.discoveredAt ?? input.jobCreatedAt)
  const postingDateLine = input.postedAt
    ? `Posted ${formatDate(input.postedAt)}`
    : `Posting date unknown · Seen ${formatDate(input.discoveredAt ?? input.jobCreatedAt)}`

  // "Saved" is dropped when it would repeat the date just given.
  const savedLine = `Saved ${formatDate(input.savedAt)}`
  return [
    sourceLabel,
    postingDateLine,
    ...(!includeSaved || (seenAt && formatDate(seenAt) === formatDate(input.savedAt))
      ? []
      : [savedLine]),
  ].join(" · ")
}
