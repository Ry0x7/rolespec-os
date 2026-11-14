import { memo, useMemo } from "react"
import Link from "next/link"
import { BellRing, CalendarClock, CalendarDays, CheckSquare } from "lucide-react"
import { EmptyState } from "@/shared/components/empty-state"
import { cn } from "@/shared/lib/utils"
import { calendarDayStart, toCalendarDateString } from "@/shared/lib/dates"
import { QuickActionButtons } from "@/features/jobs/components/quick-action-buttons"
import { jobDetailHref } from "@/features/jobs/lib/job-detail-href"
import { FOLLOW_UP_DUE_ACTIONS } from "@/features/jobs/services/application-quick-actions"
import { TodoDoneToggle } from "./todo-done-toggle"
import { todoIdFromAgendaKey } from "../services/agenda-key"
import type { AgendaItem, AgendaItemType } from "../services/calendar.service"

const TYPE_CONFIG: Record<
  AgendaItemType,
  { className: string; label: string; icon: typeof CalendarClock }
> = {
  interview: {
    className:
      "bg-amber-600/10 text-amber-700 border-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
    label: "Interview",
    icon: CalendarClock,
  },
  deadline: {
    className:
      "bg-red-600/10 text-red-700 border-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
    label: "Deadline",
    icon: CalendarDays,
  },
  "follow-up": {
    className:
      "bg-violet-600/10 text-violet-700 border-violet-600/20 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20",
    label: "Follow up",
    icon: BellRing,
  },
  todo: {
    className:
      "bg-blue-600/10 text-blue-700 border-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20",
    label: "Todo",
    icon: CheckSquare,
  },
}

const TypeBadge = memo(function TypeBadge({ type }: { type: AgendaItemType }) {
  const config = TYPE_CONFIG[type]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        config.className
      )}
    >
      {config.label}
    </span>
  )
})

// Pinned to UTC and fed an anchor from `dayAnchor`, so the day an item is filed
// under and the day its heading prints are decided in exactly one place.
const dayHeadingFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})
const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
})

/**
 * The day an item belongs on, as a UTC midnight. Deadlines, follow-ups and todo
 * due dates are calendar dates already stored that way; an interview is a real
 * instant, so it files under the day it falls on for the reader.
 */
function dayAnchor(item: AgendaItem): Date {
  return item.type === "interview"
    ? calendarDayStart(item.date, item.date.getTimezoneOffset())
    : calendarDayStart(item.date)
}

const ROW_CLASS =
  "flex items-start gap-3 rounded-lg border border-border bg-card p-3"

/**
 * One agenda entry. Anything hanging off an application is a link to it —
 * seeing that a follow-up is due is only useful if you can go act on it.
 *
 * A follow-up and a todo can be acted on from here as well, so those two rows
 * drop the whole-row link and put it on the title instead: a button inside an
 * anchor is neither valid nor clickable in the way the user means.
 */
const AgendaRow = memo(function AgendaRow({ item }: { item: AgendaItem }) {
  const actions =
    item.type === "follow-up" && item.jobApplicationId ? (
      <QuickActionButtons
        applicationId={item.jobApplicationId}
        companyName={item.company ?? item.title}
        actions={FOLLOW_UP_DUE_ACTIONS}
        className="h-7 px-2 text-xs"
      />
    ) : null

  if (item.type === "todo") {
    return (
      <div className={ROW_CLASS}>
        <TodoDoneToggle
          todoId={todoIdFromAgendaKey(item.key)}
          title={item.title}
          done={item.done ?? false}
        />
        <AgendaRowBody item={item} linkTitle />
      </div>
    )
  }

  if (actions) {
    return (
      <div className={ROW_CLASS}>
        <AgendaRowBody item={item} linkTitle />
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    )
  }

  return <PlainAgendaRow item={item} />
})

/**
 * Follow-ups and interviews are Track work, so they land on Job Detail's Track
 * section; deadlines and todos have no single section and open the page top.
 */
function agendaJobHref(jobApplicationId: string, type: AgendaItemType): string {
  return type === "follow-up" || type === "interview"
    ? jobDetailHref(jobApplicationId, "track")
    : jobDetailHref(jobApplicationId)
}

/**
 * The icon, title, badge and meta line. `linkTitle` moves the link off the row
 * and onto the title, for the rows that carry their own controls.
 */
function AgendaRowBody({ item, linkTitle }: { item: AgendaItem; linkTitle?: boolean }) {
  const Icon = TYPE_CONFIG[item.type].icon
  const titleClass = cn(
    "text-sm font-medium truncate",
    item.type === "todo" && item.done && "text-muted-foreground line-through"
  )

  return (
    <>
      {item.type !== "todo" && (
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {linkTitle && item.jobApplicationId ? (
            <Link
              href={agendaJobHref(item.jobApplicationId, item.type)}
              className={cn(titleClass, "hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            >
              {item.title}
            </Link>
          ) : (
            <p className={titleClass}>{item.title}</p>
          )}
          <TypeBadge type={item.type} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {item.company && <span>{item.company}</span>}
          {item.type === "interview" && <span>{timeFmt.format(item.date)}</span>}
          {item.overdue && (
            <span className="text-error">
              Was due {dayHeadingFmt.format(dayAnchor(item))}
            </span>
          )}
        </div>
      </div>
    </>
  )
}

/** A row with nothing to press: the whole row is the link, as it always was. */
function PlainAgendaRow({ item }: { item: AgendaItem }) {
  if (!item.jobApplicationId) {
    return (
      <div className={ROW_CLASS}>
        <AgendaRowBody item={item} />
      </div>
    )
  }

  return (
    <Link
      href={agendaJobHref(item.jobApplicationId, item.type)}
      className={cn(
        ROW_CLASS,
        "transition-colors hover:border-brand-500/40 hover:bg-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <AgendaRowBody item={item} />
    </Link>
  )
}

interface CalendarAgendaProps {
  items: AgendaItem[]
}

export function CalendarAgenda({ items }: CalendarAgendaProps) {
  // Anything already past is pulled out of the day grouping and stacked at the
  // top — a date heading in the past reads as history, not as a thing to do.
  // Memoized so re-renders from todo toggles don't regroup the whole agenda.
  // Hooks stay above the empty-state return so every render calls them in order.
  const { overdueItems, groups } = useMemo(() => {
    const overdue = items.filter((item) => item.overdue)
    const scheduled = items.filter((item) => !item.overdue)
    const grouped: { key: string; date: Date; items: AgendaItem[] }[] = []
    for (const item of scheduled) {
      const anchor = dayAnchor(item)
      const key = toCalendarDateString(anchor)
      const last = grouped[grouped.length - 1]
      if (last && last.key === key) {
        last.items.push(item)
      } else {
        grouped.push({ key, date: anchor, items: [item] })
      }
    }
    return { overdueItems: overdue, groups: grouped }
  }, [items])

  if (items.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing scheduled"
        description="Interview dates, deadlines, and todo due dates for the next 30 days will show up here."
      />
    )
  }

  return (
    <div className="space-y-6">
      {overdueItems.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-error">Overdue</h3>
          <div className="space-y-2">
            {overdueItems.map((item) => (
              <AgendaRow key={item.key} item={item} />
            ))}
          </div>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.key} className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {dayHeadingFmt.format(group.date)}
          </h3>
          <div className="space-y-2">
            {group.items.map((item) => (
              <AgendaRow key={item.key} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
