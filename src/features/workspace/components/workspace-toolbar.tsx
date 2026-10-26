"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  BellRing,
  CheckCheck,
  FilterX,
  Search,
  X,
} from "lucide-react"
import type { ApplicationStatus } from "@/generated/prisma/enums"
import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { localCalendarDateString } from "@/shared/lib/dates"
import {
  clearJobApplicationFollowUp,
  updateJobApplicationStatus,
} from "@/features/jobs/actions/job-application.actions"
import { useWorkspaceStore } from "../hooks/use-workspace-store"
import { STATUS_LABELS } from "./kanban/kanban-status"

const SHORTCUTS: { key: string; label: string }[] = [
  { key: "/", label: "Search" },
  { key: "f", label: "Due follow-ups" },
  { key: "Esc", label: "Clear selection" },
]

export function WorkspaceToolbar({
  searchInputId = "workspace-search",
  totalCount,
  visibleCount,
}: {
  searchInputId?: string
  totalCount: number
  visibleCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [bulkBusy, setBulkBusy] = useState(false)
  const query = useWorkspaceStore((s) => s.query)
  const statuses = useWorkspaceStore((s) => s.statuses)
  const followUpOnly = useWorkspaceStore((s) => s.followUpOnly)
  const selectedIds = useWorkspaceStore((s) => s.selectedIds)
  const setQuery = useWorkspaceStore((s) => s.setQuery)
  const toggleStatus = useWorkspaceStore((s) => s.toggleStatus)
  const clearStatuses = useWorkspaceStore((s) => s.clearStatuses)
  const toggleFollowUpOnly = useWorkspaceStore((s) => s.toggleFollowUpOnly)
  const clearSelected = useWorkspaceStore((s) => s.clearSelected)

  // Local input state so typing never hits the zustand store (and its
  // subscribers) per keystroke; the store syncs 250ms after the last key.
  // Nothing else writes the store query except `clearAll` below, which resets
  // this draft too, so the draft never has to be mirrored back from the store.
  const [draftQuery, setDraftQuery] = useState(query)
  useEffect(() => {
    const timer = setTimeout(() => {
      // Compare against the live store, not the render-time `query`: the
      // store may have been cleared while the debounce was pending.
      if (useWorkspaceStore.getState().query !== draftQuery) setQuery(draftQuery)
    }, 250)
    return () => clearTimeout(timer)
  }, [draftQuery, setQuery])

  const hasFilter =
    query.trim() !== "" || statuses.length > 0 || followUpOnly

  function clearAll() {
    setDraftQuery("")
    setQuery("")
    clearStatuses()
    if (followUpOnly) toggleFollowUpOnly()
  }

  function bulkUpdate(status: ApplicationStatus) {
    if (selectedIds.length === 0 || bulkBusy) return
    setBulkBusy(true)
    startTransition(async () => {
      const today = localCalendarDateString()
      let failed = 0
      for (const id of selectedIds) {
        const result = await updateJobApplicationStatus(id, status, today)
        if ("error" in result) failed += 1
      }
      setBulkBusy(false)
      clearSelected()
      if (failed > 0) toast.error(`${failed} update${failed === 1 ? "" : "s"} failed`)
      else toast.success(`Moved ${selectedIds.length} to ${STATUS_LABELS[status]}`)
      router.refresh()
    })
  }

  function bulkClearFollowUps() {
    if (selectedIds.length === 0 || bulkBusy) return
    setBulkBusy(true)
    startTransition(async () => {
      let failed = 0
      for (const id of selectedIds) {
        const result = await clearJobApplicationFollowUp(id)
        if ("error" in result) failed += 1
      }
      setBulkBusy(false)
      clearSelected()
      if (failed > 0) toast.error(`${failed} follow-up${failed === 1 ? "" : "s"} failed`)
      else toast.success("Follow-ups logged")
      router.refresh()
    })
  }

  return (
    <div className="space-y-2.5" aria-label="Workspace controls">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={searchInputId}
            value={draftQuery}
            onChange={(e) => setDraftQuery(e.target.value)}
            placeholder="Search company or title…  ( / )"
            aria-label="Search applications"
            className="pl-8"
          />
        </div>
        <Button
          type="button"
          variant={followUpOnly ? "default" : "outline"}
          size="sm"
          onClick={toggleFollowUpOnly}
          aria-pressed={followUpOnly}
          title="Show only due follow-ups (f)"
        >
          <BellRing className="h-3.5 w-3.5" />
          Due
        </Button>
        {hasFilter && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            title="Clear search and filters"
          >
            <FilterX className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
        <span
          className="ml-auto text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {visibleCount} of {totalCount}
        </span>
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Filter by status"
      >
        {Object.entries(STATUS_LABELS).map(([value, label]) => {
          const active = statuses.includes(value)
          return (
            <button
              key={value}
              type="button"
              onClick={() => toggleStatus(value)}
              aria-pressed={active}
              title={`Toggle ${label} filter`}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      {selectedIds.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2"
          role="toolbar"
          aria-label="Bulk actions"
        >
          <span className="text-xs font-medium">
            {selectedIds.length} selected
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending || bulkBusy}
              onClick={() => bulkUpdate("INTERVIEW" as ApplicationStatus)}
            >
              To interview
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending || bulkBusy}
              onClick={() => bulkUpdate("OFFER" as ApplicationStatus)}
            >
              To offer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending || bulkBusy}
              onClick={bulkClearFollowUps}
              title="Mark follow-ups done for all selected"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Log follow-ups
            </Button>
          </span>
          <button
            type="button"
            onClick={clearSelected}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Clear selection (Esc)"
          >
            <X className="h-3.5 w-3.5" />
            Clear (Esc)
          </button>
        </div>
      )}

      <p className="hidden text-[11px] text-muted-foreground md:block" aria-hidden>
        {SHORTCUTS.map((s, i) => (
          <span key={s.key}>
            {i > 0 && " · "}
            <kbd className="rounded border border-border bg-muted px-1 font-mono">
              {s.key}
            </kbd>{" "}
            {s.label}
          </span>
        ))}
      </p>
    </div>
  )
}
