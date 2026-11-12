"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Textarea } from "@/shared/ui/textarea"
import { Dialog, DialogHeader, DialogBody, DialogFooter } from "@/shared/ui/dialog"
import { ResourceState } from "@/shared/components/resource-state"
import { useApiResource } from "@/shared/hooks/use-api-resource"
import { apiRequest } from "@/shared/lib/api-client"
import type { SubmissionAttemptView } from "@/features/submissions/services/submission.service"
import type { FollowUpTaskView } from "@/features/jobs/services/follow-up-task.service"

export function AttemptList({ items, offline, onChanged }: { items: SubmissionAttemptView[]; offline: boolean; onChanged: () => Promise<void> }) {
  const router = useRouter()
  const [selected, setSelected] = useState<{ attempt: SubmissionAttemptView; submitted: boolean } | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function confirm() {
    if (!selected || busy || offline) return
    setBusy(true); setError(null)
    try {
      await apiRequest(`/api/submission-attempts/${selected.attempt.id}`, { method: "PATCH", body: JSON.stringify({ submitted: selected.submitted, ...(note.trim() ? { note: note.trim() } : {}) }) })
      setSelected(null); setNote(""); await onChanged(); router.refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record confirmation. Please retry.") }
    finally { setBusy(false) }
  }
  return <>
    <ul className="divide-y divide-border">
      {items.map(attempt => <li key={attempt.id} className="space-y-3 py-4 first:pt-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><p className="font-medium">{attempt.jobTitle ?? "Application"}{attempt.companyName ? ` · ${attempt.companyName}` : ""}</p><p className="text-xs text-muted-foreground">{attempt.source.toLowerCase()} preparation · {new Date(attempt.createdAt).toLocaleString()}</p></div>
          <Badge variant={attempt.status === "SUBMITTED" ? "success" : attempt.status === "STAGED" ? "info" : "neutral"}>{attempt.status.replaceAll("_", " ").toLowerCase()}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {attempt.jobApplicationId && <Link className="text-brand-400 underline underline-offset-4" href={`/jobs/${attempt.jobApplicationId}`}>View job</Link>}
          {attempt.resumeId && <Link className="text-brand-400 underline underline-offset-4" href={`/resumes/${attempt.resumeId}`}>Review staged resume</Link>}
          {attempt.sourceUrl && /^https?:\/\//i.test(attempt.sourceUrl) && <a className="text-brand-400 underline underline-offset-4" href={attempt.sourceUrl} target="_blank" rel="noopener noreferrer">Open employer site ↗</a>}
        </div>
        <PreparationEvidence attempt={attempt} />
        {attempt.confirmedAt && <p className="text-sm text-muted-foreground">Confirmed {new Date(attempt.confirmedAt).toLocaleString()}{attempt.confirmationNote ? ` · ${attempt.confirmationNote}` : ""}</p>}
        {attempt.status === "STAGED" && <div className="flex flex-wrap gap-2">
          <Button disabled={offline} onClick={() => { setSelected({ attempt, submitted: true }); setError(null); setNote("") }}>I submitted on the employer site</Button>
          <Button variant="outline" disabled={offline} onClick={() => { setSelected({ attempt, submitted: false }); setError(null); setNote("") }}>I did not submit</Button>
        </div>}
      </li>)}
    </ul>
    <Dialog open={!!selected} onClose={() => { if (!busy) setSelected(null) }} aria-label="Confirm application outcome" maxWidth="max-w-lg">
      <DialogHeader><h3 className="text-lg font-semibold">{selected?.submitted ? "Record your submitted application?" : "Record that you did not submit?"}</h3></DialogHeader>
      <DialogBody className="space-y-4"><p className="text-sm text-muted-foreground">{selected?.submitted ? "Confirm only after you have personally submitted on the employer’s site. This records your confirmation, updates an interested job to Applied, and creates email and LinkedIn reminders. RoleSpec does not submit or send messages." : "This closes the staged attempt as Not submitted. It does not change your tracker to Applied."}</p>
        <label className="block space-y-2 text-sm">Optional note<Textarea value={note} onChange={event => setNote(event.target.value)} maxLength={1000} disabled={busy} /></label>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
      </DialogBody>
      <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button><Button loading={busy} disabled={offline} onClick={() => void confirm()}>{selected?.submitted ? "Confirm I submitted" : "Confirm not submitted"}</Button></DialogFooter>
    </Dialog>
  </>
}

export function FollowUpList({ items, offline, onChanged }: { items: FollowUpTaskView[]; offline: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function update(id: string, action: "DONE" | "DISMISS") {
    if (busy || offline) return
    setBusy(id); setError(null)
    try { await apiRequest(`/api/follow-ups/${id}`, { method: "PATCH", body: JSON.stringify({ action }) }); await onChanged() }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update reminder. Please retry.") }
    finally { setBusy(null) }
  }
  return <div className="space-y-3">{error && <p role="alert" className="text-sm text-error">{error} Use the same action to retry.</p>}<ul className="divide-y divide-border">{items.map(task => <li key={task.id} className="flex flex-wrap items-start gap-3 py-3">
    <div className="min-w-0 flex-1"><p className="text-sm font-medium">{task.channel === "EMAIL" ? "Email" : "LinkedIn"} follow-up · <time dateTime={task.dueAt}>{task.dueAt}</time></p><p className="text-sm text-muted-foreground">{task.reason ?? "Check in with the employer yourself."}</p><Link href={`/jobs/${task.jobApplicationId}`} className="text-xs text-brand-400 underline underline-offset-4">View application</Link></div>
    {task.status === "PENDING" ? <div className="flex gap-2"><Button variant="outline" size="sm" disabled={offline || !!busy} loading={busy === task.id} onClick={() => void update(task.id, "DONE")}>Mark done</Button><Button variant="ghost" size="sm" disabled={offline || !!busy} onClick={() => void update(task.id, "DISMISS")}>Dismiss</Button></div> : <Badge variant="neutral">{task.status.toLowerCase()}</Badge>}
  </li>)}</ul></div>
}

export function ApplicationTracking({ jobApplicationId, resumeId }: { jobApplicationId: string; resumeId?: string | null }) {
  const attempts = useApiResource<{ items: SubmissionAttemptView[] }>(`/api/submission-attempts?jobApplicationId=${encodeURIComponent(jobApplicationId)}&limit=50`)
  const followUps = useApiResource<{ items: FollowUpTaskView[] }>(`/api/follow-ups?jobApplicationId=${encodeURIComponent(jobApplicationId)}&limit=100`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  async function stage() {
    if (busy || attempts.offline) return
    setBusy(true); setError(null); setSuccess(false)
    try { await apiRequest("/api/submission-attempts", { method: "POST", body: JSON.stringify({ jobApplicationId, ...(resumeId ? { resumeId } : {}) }) }); setSuccess(true); await attempts.reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not stage this application. Please retry.") }
    finally { setBusy(false) }
  }
  return <div className="space-y-6">
    <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5" aria-labelledby="staged-heading">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="max-w-prose"><h3 id="staged-heading" className="font-semibold">Staged materials</h3><p className="mt-1 text-sm text-muted-foreground">Stage the materials you intend to use, then apply on the employer’s site yourself. Preparation is not submission.</p></div><Button variant="outline" loading={busy} disabled={attempts.offline || attempts.loading || !attempts.data || attempts.data.items.some(item => item.source === "MANUAL")} onClick={() => void stage()}>Stage manually</Button></div>
      {success && <p role="status" className="text-sm text-success">Preparation staged. No application has been submitted.</p>}
      {error && <p role="alert" className="text-sm text-error">{error} Use Stage manually to retry.</p>}
      <Button variant="ghost" size="sm" disabled={attempts.offline} loading={attempts.loading} onClick={() => void attempts.reload()}>Refresh staged materials</Button>
      <ResourceState {...attempts} hasData={!!attempts.data} retry={() => void attempts.reload()} />
      {attempts.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No staged materials yet. Stage manually or prepare with the assisted workflow.</p>}
      {attempts.data && <AttemptList items={attempts.data.items} offline={attempts.offline} onChanged={async () => { await attempts.reload(); await followUps.reload() }} />}
      {attempts.data && attempts.data.items.length >= 50 && <p className="text-xs text-muted-foreground">Showing up to 50 latest attempts. Older history is not available through this list.</p>}
    </section>
    <section className="space-y-3" aria-labelledby="followup-heading"><h3 id="followup-heading" className="font-semibold">Follow-up timeline</h3><p className="text-sm text-muted-foreground">After you confirm submission: email at +5 and LinkedIn at +12 business days. Weekends are excluded; public holidays are not. These are reminders, never automatic messages.</p>
      <ResourceState {...followUps} hasData={!!followUps.data} retry={() => void followUps.reload()} />
      {followUps.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No follow-ups recorded. Confirm a submitted preparation to create the standard reminders.</p>}
      {followUps.data && <FollowUpList items={followUps.data.items} offline={followUps.offline} onChanged={followUps.reload} />}
    </section>
  </div>
}

function PreparationEvidence({ attempt }: { attempt: SubmissionAttemptView }) {
  const evidence = attempt.evidence && typeof attempt.evidence === "object" && !Array.isArray(attempt.evidence) ? attempt.evidence : {}
  const fields = attempt.source === "WORKFLOW"
    ? [["Rank score at staging", evidence.rankScore], ["Research confidence", evidence.researchConfidence], ["Tailoring suggestions", evidence.tailoringSuggestionCount], ["Validation at staging", evidence.validationStatus], ["Prepared profile facts", evidence.atsFields], ["Questions requiring an answer", evidence.blockedQuestions]]
    : [["ATS vendor", evidence.vendor], ["Fields detected", evidence.fieldsDetected], ["Fields filled in extension", evidence.fieldsFilled], ["Blocked fields", evidence.fieldsBlocked]]
  const known = fields.filter(([, value]) => typeof value === "string" || typeof value === "number")
  return <div className="space-y-2">{known.length > 0 ? <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">{known.map(([label, value]) => <div key={String(label)}><dt className="text-muted-foreground">{String(label)}</dt><dd className="mt-0.5 font-medium">{String(value)}</dd></div>)}</dl> : <p className="text-xs text-muted-foreground">No preparation checks recorded for this attempt. Review the materials yourself before applying.</p>}
    {attempt.source === "WORKFLOW" && <p className="text-xs text-muted-foreground">Prepared profile facts are not fields filled on an employer’s form. Recorded validation describes the draft at staging, not later edits.</p>}
    {attempt.evidence && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Recorded evidence details</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{JSON.stringify(attempt.evidence, null, 2)}</pre></details>}
  </div>
}
