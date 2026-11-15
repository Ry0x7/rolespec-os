"use client"

import { useRef, useState, type FormEvent } from "react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Select } from "@/shared/ui/select"
import { Badge } from "@/shared/ui/badge"
import { ConfirmDialog } from "@/shared/ui/confirm-dialog"
import { ResourceState } from "@/shared/components/resource-state"
import { TaskTabs } from "@/shared/components/task-tabs"
import { useApiResource } from "@/shared/hooks/use-api-resource"
import { apiRequest } from "@/shared/lib/api-client"
import { localCalendarDateString } from "@/shared/lib/dates"
import type { SubmissionAttemptView } from "@/features/submissions/services/submission.service"
import type { FollowUpTaskView } from "@/features/jobs/services/follow-up-task.service"
import type { OutreachSequenceView } from "@/features/jobs/services/outreach-sequence.service"
import { AttemptList, FollowUpList } from "./application-tracking"

export function TrackingWorkspace() {
  const [status, setStatus] = useState("STAGED")
  const [followStatus, setFollowStatus] = useState("PENDING")
  const attempts = useApiResource<{ items: SubmissionAttemptView[] }>(`/api/submission-attempts?limit=50${status ? `&status=${status}` : ""}`)
  const followUps = useApiResource<{ items: FollowUpTaskView[] }>(`/api/follow-ups?limit=100${followStatus ? `&status=${followStatus}` : ""}`)
  return <TaskTabs label="Tracking tasks" items={[{ id: "staged-applications", label: "Prepared applications" }, { id: "reminders", label: "Follow-ups" }, { id: "outreach", label: "Outreach" }]}>
    <section className="space-y-4" aria-labelledby="preparations-title"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="preparations-title" className="text-lg font-semibold">Prepared applications</h2><p className="mt-1 text-sm text-muted-foreground">Review the materials, apply yourself, then record the outcome.</p></div><label className="space-y-1 text-xs text-muted-foreground">Attempt status<Select aria-label="Attempt status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All</option>{["STAGED", "SUBMITTED", "NOT_SUBMITTED", "ABANDONED"].map(value => <option value={value} key={value}>{value.replaceAll("_", " ").toLowerCase()}</option>)}</Select></label></div>
      <Button variant="ghost" size="sm" disabled={attempts.offline} loading={attempts.loading} onClick={() => void attempts.reload()}>Refresh attempts</Button>
      <ResourceState {...attempts} hasData={!!attempts.data} retry={() => void attempts.reload()} />
      {attempts.data?.items.length === 0 && <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">No {status.toLowerCase().replaceAll("_", " ")} attempts. Open a saved job to stage materials manually or run assisted preparation.</p>}
      {attempts.data && <AttemptList items={attempts.data.items} offline={attempts.offline} onChanged={async () => { await attempts.reload(); await followUps.reload() }} />}
      {attempts.data && <p className="text-xs text-muted-foreground">Showing {attempts.data.items.length} of up to 50 latest matching attempts. Older history is not exposed by this endpoint.</p>}
    </section>
    <section className="space-y-3 border-t border-border pt-6" aria-labelledby="reminders-title"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="reminders-title" className="text-lg font-semibold">Follow-up reminders</h2><p className="mt-1 text-sm text-muted-foreground">Email +5 and LinkedIn +12 business days after confirmed submission. You send each message yourself.</p></div><label className="space-y-1 text-xs text-muted-foreground">Reminder status<Select aria-label="Reminder status" value={followStatus} onChange={e => setFollowStatus(e.target.value)}><option value="">All</option>{["PENDING", "DONE", "DISMISSED", "CANCELLED"].map(value => <option value={value} key={value}>{value.toLowerCase()}</option>)}</Select></label></div>
      <Button variant="ghost" size="sm" disabled={followUps.offline} loading={followUps.loading} onClick={() => void followUps.reload()}>Refresh reminders</Button>
      <ResourceState {...followUps} hasData={!!followUps.data} retry={() => void followUps.reload()} />
      {followUps.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No matching reminders. Confirming a submitted preparation creates the standard follow-ups.</p>}
      {followUps.data && <><FollowUpList items={followUps.data.items} offline={followUps.offline} onChanged={followUps.reload} /><p className="text-xs text-muted-foreground">Showing up to 100 reminders. Dates exclude weekends, not public holidays.</p></>}
    </section>
    <OutreachPlans />
  </TaskTabs>
}

export function OutreachPlans() {
  const resource = useApiResource<{ sequences: OutreachSequenceView[] }>("/api/outreach/sequences?limit=100")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const idempotencyKey = useRef<string | null>(null)
  async function mutate(path: string, body: unknown, id: string) {
    if (busy || resource.offline) return false
    setBusy(id); setError(null); setSuccess(null)
    try { await apiRequest(path, { method: "PATCH", body: JSON.stringify(body) }); await resource.reload(); setSuccess("Plan updated. No message was sent."); return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update. Please retry the action."); return false }
    finally { setBusy(null) }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || resource.offline) return
    const form = event.currentTarget
    const data = new FormData(form)
    const read = (key: string) => String(data.get(key) ?? "").trim()
    idempotencyKey.current ??= crypto.randomUUID()
    setBusy("create"); setError(null); setSuccess(null)
    try {
      await apiRequest("/api/outreach/sequences", { method: "POST", body: JSON.stringify({ name: read("name"), startOn: read("startOn"), idempotencyKey: idempotencyKey.current, contact: { name: read("contactName"), ...(read("email") ? { email: read("email") } : {}), ...(read("linkedinUrl") ? { linkedinUrl: read("linkedinUrl") } : {}), ...(read("company") ? { company: read("company") } : {}) } }) })
      idempotencyKey.current = null; form.reset(); setShowForm(false); await resource.reload(); setSuccess("Outreach plan saved as a draft. Activate it when you’re ready.")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create plan. Your fields are preserved; try again.") }
    finally { setBusy(null) }
  }
  return <section className="space-y-4 border-t border-border pt-6" aria-labelledby="outreach-title"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="outreach-title" className="text-lg font-semibold">Recruiter outreach</h2><p className="mt-1 max-w-prose text-sm text-muted-foreground">A personal reminder plan: introduction on day 0, email +5, LinkedIn +12 business days. RoleSpec never sends messages.</p></div><Button variant="outline" disabled={resource.offline || !!busy} onClick={() => setShowForm(value => !value)}>{showForm ? "Close new plan" : "New outreach plan"}</Button></div>
    <Button variant="ghost" size="sm" disabled={resource.offline || !!busy} loading={resource.loading} onClick={() => void resource.reload()}>Refresh plans</Button>
    <ResourceState {...resource} hasData={!!resource.data} retry={() => void resource.reload()} />
    {error && <p role="alert" className="text-sm text-error">{error} Retry the same action after checking the latest state.</p>}
    {success && <p role="status" className="text-sm text-success">{success}</p>}
    {showForm && <form onSubmit={event => void create(event)} onChange={() => { if (!busy) idempotencyKey.current = null }} className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Plan name<Input required maxLength={160} name="name" disabled={!!busy} /></label>
      <label className="space-y-1 text-sm">Contact name<Input required maxLength={200} name="contactName" disabled={!!busy} /></label>
      <label className="space-y-1 text-sm">Company (optional)<Input maxLength={200} name="company" disabled={!!busy} /></label>
      <label className="space-y-1 text-sm">Start date<Input required type="date" name="startOn" defaultValue={localCalendarDateString()} disabled={!!busy} /></label>
      <label className="space-y-1 text-sm">Email (optional)<Input type="email" maxLength={320} name="email" disabled={!!busy} /></label>
      <label className="space-y-1 text-sm">LinkedIn URL (optional)<Input type="url" maxLength={1000} name="linkedinUrl" disabled={!!busy} /></label>
      <div className="sm:col-span-2"><Button type="submit" disabled={resource.offline || !!busy} loading={busy === "create"}>Save draft plan</Button></div>
    </form>}
    {resource.data?.sequences.length === 0 && <p className="text-sm text-muted-foreground">No outreach plans yet. Add a contact and create a draft plan to organize your own follow-ups.</p>}
    <ul className="divide-y divide-border">{resource.data?.sequences.map(sequence => <li key={sequence.id} className="space-y-3 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{sequence.name}</h3><p className="text-sm text-muted-foreground">{sequence.contact.name}{sequence.contact.company ? ` · ${sequence.contact.company}` : ""}</p></div><Badge variant={sequence.status === "ACTIVE" ? "info" : "neutral"}>{sequence.status.toLowerCase()}</Badge></div>
      <div className="flex flex-wrap gap-3 text-sm">{sequence.contact.email && <a className="text-brand-400 underline underline-offset-4" href={`mailto:${sequence.contact.email}`}>Open email composer</a>}{sequence.contact.linkedinUrl && /^https?:\/\//i.test(sequence.contact.linkedinUrl) && <a className="text-brand-400 underline underline-offset-4" href={sequence.contact.linkedinUrl} target="_blank" rel="noopener noreferrer">Open LinkedIn ↗</a>}</div>
      {(sequence.status === "DRAFT" || sequence.status === "ACTIVE") && <div className="flex gap-2">{sequence.status === "DRAFT" && <Button size="sm" disabled={resource.offline || !!busy} loading={busy === sequence.id} onClick={() => void mutate(`/api/outreach/sequences/${sequence.id}`, { action: "ACTIVATE" }, sequence.id)}>Activate plan</Button>}<Button size="sm" variant="ghost" disabled={resource.offline || !!busy} onClick={() => setCancelId(sequence.id)}>Cancel plan</Button></div>}
      <ol className="space-y-3">{sequence.touches.map(touch => <li key={touch.id} className="flex flex-wrap items-start gap-3 rounded-md bg-muted/40 p-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{touch.channel === "EMAIL" ? "Email" : "LinkedIn"} · <time dateTime={touch.dueOn}>{touch.dueOn}</time></p><p className="text-xs text-muted-foreground">{touch.note}</p></div>{sequence.status === "ACTIVE" && touch.status === "PENDING" ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={resource.offline || !!busy} loading={busy === touch.id} onClick={() => void mutate(`/api/outreach/touches/${touch.id}`, { action: "DONE" }, touch.id)}>Mark done</Button><Button size="sm" variant="ghost" disabled={resource.offline || !!busy} onClick={() => void mutate(`/api/outreach/touches/${touch.id}`, { action: "SKIPPED" }, touch.id)}>Skip</Button></div> : <Badge variant="neutral">{touch.status.toLowerCase()}</Badge>}</li>)}</ol>
    </li>)}</ul>
    {resource.data && resource.data.sequences.length >= 100 && <p className="text-xs text-muted-foreground">Showing up to 100 latest plans.</p>}
    <ConfirmDialog open={!!cancelId} title="Cancel this outreach plan?" description="Pending touches will be cancelled. Completed touches remain in the plan history. This cannot be undone." destructive confirmLabel="Cancel plan" onCancel={() => setCancelId(null)} onConfirm={() => { if (cancelId) { const id = cancelId; setCancelId(null); void mutate(`/api/outreach/sequences/${id}`, { action: "CANCEL" }, id) } }} />
  </section>
}
