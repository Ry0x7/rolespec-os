import type { ApplicationStatus } from "@/generated/prisma/enums"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { formatDate, formatDateTime } from "@/shared/lib/utils"
import { STATUS_LABELS } from "../constants/status-labels"

export interface ApplicationStatusTimelineEvent {
  id: string
  fromStatus: ApplicationStatus | null
  toStatus: ApplicationStatus
  note: string | null
  source: string
  createdAt: Date
}

interface ApplicationStatusTimelineProps {
  events: ApplicationStatusTimelineEvent[]
  /** When tracking began, used only for the empty state. */
  trackingStartedAt: Date
}

function sourceLabel(source: string): string {
  switch (source) {
    case "MIGRATION":
      return "Starting point recorded from the existing application"
    case "EXTENSION":
      return "Moved from the browser extension"
    default:
      return "Moved by you"
  }
}

/**
 * Read-only history of an application's pipeline moves. The current status is
 * already the header badge; this answers the different question of how it got
 * there, including a note attached at the time of the move.
 */
export function ApplicationStatusTimeline({
  events,
  trackingStartedAt,
}: ApplicationStatusTimelineProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Status history</CardTitle>
        <CardDescription>
          Every move this application has made, oldest first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tracking started {formatDate(trackingStartedAt)}. Status changes will
            appear here as you move this application.
          </p>
        ) : (
          <ol aria-label="Application status history" className="space-y-0">
            {events.map((event, index) => {
              const last = index === events.length - 1
              return (
                <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {!last && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[7px] top-4 h-full w-px bg-border"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={
                      last
                        ? "mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-brand-500 bg-background"
                        : "mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-border bg-background"
                    }
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {event.fromStatus
                        ? `${STATUS_LABELS[event.fromStatus]} → ${STATUS_LABELS[event.toStatus]}`
                        : `Tracking started · ${STATUS_LABELS[event.toStatus]}`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <time dateTime={event.createdAt.toISOString()}>
                        {formatDateTime(event.createdAt)}
                      </time>
                      {" · "}
                      {sourceLabel(event.source)}
                    </p>
                    {event.note && (
                      <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">
                        {event.note}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
