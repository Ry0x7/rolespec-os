"use client"

import { useDroppable } from "@dnd-kit/core"
import { cn } from "@/shared/lib/utils"
import type { ApplicationStatus } from "@/generated/prisma/enums"
import type { WorkspaceJobRow } from "../workspace-board"
import { KanbanColumn, STATUS_LABELS } from "./kanban-column"

/**
 * Drop-target ids for the phone status chips. The board recognises this prefix
 * and moves the card to the status it names; desktop columns keep using the
 * bare status as their droppable id.
 */
export const MOBILE_STATUS_TARGET_PREFIX = "mobile-status:"

/** Light-first dots, matching `KanbanColumn` so one status reads the same way. */
const STATUS_DOT: Record<ApplicationStatus, string> = {
  INTERESTED: "bg-blue-600 dark:bg-blue-400",
  APPLIED: "bg-violet-600 dark:bg-violet-400",
  SCREENING: "bg-cyan-600 dark:bg-cyan-400",
  INTERVIEW: "bg-amber-600 dark:bg-amber-400",
  OFFER: "bg-green-600 dark:bg-green-400",
  REJECTED: "bg-red-600 dark:bg-red-400",
  WITHDRAWN: "bg-muted-foreground",
}

function MobileStatusChip({
  status,
  count,
  active,
  onSelect,
}: {
  status: ApplicationStatus
  count: number
  active: boolean
  onSelect: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${MOBILE_STATUS_TARGET_PREFIX}${status}`,
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-pressed={active}
      aria-controls="kanban-mobile-panel"
      onClick={onSelect}
      className={cn(
        "flex min-h-9 min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary/50 bg-primary/10 font-medium text-foreground"
          : "border-border bg-background/60 text-muted-foreground hover:text-foreground",
        isOver && "border-primary bg-primary/15 ring-2 ring-primary/30"
      )}
      title={isOver ? `Move to ${STATUS_LABELS[status]}` : STATUS_LABELS[status]}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[status])}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{STATUS_LABELS[status]}</span>
      <span
        className={cn(
          "shrink-0 rounded-full px-1.5 text-[10px] tabular-nums",
          active ? "bg-primary/15 text-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {count}
      </span>
    </button>
  )
}

/**
 * Below `xl` the seven 240px-wide columns cannot fit, and sideways scrolling a
 * tracker is how columns get lost. The phone board instead stacks the statuses
 * into one wrapping navigator: exactly one status list is visible, and every
 * chip doubles as a drop target so a held card can still be dragged onto
 * "Interview" without a sideways scroll. The per-card status select remains the
 * reliable non-drag fallback.
 */
export function KanbanMobileBoard({
  statuses,
  jobsByStatus,
  activeStatus,
  onSelectStatus,
  selectedIds,
  onToggleSelect,
}: {
  statuses: ApplicationStatus[]
  jobsByStatus: Map<ApplicationStatus, WorkspaceJobRow[]>
  activeStatus: ApplicationStatus
  onSelectStatus: (status: ApplicationStatus) => void
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
}) {
  const activeJobs = jobsByStatus.get(activeStatus) ?? []
  const total = statuses.reduce((sum, status) => sum + (jobsByStatus.get(status)?.length ?? 0), 0)

  return (
    <div data-kanban-mobile className="space-y-2">
      <div
        role="group"
        aria-label="Application statuses"
        className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-7"
      >
        {statuses.map((status) => (
          <MobileStatusChip
            key={status}
            status={status}
            count={jobsByStatus.get(status)?.length ?? 0}
            active={status === activeStatus}
            onSelect={() => onSelectStatus(status)}
          />
        ))}
      </div>

      <p className="px-0.5 text-[11px] text-muted-foreground">
        Tap a status to switch. Press and hold a card, then drop it on a status to move it.
      </p>

      <div
        role="region"
        id="kanban-mobile-panel"
        aria-label={`${STATUS_LABELS[activeStatus]} applications`}
      >
        {total === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
            No applications match the current search or filters.
          </p>
        ) : (
          <KanbanColumn
            status={activeStatus}
            jobs={activeJobs}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            mobile
          />
        )}
      </div>
    </div>
  )
}
