"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { cn } from "@/shared/lib/utils"
import { localCalendarDateString } from "@/shared/lib/dates"
import { updateJobApplicationStatus } from "@/features/jobs/actions/job-application.actions"
import type { WorkspaceJobRow } from "../workspace-board"
import { KanbanCard } from "./kanban-card"
import { KanbanColumn } from "./kanban-column"
import { KanbanStatusContext, KanbanTodayContext } from "./kanban-status"

const COLUMN_ORDER: ApplicationStatus[] = [
  ApplicationStatus.INTERESTED,
  ApplicationStatus.APPLIED,
  ApplicationStatus.SCREENING,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
  ApplicationStatus.REJECTED,
  ApplicationStatus.WITHDRAWN,
]

const STATUS_SET = new Set<string>(COLUMN_ORDER)

/**
 * Pointer position first (precise for mouse/touch), falling back to rect
 * overlap so keyboard drags — which have no pointer coordinates — still land.
 */
const collisionDetection: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args)
  return byPointer.length > 0 ? byPointer : rectIntersection(args)
}

export function KanbanBoard({
  jobs,
  today,
}: {
  jobs: WorkspaceJobRow[]
  today: Date
}) {
  const router = useRouter()
  const [items, setItems] = useState(jobs)
  const [activeId, setActiveId] = useState<string | null>(null)

  // `items` is local so a drag can move a card optimistically; this re-syncs it
  // when the server sends a new list. Compared during render rather than in an
  // effect, which committed the previous list first and replaced it on a second
  // pass — the cascading render `react-hooks/set-state-in-effect` flags, and
  // visible here as a card snapping back before settling.
  const [lastJobs, setLastJobs] = useState(jobs)
  if (jobs !== lastJobs) {
    setLastJobs(jobs)
    setItems(jobs)
  }

  const sensors = useSensors(
    // Mouse drags immediately after a small movement threshold.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Touch requires a press-and-hold so that swiping a card still scrolls the
    // board. Moving more than the tolerance before the delay elapses cancels
    // the drag and lets the browser scroll instead.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor)
  )

  const activeJob = activeId ? items.find((j) => j.id === activeId) ?? null : null

  // Edge fades: only shown on the side that actually has columns off-screen, so
  // a half-width panel visibly hints there is more board to the right.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      setEdges({
        left: el.scrollLeft > 1,
        right: max > 1 && el.scrollLeft < max - 1,
      })
    }

    update()
    el.addEventListener("scroll", update, { passive: true })

    // Guarded: jsdom (the test environment) has no ResizeObserver, and the
    // fades are decoration — losing the resize half is not worth a crash.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    observer?.observe(el)

    return () => {
      el.removeEventListener("scroll", update)
      observer?.disconnect()
    }
  }, [])

  const changeStatus = useCallback(
    async (jobId: string, newStatus: ApplicationStatus) => {
      // Only this card's status is remembered: a whole-board snapshot would
      // also undo any other card moved while this save was in flight.
      const previousStatus = items.find((j) => j.id === jobId)?.status
      setItems((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: newStatus } : j))
      )

      const result = await updateJobApplicationStatus(
        jobId,
        newStatus,
        localCalendarDateString()
      )
      if ("error" in result) {
        if (previousStatus !== undefined) {
          // Skipped if the card has been moved again since — that later move
          // owns its status now.
          setItems((prev) =>
            prev.map((j) =>
              j.id === jobId && j.status === newStatus
                ? { ...j, status: previousStatus }
                : j
            )
          )
        }
        toast.error(result.error)
        return
      }

      router.refresh()
    },
    [items, router]
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return

    const overId = String(over.id)
    if (!STATUS_SET.has(overId)) return
    const newStatus = overId as ApplicationStatus

    const jobId = String(active.id)
    const job = items.find((j) => j.id === jobId)
    if (!job || job.status === newStatus) return

    await changeStatus(jobId, newStatus)
  }

  // DragOverlay is `position: fixed`; left inside the workspace panel the
  // `.glass` backdrop-filter becomes its containing block, which offsets both
  // the overlay and the rect dnd-kit collides droppables against — so no column
  // ever matched. Portalling it to <body> puts it back in viewport coordinates.
  // Safe to branch on `document`: DragOverlay renders nothing without a drag,
  // so the server and the first client render agree.
  const overlay = (
    <DragOverlay>
      {activeJob ? <KanbanCard job={activeJob} /> : null}
    </DragOverlay>
  )

  return (
    <KanbanStatusContext.Provider value={changeStatus}>
      <KanbanTodayContext.Provider value={today}>
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/*
            `relative` only — no transform/filter here, that would become the
            containing block for the fixed-position DragOverlay again.
          */}
          <div className="relative">
            <div
              ref={scrollerRef}
              className="flex gap-3 overflow-x-auto pb-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar]:h-1.5"
            >
              {COLUMN_ORDER.map((status) => (
                <KanbanColumn
                  key={status}
                  status={status}
                  jobs={items.filter((j) => j.status === status)}
                />
              ))}
            </div>
            <div
              aria-hidden
              className={cn(
                // The board sits on a `.glass` panel, so the fade has to resolve
                // to that surface — `from-background` reads as a haze on it.
                "pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-[var(--glass-bg)] to-transparent transition-opacity duration-200",
                edges.left ? "opacity-100" : "opacity-0"
              )}
            />
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--glass-bg)] to-transparent transition-opacity duration-200",
                edges.right ? "opacity-100" : "opacity-0"
              )}
            />
          </div>
          {typeof document === "undefined"
            ? null
            : createPortal(overlay, document.body)}
        </DndContext>
      </KanbanTodayContext.Provider>
    </KanbanStatusContext.Provider>
  )
}
