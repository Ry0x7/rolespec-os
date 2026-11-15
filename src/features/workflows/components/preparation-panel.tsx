"use client"

import Link from "next/link"
import { useState } from "react"
import { Sparkles } from "lucide-react"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { ResourceState } from "@/shared/components/resource-state"
import { apiRequest } from "@/shared/lib/api-client"
import { useApiResource } from "@/shared/hooks/use-api-resource"
import type { WorkflowRunDTO } from "../types"
import { useWorkflowMode } from "../hooks/use-workflow-mode"
import { readable } from "../client/presentation"
import { WorkflowDetail } from "./workflow-detail"
import { WorkflowModeSwitch } from "./workflow-mode-switch"

/**
 * One entry point for an application: choose how much the agent does, create
 * the run, and — in agent mode — start it in the same gesture. The run still
 * stops at HUMAN_REVIEW, so the owner approves the prepared package before
 * anything is submitted on the employer's site.
 */
export function PreparationPanel({ jobApplicationId, resumeId, resumeTitle }: { jobApplicationId: string; resumeId?: string | null; resumeTitle?: string | null }) {
  const resource = useApiResource<{ items: WorkflowRunDTO[] }>("/api/workflows?limit=50&kind=APPLICATION")
  const [mode] = useWorkflowMode()
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [intent, setIntent] = useState<string | null>(null)
  const runs = resource.data?.items.filter((run) => run.jobApplicationId === jobApplicationId) || []
  const active = runs.find((run) => !["COMPLETED", "CANCELLED"].includes(run.state))
  const selectedId = createdId || active?.id || runs[0]?.id || null

  async function create() {
    if (busy || resource.offline) return
    setBusy(true)
    setError(null)
    const requestedMode = mode
    const body = intent || JSON.stringify({ kind: "APPLICATION", jobApplicationId, mode: requestedMode, idempotencyKey: crypto.randomUUID(), ...(resumeId ? { input: { resumeId } } : {}) })
    setIntent(body)
    try {
      const created = await apiRequest<{ workflow: WorkflowRunDTO }>("/api/workflows", {
        method: "POST",
        body,
      })

      let run = created.workflow
      setCreatedId(run.id)
      setExpanded(true)
      void resource.reload()

      // Agent-first: creating the run starts it. The backend still enforces
      // every gate, and the worker pauses at HUMAN_REVIEW before staging.
      if (run.mode === "AGENT_ASSISTED" && run.state === "MANUAL") {
        try {
          const started = await apiRequest<{ workflow: WorkflowRunDTO }>(
            `/api/workflows/${encodeURIComponent(run.id)}/advance`,
            { method: "POST", body: JSON.stringify({ action: "START" }) }
          )
          run = started.workflow
          setCreatedId(run.id)
        } catch (reason) {
          setError(
            `The preparation was created but did not start automatically: ${
              reason instanceof Error ? reason.message : "unknown error"
            }. Open it below and press Start assistance.`
          )
        }
      }

      setIntent(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create preparation.")
      // Replay the original request after an unknown outcome; live application selection is separate.
      void resource.reload()
    } finally { setBusy(false) }
  }

  return <section id="preparation" aria-labelledby="preparation-heading" className="scroll-mt-24 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
    <div><h2 id="preparation-heading" className="text-lg font-semibold">Apply with the agent</h2><p className="mt-1 text-sm text-muted-foreground">The agent prepares the role, resume and answers. You approve the package, submit on the employer’s site, and record the outcome here.</p></div>
    <ResourceState loading={resource.loading} error={resource.error} offline={resource.offline} retry={resource.reload} hasData={Boolean(resource.data)} />
    {error && <p role="alert" className="rounded-md border border-error/40 p-3 text-sm">{error} <Link className="underline underline-offset-4" href="/workspace?view=runs">Open runs</Link></p>}
    {active ? <div className="flex flex-wrap items-center gap-3 text-sm">{!expanded && <><Badge>{readable(active.state)}</Badge><span>{active.mode === "MANUAL" ? "Manual checklist" : "Agent preparation"} in progress</span></>}<Button variant="outline" onClick={() => { setExpanded((value) => !value); void resource.reload() }}>{expanded ? "Hide preparation" : "Open preparation"}</Button></div> : !resource.loading && resource.data && <div className="space-y-4">
      <WorkflowModeSwitch />
      <p className="text-sm text-muted-foreground">{mode === "MANUAL" ? "No AI is required. Existing profile, resume and tracker tools remain available. A checklist records steps you complete yourself." : "One click creates and starts the agent. It checks profile readiness, ranks the role, researches the company, drafts and validates a tailored resume, and prepares the application facts. It stops at your review before staging anything."}</p>
      {resumeId && <p className="text-sm text-muted-foreground">Currently selected: <Link className="text-brand-400 underline underline-offset-4" href={`/resumes/${encodeURIComponent(resumeId)}`}>{resumeTitle || "Open selected resume"}</Link></p>}
      {mode === "AGENT_ASSISTED" && <p className="text-sm text-muted-foreground">Tailoring checks the application’s selected resume when that step executes, otherwise the resume requested at creation. Only a usable master or role-family resume can be a source; an unusable or missing source falls back to an available master. Choose your source in the resume panel below before starting. Nothing is submitted automatically — final submit stays in your hands.</p>}
      {mode === "AGENT_ASSISTED" && !resumeId && <p className="text-sm text-muted-foreground">No resume is currently selected. An available master can be used; if no source is available, the agent pauses and asks you to choose one.</p>}
      {intent && <p className="text-sm text-muted-foreground">Retry checks the original creation request with its original mode and resume. It does not change an existing attempt.</p>}
      <Button onClick={() => void create()} loading={busy} disabled={resource.offline || Boolean(resource.error)}>{intent ? "Retry creation" : runs.length ? "New agent attempt" : mode === "MANUAL" ? "Create manual checklist" : <><Sparkles className="h-4 w-4" aria-hidden="true" />Run agent preparation</>}</Button>
      {mode === "MANUAL" && <Link href={`/jobs/${encodeURIComponent(jobApplicationId)}#prepare`} className={buttonVariants({ variant: "ghost" })}>Continue with manual tools</Link>}
    </div>}
    {runs.length > 0 && !active && !createdId && <Button variant="outline" onClick={() => setExpanded((value) => !value)}>{expanded ? "Hide last preparation" : "View last preparation"}</Button>}
    {resource.data?.items.length === 50 && <p className="text-xs text-muted-foreground">Searching the latest 50 runs. Older attempts may not be included.</p>}
    {selectedId && expanded && <WorkflowDetail key={selectedId} runId={selectedId} />}
  </section>
}
