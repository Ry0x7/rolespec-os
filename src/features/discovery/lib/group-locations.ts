/**
 * Boards like Workday post one role once per location, so a Discover run comes
 * back with a run of near-identical rows: same title, same company, different
 * location. Grouping is a view choice applied after the filters — nothing is
 * dropped from the result and `dedupeKey()` is untouched, so every variant keeps
 * its own URL, Save state and actions once the group is expanded.
 *
 * The fold is deliberately narrow. Title-and-company alone is a weak identity:
 * a source that hides the employer behind a placeholder, or that reposts the
 * same role on a new date, would otherwise collapse unrelated jobs into one
 * row. So a posting is only ever folded when it contributes a location the
 * group has not shown yet, and a posting with a placeholder employer is never
 * folded at all.
 */

/**
 * The placeholder the OnlineJobs.ph adapter writes when a listing hides its
 * employer — see `UNDISCLOSED_EMPLOYER` in
 * `services/adapters/onlinejobs.adapter.ts`. Duplicated rather than imported so
 * this view helper does not pull a scraper adapter into the client bundle; the
 * helper test asserts the two stay in step.
 */
const PLACEHOLDER_COMPANY_NAMES = ["undisclosed employer"]

/** Trim, collapse inner whitespace, case-fold. */
function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase()
}

/** Trim and collapse inner whitespace, keeping the source's own casing. */
function displayLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

/**
 * True when a company name identifies nobody: blank, or a source's stand-in for
 * an employer it did not publish. Two postings that share such a name share
 * nothing, so they are never grouped.
 */
export function isPlaceholderCompany(name: string | null | undefined): boolean {
  const normalized = normalize(name)
  return normalized.length === 0 || PLACEHOLDER_COMPANY_NAMES.includes(normalized)
}

/** What makes two postings the same role: the title and the employer. */
function roleKey(item: { title: string; companyName: string }): string {
  return `${normalize(item.title)} ${normalize(item.companyName)}`
}

export interface RoleGroup<T> {
  /** The first member in input order — the row the list actually renders. */
  primary: T
  /** Every later member folded under it, in input order. */
  variants: T[]
}

/**
 * Fold postings that share a role key into one group each.
 *
 * Input order is preserved: a group appears where its first member appeared, and
 * that member is the primary. A later member of the same key is folded only when
 * it names a location that is non-empty and that neither the primary nor an
 * already-folded variant named. Anything else — a same-location repost, a
 * posting with no location, a posting whose employer is a placeholder — stays a
 * top-level row of its own.
 */
export function groupCandidatesByRole<
  T extends { title: string; companyName: string; location?: string | null },
>(items: T[]): Array<RoleGroup<T>> {
  const groups: Array<RoleGroup<T>> = []
  const byKey = new Map<string, { group: RoleGroup<T>; locations: Set<string> }>()

  for (const item of items) {
    if (isPlaceholderCompany(item.companyName)) {
      groups.push({ primary: item, variants: [] })
      continue
    }

    const key = roleKey(item)
    const location = normalize(item.location)
    const existing = byKey.get(key)

    if (existing) {
      if (location && !existing.locations.has(location)) {
        existing.locations.add(location)
        existing.group.variants.push(item)
      } else {
        // A repost or a locationless twin, not a location variant: its own row.
        groups.push({ primary: item, variants: [] })
      }
      continue
    }

    const group: RoleGroup<T> = { primary: item, variants: [] }
    byKey.set(key, { group, locations: new Set(location ? [location] : []) })
    groups.push(group)
  }

  return groups
}

/**
 * The locations named under a primary row: one per variant, in input order.
 * `groupCandidatesByRole` only folds a variant that brings a new, non-empty
 * location, so this is a straight read of the variants — the guard below only
 * holds for a group assembled some other way.
 */
export function variantLocationLabels<
  T extends { title: string; companyName: string; location?: string | null },
>(group: RoleGroup<T>): string[] {
  const seen = new Set<string>([normalize(group.primary.location)])
  const labels: string[] = []

  for (const variant of group.variants) {
    const normalized = normalize(variant.location)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    labels.push(displayLabel(variant.location as string))
  }

  return labels
}
