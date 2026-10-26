"use client"

import { memo, useState } from "react"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/shared/lib/utils"
import type { ApplicationStatus } from "@/generated/prisma/enums"
import type { WorkspaceJobRow } from "../workspace-board"
import { KanbanCard } from "./kanban-card"

import { STATUS_LABELS } from "./kanban-status"

export { STATUS_LABELS }

// Light-first: the 400s are picked for a black board and vanish on white, so
// each dot darkens a step in light mode and keeps its dark value under `dark:`.
const STATUS_DOT: Record<ApplicationStatus, string> = {
  INTERESTED: "bg-blue-600 dark:bg-blue-400",
  APPLIED: "bg-violet-600 dark:bg-violet-400",
  SCREENING: "bg-cyan-600 dark:bg-cyan-400",
  INTERVIEW: "bg-amber-600 dark:bg-amber-400",
  OFFER: "bg-green-600 dark:bg-green-400",
  REJECTED: "bg-red-600 dark:bg-red-400",
  WITHDRAWN: "bg-muted-foreground",
}

// Intentionally no `touch-none` on the card: the TouchSensor delay constraint
// lets a swipe scroll the board, and dnd-kit applies `touch-action: none` to the
// DragOverlay once a drag actually starts.
function DraggableCard({
  job,
  selected,
  onToggleSelect,
}: {
  job: WorkspaceJobRow
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: job.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(isDragging && "opacity-40")}
      {...listeners}
      {...attributes}
    >
      <KanbanCard job={job} selected={selected} onToggleSelect={onToggleSelect} />
    </div>
  )
}

/** Initial rows per column; beyond this a Show more button windows the rest. */
export const KANBAN_COLUMN_PAGE_SIZE = 30

export const KanbanColumn = memo(function KanbanColumn({
  status,
  jobs,
  selectedIds,
  onToggleSelect,
}: {
  status: ApplicationStatus
  jobs: WorkspaceJobRow[]
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const [expanded, setExpanded] = useState(false)
  const visibleJobs = expanded ? jobs : jobs.slice(0, KANBAN_COLUMN_PAGE_SIZE)
  const hiddenCount = jobs.length - visibleJobs.length

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-w-[240px] shrink-0 flex-col gap-2 rounded-lg border border-border bg-background/40 p-2",
        isOver && "border-primary/50 bg-primary/5"
      )}
    >
      <div className="flex items-center gap-2 px-1">
        <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} />
        <span className="text-sm font-medium">{STATUS_LABELS[status]}</span>
        <span className="ml-auto text-xs text-muted-foreground">{jobs.length}</span>
      </div>
      {/*
        The card list scrolls on its own so a busy column can't stretch the
        board to thousands of pixels. The droppable node stays the column root:
        its rect is the *visible* box, which this cap keeps bounded, so hovering
        anywhere over the column still collides. dnd-kit auto-scrolls this
        element while dragging near its edges.
      */}
      <div className="flex max-h-[min(60vh,480px)] flex-col gap-2 overflow-y-auto overscroll-contain pr-0.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar]:w-1.5">
        {jobs.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            Drop here
          </p>
        ) : (
          <>
            {visibleJobs.map((job) => (
              <DraggableCard
                key={job.id}
                job={job}
                selected={selectedIds?.includes(job.id)}
                onToggleSelect={onToggleSelect}
              />
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Show {hiddenCount} more
              </button>
            )}
            {expanded && jobs.length > KANBAN_COLUMN_PAGE_SIZE && (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Show less
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
})
