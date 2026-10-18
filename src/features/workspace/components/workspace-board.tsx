"use client"

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable"
import { ChevronDown, GripVertical, Maximize2, Minimize2 } from "lucide-react"
import type { ApplicationStatus } from "@/generated/prisma/enums"
import { cn } from "@/shared/lib/utils"
import { useWorkspaceStore } from "../hooks/use-workspace-store"
import {
  DEFAULT_PANEL_SIZES,
  PANEL_TITLES,
  type PanelId,
} from "../constants/panels"
import { WorkspacePanel } from "./workspace-panel"
import { KanbanBoard } from "./kanban/kanban-board"
import { GoalPanel } from "./goal-panel"
import { QuickAddPanel } from "./quick-add-panel"

export type WorkspaceJobRow = {
  id: string
  status: ApplicationStatus
  dateApplied: Date | null
  interviewDate: Date | null
  followUpAt: Date | null
  job: {
    companyName: string
    title: string
    deadline: Date | null
  }
}

export type WorkspaceGoal = {
  target: number
  period: "DAILY" | "WEEKLY"
}

export type WorkspaceBoardProps = {
  jobs: WorkspaceJobRow[]
  goal: WorkspaceGoal
  appliedToday: number
  appliedThisWeek: number
  /** The user's day start (`getUserDayStart()`), for the cards' follow-up due state. */
  today: Date
}

function PanelBody({
  panelId,
  jobs,
  goal,
  appliedToday,
  appliedThisWeek,
  today,
}: { panelId: PanelId } & WorkspaceBoardProps) {
  switch (panelId) {
    case "goal":
      return (
        <GoalPanel
          goal={goal}
          appliedToday={appliedToday}
          appliedThisWeek={appliedThisWeek}
        />
      )
    case "quickAdd":
      return <QuickAddPanel />
    case "pipeline":
      return <KanbanBoard jobs={jobs} today={today} />
    default:
      return null
  }
}

// `items-start` keeps a short panel at its natural height instead of stretching
// it to match the tallest sibling in the row. Used by both the hydrated and the
// pre-hydration branch below.
const GRID_CLASS = "grid grid-cols-1 lg:grid-cols-2 gap-4 items-start"

export function WorkspaceBoard(props: WorkspaceBoardProps) {
  const panelOrder = useWorkspaceStore((s) => s.panelOrder)
  const collapsed = useWorkspaceStore((s) => s.collapsed)
  const sizes = useWorkspaceStore((s) => s.sizes)
  const hasHydrated = useWorkspaceStore((s) => s.hasHydrated)
  const setOrder = useWorkspaceStore((s) => s.setOrder)
  const toggleCollapsed = useWorkspaceStore((s) => s.toggleCollapsed)
  const togglePanelSize = useWorkspaceStore((s) => s.togglePanelSize)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const from = panelOrder.indexOf(active.id as PanelId)
    const to = panelOrder.indexOf(over.id as PanelId)
    if (from === -1 || to === -1) return

    setOrder(arrayMove(panelOrder, from, to))
  }

  // Before hydration, render a non-draggable copy using default order/sizes to
  // avoid a hydration mismatch / layout jump against the persisted store.
  if (!hasHydrated) {
    return (
      <div className={GRID_CLASS}>
        {panelOrder.map((panelId) => (
          <div
            key={panelId}
            className={cn(
              "glass rounded-lg border border-border",
              DEFAULT_PANEL_SIZES[panelId] === "full" && "lg:col-span-2",
            )}
          >
            <div className="flex w-full items-center gap-2 px-4 py-2.5">
              <span className="rounded p-1" aria-hidden>
                <GripVertical className="h-4 w-4 text-muted-foreground" />
              </span>
              <span className="flex-1 font-semibold text-sm">
                {PANEL_TITLES[panelId]}
              </span>
              <span className="rounded p-1" aria-hidden>
                {DEFAULT_PANEL_SIZES[panelId] === "full" ? (
                  <Minimize2 className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Maximize2 className="h-4 w-4 text-muted-foreground" />
                )}
              </span>
              <span className="rounded p-1" aria-hidden>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </span>
            </div>
            <div className="border-t border-border p-4">
              <PanelBody panelId={panelId} {...props} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={panelOrder} strategy={rectSortingStrategy}>
        <div className={GRID_CLASS}>
          {panelOrder.map((panelId) => (
            <WorkspacePanel
              key={panelId}
              id={panelId}
              title={PANEL_TITLES[panelId]}
              collapsed={collapsed[panelId] ?? false}
              size={sizes[panelId] ?? DEFAULT_PANEL_SIZES[panelId]}
              onToggleCollapse={() => toggleCollapsed(panelId)}
              onToggleSize={() => togglePanelSize(panelId)}
            >
              <PanelBody panelId={panelId} {...props} />
            </WorkspacePanel>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
