/**
 * Lightweight Suspense fallbacks for the dashboard command-center.
 * Pure presentational skeletons so server pages can stream the hero,
 * streak, and lists without blocking on stats queries.
 */
export function DashboardHeroSkeleton() {
  return (
    <section
      aria-label="Loading today's focus"
      aria-busy="true"
      className="rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <div className="h-4 w-48 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-6 w-64 animate-pulse rounded bg-muted" />
      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="h-[62px] animate-pulse rounded-md border border-border bg-muted/40"
          />
        ))}
      </ul>
    </section>
  )
}

export function DashboardCardSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading dashboard section"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-muted/60" />
      ))}
    </div>
  )
}

export function DashboardHomeSkeleton() {
  return (
    <div className="space-y-6">
      <DashboardHeroSkeleton />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DashboardCardSkeleton lines={3} />
        <DashboardCardSkeleton lines={5} />
      </div>
    </div>
  )
}
