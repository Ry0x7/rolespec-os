/**
 * "Posted within" is a client-side freshness filter on Discover. It is a view
 * choice, not a search parameter: no adapter is asked for a narrower window, so
 * nothing is re-fetched and nothing about the choice is stored.
 */

export const POSTED_WITHIN_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "3", label: "Last 3 days" },
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
] as const

export type PostedWithin = (typeof POSTED_WITHIN_OPTIONS)[number]["value"]

const DAY_MS = 86_400_000

/**
 * Whether a posting falls inside the chosen window. A posting with no usable
 * date is NOT inside any window — some sources (BambooHR/Freshteam list mode)
 * never publish one, so the caller has to say how many it hid rather than let
 * them vanish.
 */
export function isPostedWithin(
  postedAt: string | Date | null | undefined,
  window: PostedWithin,
  now: Date = new Date()
): boolean {
  if (window === "any") return true
  if (!postedAt) return false

  const posted = postedAt instanceof Date ? postedAt : new Date(postedAt)
  const time = posted.getTime()
  if (Number.isNaN(time)) return false

  // A future date counts as within: it is fresher than now, not older.
  return now.getTime() - time <= Number(window) * DAY_MS
}
