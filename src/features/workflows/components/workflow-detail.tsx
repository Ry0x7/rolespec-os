"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Check, Circle, Clock, Pause, RefreshCw } from "lucide-react"
import { apiRequest, ApiError } from "@/shared/lib/api-client"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { ConfirmDialog } from "@/shared/ui/confirm-dialog"
import { SegmentedControl } from "@/shared/ui/segmented-control"
import { ResourceState } from "@/shared/components/resource-state"
import { useWorkflow } from "../hooks/use-workflow"
import { manualTool, nextManualStep, readable, runTitle, STEP_LABELS, workflowActions } from "../client/presentation"
import type { WorkflowRunDTO } from "../types"
import { WorkflowOutput } from "./workflow-output"
import { WorkflowRoom } from "./workflow-room"

const ACTION_LABELS: Record<string, string> = { START: "Start assistance", PAUSE: "Pause", RESUME: "Resume", RETRY: "Retry failed work", CANCEL: "Cancel preparation" }

export function WorkflowDetail({ runId }: { runId: string }) {
  const { run, events, error, eventsError, loading, connection, replace, reconnect } = useWorkflow(runId)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [manualConfirm, setManualConfirm] = useState<string | null>(null)
  const [selectedStep, setSelectedStep] = useState("")
  const [view, setView] = useState<"2d" | "room">("2d")
  const [roomAvailable, setRoomAvailable] = useState(false)
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active), (max-width: 767px)")
    const flat = () => { setRoomAvailable(!media.matches); if (media.matches) setView("2d") }
    flat()
    media.addEventListener("change", flat)
    return () => media.removeEventListener("change", flat)
  }, [])
  async function advance(action: string, stepName?: string) {
    if (busy || connection === "offline") return
    setBusy(action)
    setActionError(null)
    setSuccess(null)
    try {
      const result = await apiRequest<{ workflow: WorkflowRunDTO }>(`/api/workflows/${encodeURIComponent(runId)}/advance`, {
        method: "POST", body: JSON.stringify({ action, ...(stepName ? { stepName } : {}) }),
      })
      replace(result.workflow)
      setSuccess(action === "COMPLETE_STEP" ? "Checklist updated. No services were run or documents changed." : action === "START" ? "Preparation started. Progress below reflects saved backend state." : `Preparation updated: ${readable(result.workflow.state)}.`)
      reconnect()
    } catch (reason) {
      setActionError(reason instanceof ApiError && reason.status === 409 ? `This preparation changed elsewhere. ${reason.message}` : reason instanceof Error ? reason.message : "Could not update this preparation.")
      reconnect()
    } finally { setBusy(null) }
  }
  const steps = run ? [...run.steps].sort((a, b) => a.order - b.order) : []
  const selected = steps.find((step) => step.name === selectedStep) || steps.find((step) => step.status === "RUNNING" || step.status === "WAITING_FOR_USER") || steps.find((step) => step.status === "PENDING") || steps.at(-1)
  const manual = run && nextManualStep(run)
  const tool = manual && run ? manualTool(manual.name, run.jobApplicationId) : null
  return <section aria-label="Preparation detail" className="min-w-0 space-y-5">
    <ResourceState loading={loading} error={error} offline={connection === "offline"} retry={reconnect} hasData={Boolean(run)} />
    {actionError && <p role="alert" className="rounded-md border border-error/40 p-3 text-sm">{actionError} Refresh before trying again; a lost response may still have saved.</p>}
    {success && <p role="status" className="text-sm text-success">{success}</p>}
    {run && <>
      <div className="space-y-3 border-b border-border pb-5">
        <div className="flex flex-wrap items-center gap-2"><Badge variant={run.state === "FAILED" ? "error" : run.state === "AWAITING_REVIEW" ? "warning" : "neutral"}>{readable(run.state)}</Badge><span className="text-xs text-muted-foreground">{run.mode === "MANUAL" ? "Manual checklist" : "Agent-assisted preparation"}</span></div>
        <h2 className="text-lg font-semibold">{runTitle(run)}</h2>
        <p className="text-xs text-muted-foreground">Last persisted update <time dateTime={run.updatedAt}>{new Date(run.updatedAt).toLocaleString()}</time> · Run <span className="font-mono">{run.id.slice(-8)}</span></p>
        <p className="text-sm text-muted-foreground">{steps.filter((step) => step.required && step.status === "COMPLETED").length} required steps completed · {steps.filter((step) => !step.required && step.status === "SKIPPED").length} optional steps skipped. Nothing is submitted by this workflow.</p>
        <div className="flex flex-wrap items-center gap-2">
          {workflowActions(run).filter((action) => action !== "CANCEL").map((action) => <Button key={action} variant={action === "PAUSE" ? "secondary" : "default"} disabled={Boolean(busy) || connection === "offline"} loading={busy === action} onClick={() => void advance(action)}>{action === "START" && run.mode === "MANUAL" ? "Start checklist" : ACTION_LABELS[action]}</Button>)}
          {run.openReviewTaskIds.length > 0 && <Link className={buttonVariants()} href={`/review?task=${encodeURIComponent(run.openReviewTaskIds[0])}`}>Review {run.openReviewTaskIds.length === 1 ? "question" : `${run.openReviewTaskIds.length} questions`}</Link>}
          {run.jobApplicationId && <Link className={buttonVariants({ variant: "outline" })} href={`/jobs/${encodeURIComponent(run.jobApplicationId)}`}>Open job & manual tools</Link>}
          <Button variant="ghost" onClick={reconnect} disabled={Boolean(busy) || loading || connection === "offline"}><RefreshCw aria-hidden="true" className="h-4 w-4" />Refresh</Button>
          {workflowActions(run).includes("CANCEL") && <Button variant="ghost" disabled={Boolean(busy) || connection === "offline"} onClick={() => setCancelOpen(true)}>Cancel preparation</Button>}
        </div>
        {connection === "live" && <p className="text-xs text-muted-foreground">Connected to persisted workflow updates.</p>}
        {connection === "interrupted" && <div className="flex flex-wrap items-center gap-3 text-sm" role="status"><p>Connection interrupted. Showing the last loaded state; preparation is not marked failed.</p><Button variant="outline" onClick={reconnect}>Reconnect</Button></div>}
        {run.state === "PAUSED" && <p className="text-sm text-muted-foreground">Saved work is preserved. Resuming may return to an unanswered review question.</p>}
        {run.lastError && <p role="alert" className="text-sm text-error">{run.lastError}</p>}
        {run.state === "FAILED" && <p className="text-sm text-muted-foreground">Use the manual tools or correct the reported issue, then retry failed work. Completed steps are preserved.</p>}
        <p className="text-xs text-muted-foreground">Work runs while the RoleSpec server is running. Reopen RoleSpec to continue checking progress.</p>
        {run.mode === "AGENT_ASSISTED" && run.state !== "COMPLETED" && run.state !== "CANCELLED" && <div className="space-y-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          <p>The creation request keeps its mode and requested IDs. Profile facts and the application’s selected resume are read when the corresponding step executes. Tailoring checks that selected resume, or the requested resume when none is selected. Only a usable master or role-family resume can be a source; an unusable or missing source falls back to an available master. Changing the application selection before tailoring can change the source. If no source is available, preparation waits for your decision.</p>
          {run.input?.resumeId && <Link className="inline-flex min-h-11 items-center text-brand-400 underline underline-offset-4" href={`/resumes/${encodeURIComponent(run.input.resumeId)}`}>Open resume requested at creation</Link>}
        </div>}
      </div>
      {manual && tool && <div className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="font-medium">Next manual step: {STEP_LABELS[manual.name] || manual.name}</h3>
        <p className="text-sm text-muted-foreground">Use the existing tools and save your work there. Marking this checklist done only records your report; it does not run AI, validate a resume, fill a form, or submit.</p>
        <div className="flex flex-wrap gap-2"><Link href={tool.href} className={buttonVariants({ variant: "outline" })}>{tool.label}</Link><Button variant="secondary" disabled={Boolean(busy) || connection === "offline"} onClick={() => setManualConfirm(manual.name)}>Mark step done</Button></div>
      </div>}
      {roomAvailable && <SegmentedControl value={view} onChange={setView} label="Preparation view" size="default" options={[{ value: "2d", label: "2D timeline" }, { value: "room", label: "Evidence studio" }]} />}
      <p className="text-xs text-muted-foreground">The studio uses the same recorded steps. Small screens and accessibility preferences use the 2D timeline.</p>
      {view === "room" && <WorkflowRoom run={run} selectedStep={selected?.name || ""} onSelect={setSelectedStep} />}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)]">
        <ol aria-label="Recorded workflow steps" className="min-w-0 divide-y divide-border rounded-lg border border-border">
          {steps.map((step) => {
            const Icon = step.status === "COMPLETED" ? Check : step.status === "RUNNING" ? Clock : step.status === "WAITING_FOR_USER" ? Pause : Circle
            return <li key={step.id}><button type="button" aria-pressed={selected?.id === step.id} onClick={() => setSelectedStep(step.name)} className={`flex min-h-16 w-full items-start gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected?.id === step.id ? "bg-muted" : "hover:bg-muted/50"}`}><Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0"><span className="block text-sm font-medium">{STEP_LABELS[step.name] || step.name}</span><span className="mt-1 block text-xs text-muted-foreground">{step.status === "PENDING" ? "Waiting to run" : readable(step.status)} · {step.required ? "Required" : "Optional"}</span></span></button></li>
          })}
        </ol>
        {selected && <div className="min-w-0 space-y-4 rounded-lg border border-border p-4" aria-label={`${STEP_LABELS[selected.name] || selected.name} evidence`}>
          <div><h3 className="font-semibold">{STEP_LABELS[selected.name] || selected.name}</h3><p className="mt-1 text-xs text-muted-foreground">{readable(selected.status)} · {selected.attempts}/{selected.maxAttempts} attempts recorded</p></div>
          <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2"><div><dt>Started</dt><dd>{selected.startedAt ? new Date(selected.startedAt).toLocaleString() : "Not recorded"}</dd></div><div><dt>Finished</dt><dd>{selected.finishedAt ? new Date(selected.finishedAt).toLocaleString() : "Not recorded"}</dd></div></dl>
          {selected.lastError && <p className="text-sm text-error">{selected.lastError}</p>}
          <WorkflowOutput step={selected} applicationId={run.jobApplicationId} />
        </div>}
      </div>
      <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Persisted event history · latest {events.length}{events.length === 200 ? " loaded" : ""}</summary>
        {eventsError && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" role="alert"><p>{eventsError}</p><Button variant="outline" onClick={reconnect}>Retry event history</Button></div>}
        {!events.length && !eventsError && <p className="mt-3 text-sm text-muted-foreground">No persisted events loaded.</p>}
        <ol className="mt-4 space-y-4">{events.map((event) => <li key={event.id} className="text-sm"><p>{event.message}</p><p className="mt-1 text-xs text-muted-foreground"><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>{event.stepName ? ` · ${STEP_LABELS[event.stepName] || event.stepName}` : ""}</p></li>)}</ol>
      </details>
      <ConfirmDialog open={cancelOpen} title="Cancel this preparation?" description={`Stop ${runTitle(run)} and expire its open questions. Saved artifacts remain. This attempt cannot resume after cancellation.`} confirmLabel="Cancel preparation" cancelLabel="Keep preparation" destructive onCancel={() => setCancelOpen(false)} onConfirm={() => { setCancelOpen(false); void advance("CANCEL") }} />
      <ConfirmDialog open={Boolean(manualConfirm)} title="Record this manual step as done?" description="Only your checklist report will be saved. This does not execute the step, save an artifact, run validation, or submit an application." confirmLabel="Record step done" onCancel={() => setManualConfirm(null)} onConfirm={() => { const stepName = manualConfirm; setManualConfirm(null); if (stepName) void advance("COMPLETE_STEP", stepName) }} />
    </>}
  </section>
}
