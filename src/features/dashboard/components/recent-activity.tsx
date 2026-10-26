import { memo } from "react"
import Link from "next/link"
import { Activity } from "lucide-react"
import { Card } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"

export interface ActivityItem {
  id: string
  title: string
  subtitle?: string
  /** Preformatted by the server ("2h ago", "Yesterday") — no date math in UI. */
  timeLabel: string
  href?: string
}

/**
 * Recent activity feed for the OS home. Presentational: the server builds the
 * items from applications, todos and notes so this list never queries Prisma.
 */
const ActivityRow = memo(function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {item.href ? (
          <Link href={item.href} className="block truncate text-sm font-medium hover:underline">
            {item.title}
          </Link>
        ) : (
          <p className="truncate text-sm font-medium">{item.title}</p>
        )}
        {item.subtitle && (
          <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
        )}
      </div>
      <p className="shrink-0 text-xs text-muted-foreground">{item.timeLabel}</p>
    </li>
  )
})

export function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Recent activity</h2>
      {items.length === 0 ? (
        <EmptyState
          variant="bare"
          icon={Activity}
          title="Nothing yet"
          description="Applications, tasks and notes will show up here."
        />
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Card>
  )
}
