"use client"

import Link from "next/link"
import { useState } from "react"
import { useApiResource } from "@/shared/hooks/use-api-resource"
import { ResourceState } from "@/shared/components/resource-state"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Select } from "@/shared/ui/select"
import { Drawer } from "@/shared/ui/drawer"
import { useMediaQuery } from "@/shared/hooks/use-media-query"
import { WorkflowDetail } from "./workflow-detail"
import type { WorkflowRunDTO } from "../types"
import { readable, runTitle, STEP_LABELS } from "../client/presentation"

const STATES = ["MANUAL", "ASSISTED", "AWAITING_REVIEW", "PAUSED", "FAILED", "COMPLETED", "CANCELLED"]

export function WorkflowWorkspace({ initialRunId }: { initialRunId?: string }) {
  const [filter, setFilter] = useState("")
  const [selectedId, setSelectedId] = useState(initialRunId || "")
  const [detailOpen, setDetailOpen] = useState(Boolean(initialRunId))
  const isDesktop = useMediaQuery("(min-width: 1280px)")
  const list = useApiResource<{ items: WorkflowRunDTO[] }>(`/api/workflows?limit=50&kind=APPLICATION${filter ? `&state=${filter}` : ""}`)
  const hasRuns = Boolean(list.data?.items.length)

  function select(id: string) {
    setSelectedId(id)
    setDetailOpen(Boolean(id))
    const url = new URL(window.location.href)
    url.searchParams.set("view", "runs")
    if (id) url.searchParams.set("run", id)
    else url.searchParams.delete("run")
    window.history.replaceState(null, "", url)
  }

  // The runs page owns the viewport height on desktop: the app header, page
  // heading, view tabs and main padding take roughly 16rem. Subtracting only
  // 9rem left the page itself scrolling while the run detail had its own
  // scroller inside — two scrollbars, and the card floating mid-page.
  return <div className={`min-w-0 space-y-4 ${hasRuns ? "xl:flex xl:h-[calc(100dvh-16rem)] xl:flex-col xl:gap-3 xl:space-y-0" : ""}`}>
    <div className="flex flex-wrap items-end justify-between gap-3"><div className="space-y-2"><label htmlFor="workflow-state" className="block text-sm font-medium">Show runs</label><Select id="workflow-state" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All states</option>{STATES.map((state) => <option key={state} value={state}>{readable(state)}</option>)}</Select></div><Button variant="outline" loading={list.loading} onClick={() => void list.reload()} disabled={list.offline}>Refresh</Button></div>
    <ResourceState loading={list.loading} error={list.error} offline={list.offline} retry={list.reload} hasData={Boolean(list.data)} />
    <p className="text-xs text-muted-foreground">Showing the latest {list.data?.items.length ?? "—"} {list.data?.items.length === 1 ? "agent run" : "agent runs"} (up to 50). Each run keeps the mode it started with.</p>
    {list.data && !list.data.items.length && <div className="space-y-3 rounded-lg border border-dashed border-border p-6"><h2 className="font-semibold">{filter ? "No runs in this state" : "Your next agent run starts with a saved job"}</h2><p className="max-w-prose text-sm text-muted-foreground">{filter ? "Choose another state to see more runs." : "Open a saved job to start a preparation. The agent prepares the resume, research and application facts, then stops for your approval. Nothing is submitted for you."}</p><Link href="/jobs" className={buttonVariants({ variant: "outline" })}>Open saved jobs</Link></div>}
    {hasRuns && <div className="space-y-2 xl:hidden"><label className="block space-y-2 text-sm">Choose an agent run<Select value={selectedId} onChange={event => select(event.target.value)}><option value="">Select a run</option>{list.data!.items.map(run => <option key={run.id} value={run.id}>{runTitle(run)} · {readable(run.state)} · {run.id.slice(-8)}</option>)}</Select></label><Button variant="outline" className="w-full" onClick={() => setDetailOpen(true)} disabled={!selectedId}>Open run details</Button></div>}
    <div className={`grid min-w-0 gap-4 ${hasRuns ? "xl:min-h-0 xl:flex-1 xl:grid-cols-[320px_minmax(0,1fr)] xl:gap-5" : ""}`}>
      {hasRuns && <ul aria-label="Agent runs" className="hidden min-w-0 divide-y divide-border self-start overflow-y-auto overscroll-contain rounded-lg border border-border xl:block xl:h-full">{list.data!.items.map((run) => {
        const current = run.steps.find((step) => step.status === "RUNNING" || step.status === "WAITING_FOR_USER")
        return <li key={run.id}><button type="button" aria-pressed={selectedId === run.id} onClick={() => select(run.id)} className={`w-full space-y-2 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === run.id ? "bg-muted" : "hover:bg-muted/50"}`}><span className="block break-words text-sm font-semibold">{runTitle(run)}</span><span className="flex flex-wrap items-center gap-2"><Badge variant={run.state === "AWAITING_REVIEW" ? "warning" : run.state === "FAILED" ? "error" : "neutral"}>{readable(run.state)}</Badge><span className="text-xs text-muted-foreground">{run.mode === "MANUAL" ? "Checklist" : "Agent prepares · you approve"}</span></span>{current && <span className="block text-xs">{STEP_LABELS[current.name] || current.name}</span>}<span className="block text-xs text-muted-foreground">Updated {new Date(run.updatedAt).toLocaleString()} · <span className="font-mono">{run.id.slice(-8)}</span></span></button></li>
      })}</ul>}
      {isDesktop && (
        <div className={`min-w-0 ${hasRuns ? "xl:h-full xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:pr-1" : ""}`}>
          {selectedId ? <WorkflowDetail key={selectedId} runId={selectedId} /> : hasRuns ? <p className="p-4 text-sm text-muted-foreground">Choose a run to see what the agent did, where it stopped, and what needs your approval.</p> : null}
        </div>
      )}
    </div>
    {/* Below xl, putting the whole run report under the picker turned one
        screen into several of page scroll. It gets its own sheet with an
        internal scroll instead, so the runs page stays a short chooser. */}
    {!isDesktop && hasRuns && (
      <Drawer open={detailOpen && Boolean(selectedId)} onClose={() => setDetailOpen(false)} fullHeight width="max-w-2xl" aria-label="Agent run details">
        <div className="pt-6">{selectedId && <WorkflowDetail key={selectedId} runId={selectedId} />}</div>
      </Drawer>
    )}
  </div>
}
