import { PageShell } from "@/shared/components/page-shell"
import { Skeleton } from "@/shared/ui/skeleton"

/**
 * Shared route skeleton. It uses `PageShell` so the content column is already at
 * its final width while the page streams — the old max-w-5xl version snapped to
 * a different width on every navigation.
 */
export default function Loading() {
  return (
    <PageShell>
      <div aria-busy="true" className="space-y-6">
        {/* Page header: title + supporting line, matching the h1/p pair every
            route under (app) opens with. */}
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>

        {/* Content blocks at the card rhythm rather than three identical slabs. */}
        <Skeleton className="h-24 w-full rounded-lg" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-48 w-full rounded-lg lg:col-span-2" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>
    </PageShell>
  )
}
