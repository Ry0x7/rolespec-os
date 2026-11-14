"use client"

import Link from "next/link"
import { useState } from "react"
import { Bell, ArrowRight } from "lucide-react"
import type { ReviewTaskDTO, WorkflowRunDTO } from "@/features/workflows/types"
import type { IntakeRunDTO } from "@/features/intake/types"
import { useApiResource } from "@/shared/hooks/use-api-resource"
import { ResourceState } from "@/shared/components/resource-state"
import { Button } from "@/shared/ui/button"
import { Badge, type BadgeProps } from "@/shared/ui/badge"
import { Drawer, DrawerHeader, DrawerBody } from "@/shared/ui/drawer"

function AttentionContents({ summary = false, onNavigate, heading = false }: { summary?: boolean; onNavigate?: () => void; heading?: boolean }) {
  const questions = useApiResource<{ items: ReviewTaskDTO[] }>("/api/review-tasks?status=OPEN&limit=50")
  const workflows = useApiResource<{ items: WorkflowRunDTO[] }>("/api/workflows?limit=50")
  const intake = useApiResource<{ runs: IntakeRunDTO[] }>("/api/intake?limit=50")
  const runs = workflows.data?.items ?? []
  const failed = runs.filter(run => run.state === "FAILED")
  const pending = intake.data?.runs?.filter(run => run.patches.some(patch => patch.status === "PENDING" || patch.status === "CONFLICT")) ?? []
  const rows: Array<{
    href: string
    label: string
    count: number | undefined
    cap: number
    detail: string
    tone: NonNullable<BadgeProps["variant"]>
  }> = [
    { href: "/review", label: "Questions to answer", count: questions.data?.items.length, cap: 50, detail: "Answer a question or approve a prepared application", tone: "warning" },
    { href: "/review?section=profile", label: "Career info to check", count: pending.length, cap: 50, detail: "Check what was found before it is saved", tone: "warning" },
    { href: "/workspace?view=runs", label: "Preparations that stopped", count: failed.length, cap: 50, detail: "See what went wrong, then retry", tone: "error" },
  ]
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      {heading ? <h2 id="attention-title" className="text-lg font-semibold">What needs your answer</h2> : <p className="text-xs text-muted-foreground">Up to date when you open this panel.</p>}
      <Button variant="ghost" size="sm" loading={questions.loading || workflows.loading || intake.loading} onClick={() => { void questions.reload(); void workflows.reload(); void intake.reload() }}>Refresh</Button>
    </div>
    {[questions, workflows, intake].map((resource, i) => <ResourceState key={i} {...resource} retry={() => void resource.reload()} hasData={Boolean(resource.data)} />)}
    <ul className={summary ? "grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0" : "divide-y divide-border"}>
      {rows.map(row => <li key={row.href}><Link href={row.href} onClick={onNavigate} className="group flex min-h-16 items-center gap-3 rounded-md p-2.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{row.label}</span><span className="mt-1 block text-xs text-muted-foreground">{row.detail}</span></span>{row.count === undefined ? <span className="text-lg tabular-nums text-muted-foreground">—</span> : <Badge variant={row.count > 0 ? row.tone : "success"} className="min-w-7 justify-center tabular-nums">{row.count}{row.count >= row.cap ? "+" : ""}</Badge>}<ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /></Link></li>)}
    </ul>
    <p className="text-xs text-muted-foreground">Counts cover up to 50 recent runs, imports and open questions.</p>
    {!summary && <>
      <Link href="/workspace?view=tracking" onClick={onNavigate} className="block rounded-md border border-border p-3 text-sm hover:bg-muted">See prepared applications and follow-up reminders <ArrowRight className="ml-1 inline h-3.5 w-3.5" aria-hidden="true" /></Link>
      <p className="text-xs text-muted-foreground">No email is sent. This panel only shows work that is waiting on you.</p>
    </>}
  </div>
}

export function AttentionOverview() {
  return <section aria-labelledby="attention-title" className="rounded-lg border border-border bg-card p-4 sm:p-6"><AttentionContents summary heading /></section>
}

export function AttentionInbox() {
  const [open, setOpen] = useState(false)
  return <>
    <Button variant="ghost" size="icon" aria-label="Open attention tray" onClick={() => setOpen(true)}><Bell className="h-4 w-4" aria-hidden="true" /></Button>
    <Drawer open={open} onClose={() => setOpen(false)} aria-label="Needs your attention"><DrawerHeader><h2 className="text-lg font-semibold">Needs your attention</h2><p className="text-sm text-muted-foreground">Decisions and reminders from your saved work.</p></DrawerHeader><DrawerBody>{open && <AttentionContents onNavigate={() => setOpen(false)} />}</DrawerBody></Drawer>
  </>
}
