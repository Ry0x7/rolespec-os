"use client"

import Link from "next/link"
import { useState } from "react"
import { useApiResource } from "@/shared/hooks/use-api-resource"
import { ResourceState } from "@/shared/components/resource-state"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Select } from "@/shared/ui/select"
import { WorkflowDetail } from "./workflow-detail"
import type { WorkflowRunDTO } from "../types"
import { readable, runTitle, STEP_LABELS } from "../client/presentation"

const STATES = ["MANUAL", "ASSISTED", "AWAITING_REVIEW", "PAUSED", "FAILED", "COMPLETED", "CANCELLED"]

export function WorkflowWorkspace({ initialRunId }: { initialRunId?: string }) {
  const [filter, setFilter] = useState("")
  const [selectedId, setSelectedId] = useState(initialRunId || "")
  const list = useApiResource<{ items: WorkflowRunDTO[] }>(`/api/workflows?limit=50&kind=APPLICATION${filter ? `&state=${filter}` : ""}`)
  function select(id: string) {
    setSelectedId(id)
    const url = new URL(window.location.href)
    url.searchParams.set("view", "runs")
    url.searchParams.set("run", id)
    window.history.replaceState(null, "", url)
  }
  return <div className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div className="space-y-2"><label htmlFor="workflow-state" className="block text-sm font-medium">Run state</label><Select id="workflow-state" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All states</option>{STATES.map((state) => <option key={state} value={state}>{readable(state)}</option>)}</Select></div><Button variant="outline" loading={list.loading} onClick={() => void list.reload()} disabled={list.offline}>Refresh runs</Button></div>
    <ResourceState loading={list.loading} error={list.error} offline={list.offline} retry={list.reload} hasData={Boolean(list.data)} />
    <p className="text-xs text-muted-foreground">Latest {list.data?.items.length ?? "—"} loaded · up to 50 application runs. Each attempt keeps its original mode.</p>
    {list.data && !list.data.items.length && <div className="space-y-3 rounded-lg border border-dashed border-border p-6"><h2 className="font-semibold">{filter ? "No runs in this state" : "Your next preparation starts with a saved job"}</h2><p className="max-w-prose text-sm text-muted-foreground">{filter ? "Choose another state to see more preparations." : "Open a tracked opportunity to create a manual checklist or an agent-assisted preparation. Nothing starts automatically."}</p><Link href="/jobs" className={buttonVariants({ variant: "outline" })}>Open saved jobs</Link></div>}
    {Boolean(list.data?.items.length) && <label className="block space-y-2 text-sm xl:hidden">Choose a preparation<Select value={selectedId} onChange={event => select(event.target.value)}><option value="">Select a run</option>{list.data!.items.map(run => <option key={run.id} value={run.id}>{runTitle(run)} · {readable(run.state)} · {run.id.slice(-8)}</option>)}</Select></label>}
    <div className={`grid min-w-0 gap-6 ${list.data?.items.length ? "xl:grid-cols-[minmax(230px,0.65fr)_minmax(0,1.65fr)]" : ""}`}>
      {Boolean(list.data?.items.length) && <ul aria-label="Preparation runs" className="hidden max-h-[70vh] min-w-0 divide-y divide-border self-start overflow-y-auto rounded-lg border border-border xl:block">{list.data!.items.map((run) => {
        const current = run.steps.find((step) => step.status === "RUNNING" || step.status === "WAITING_FOR_USER")
        return <li key={run.id}><button type="button" aria-pressed={selectedId === run.id} onClick={() => select(run.id)} className={`w-full space-y-2 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === run.id ? "bg-muted" : "hover:bg-muted/50"}`}><span className="block break-words text-sm font-semibold">{runTitle(run)}</span><span className="flex flex-wrap items-center gap-2"><Badge variant={run.state === "AWAITING_REVIEW" ? "warning" : run.state === "FAILED" ? "error" : "neutral"}>{readable(run.state)}</Badge><span className="text-xs text-muted-foreground">{run.mode === "MANUAL" ? "Manual" : "Agent-assisted"}</span></span>{current && <span className="block text-xs">{STEP_LABELS[current.name] || current.name}</span>}<span className="block text-xs text-muted-foreground">Updated {new Date(run.updatedAt).toLocaleString()} · <span className="font-mono">{run.id.slice(-8)}</span></span></button></li>
      })}</ul>}
      {selectedId ? <WorkflowDetail key={selectedId} runId={selectedId} /> : Boolean(list.data?.items.length) && <p className="p-4 text-sm text-muted-foreground">Select a run to inspect saved progress, review questions and artifacts.</p>}
    </div>
  </div>
}
