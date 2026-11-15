"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { CheckCheck, RefreshCw, ShieldCheck } from "lucide-react"
import { apiRequest } from "@/shared/lib/api-client"
import { useApiResource } from "@/shared/hooks/use-api-resource"
import { ResourceState } from "@/shared/components/resource-state"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { Textarea } from "@/shared/ui/textarea"
import { SegmentedControl } from "@/shared/ui/segmented-control"
import { IntakePanel } from "@/features/intake/components/intake-panel"
import type { IntakeRunDTO } from "@/features/intake/types"
import type { ReviewTaskDTO, WorkflowRunDTO } from "@/features/workflows/types"

export const REVIEW_KINDS = ["SENSITIVE_ANSWER", "UNKNOWN_FIELD", "MISSING_PROFILE_FACT", "RESTRICTED_ACCESS", "AMBIGUOUS_TAILORING", "SUBMISSION_CONFIRMATION", "ESSAY_ANSWER", "RESUME_ATTACHMENT", "CONFLICTING_ANSWER", "UNSUPPORTED_FIELD"] as const
export type ReviewSection = "questions" | "profile" | "memory"
const humanize = (text: string) => text.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Approval stages preparation only. ATS answers need explicit replacement consent. */
export function reviewResolution(task: ReviewTaskDTO, answer: string, acknowledged: boolean, scope: "APPLICATION" | "GLOBAL") {
  if (task.kind === "RESUME_ATTACHMENT" || task.kind === "CONFLICTING_ANSWER") throw new Error("Complete this decision in the browser extension.")
  if (!acknowledged) throw new Error("Confirm that you reviewed this decision first.")
  if (task.kind === "SUBMISSION_CONFIRMATION") return { action: "RESOLVE", value: { approved: true } }
  if (!task.atsPreparationId && (task.kind === "MISSING_PROFILE_FACT" || task.kind === "AMBIGUOUS_TAILORING")) return { action: "RESOLVE", value: { reviewed: true } }
  if (!answer.trim()) throw new Error("Enter your answer before saving.")
  return { action: "RESOLVE", value: answer.trim(), ...(task.atsPreparationId ? { scope } : {}) }
}

function EvidenceBundle({ task }: { task: ReviewTaskDTO }) {
  const value = object(task.suggestedValue)
  const draftId = typeof value.tailoredResumeId === "string" ? value.tailoredResumeId : typeof value.resumeId === "string" ? value.resumeId : null
  const issues = Array.isArray(value.issues) ? value.issues : []
  return <div className="space-y-3">
    {draftId && <Link href={`/resumes/${encodeURIComponent(draftId)}`} className={buttonVariants({ variant: "outline" })}>Review draft, comparison and validation</Link>}
    {task.kind === "SUBMISSION_CONFIRMATION" && <>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Prepared profile facts</dt><dd>{typeof value.preparedFieldCount === "number" ? value.preparedFieldCount : "Not supplied"}</dd></div>
        <div><dt className="text-muted-foreground">Questions requiring your answer</dt><dd>{typeof value.blockedQuestionCount === "number" ? value.blockedQuestionCount : "Not supplied"}</dd></div>
        <div><dt className="text-muted-foreground">Recorded validation</dt><dd>{typeof value.validationStatus === "string" ? humanize(value.validationStatus) : "No validation supplied"}</dd></div>
        <div><dt className="text-muted-foreground">Recorded validation issues</dt><dd>{typeof value.validationIssueCount === "number" ? value.validationIssueCount : "Not supplied"}</dd></div>
      </dl>
      <p className="text-sm text-muted-foreground">These are prepared facts, not evidence that an employer form was filled. Approval allows staging; it does not select a resume or submit an application.</p>
    </>}
    {issues.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm">{issues.map((issue, index) => <li key={index}>{typeof object(issue).message === "string" ? String(object(issue).message) : "Review the validation issue in the resume editor."}</li>)}</ul>}
    {typeof task.suggestedValue === "string" && task.kind !== "SENSITIVE_ANSWER" && <p className="text-sm"><span className="text-muted-foreground">Suggestion: </span>{task.suggestedValue}</p>}
  </div>
}

function PreparedPlan({ runId }: { runId: string }) {
  const resource = useApiResource<{ workflow: WorkflowRunDTO }>(`/api/workflows/${encodeURIComponent(runId)}`)
  const output = object(resource.data?.workflow.steps.find((step) => step.name === "PREPARE_ATS")?.output)
  const fields = Object.entries(object(output.fields)).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  const questions = Array.isArray(output.needsUserAnswer) ? output.needsUserAnswer : []
  return <div className="space-y-3">
    <ResourceState {...resource} retry={() => void resource.reload()} hasData={!!resource.data} />
    {resource.data && <>
      <details>
        <summary className="cursor-pointer py-2 text-sm font-medium">Inspect prepared profile facts ({fields.length})</summary>
        {fields.length > 0 ? <dl className="space-y-2 py-2 text-sm">{fields.map(([name, value]) => <div key={name} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="text-muted-foreground">{name.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd className="break-words">{value}</dd></div>)}</dl> : <p className="text-sm text-muted-foreground">No prepared facts were recorded for this run.</p>}
      </details>
      {questions.length > 0 && <div className="space-y-2"><h3 className="text-sm font-medium">Questions to answer on the employer page</h3><ul className="divide-y divide-border text-sm">{questions.map((question, index) => <li key={index} className="space-y-1 py-3"><p>{typeof object(question).question === "string" ? String(object(question).question) : "Inspect this question in the workflow."}</p>{typeof object(question).reason === "string" && <p className="text-xs text-muted-foreground">{String(object(question).reason)}</p>}</li>)}</ul><p className="text-xs text-muted-foreground">This workflow lists sensitive questions without answering them. Open the employer page from the application, or scan the form in the extension to review its actual fields.</p></div>}
      {output.resumeExportReady === false && <p className="text-sm text-muted-foreground">No resume PDF export is recorded by this preparation step. Review and export your chosen draft before attaching it.</p>}
    </>}
  </div>
}

export function ReviewDecision({ task, offline, onChanged }: { task: ReviewTaskDTO; offline: boolean; onChanged: () => Promise<void> }) {
  const [answer, setAnswer] = useState("")
  const [scope, setScope] = useState<"APPLICATION" | "GLOBAL">("APPLICATION")
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const questionHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { questionHeading.current?.focus() }, [])
  const application = useApiResource<{ application: { job: { title: string; companyName: string } } }>(task.jobApplicationId ? `/api/applications/${encodeURIComponent(task.jobApplicationId)}` : null)
  const extensionOnly = task.kind === "RESUME_ATTACHMENT" || task.kind === "CONFLICTING_ANSWER"
  const checkpoint = !task.atsPreparationId && (task.kind === "MISSING_PROFILE_FACT" || task.kind === "AMBIGUOUS_TAILORING")
  const approval = task.kind === "SUBMISSION_CONFIRMATION"
  const closed = task.status !== "OPEN" || done !== null

  async function mutate(dismiss: boolean) {
    setError(null)
    let body: unknown
    try {
      body = dismiss ? { action: "DISMISS", reason: answer.trim() || undefined } : reviewResolution(task, answer, acknowledged, scope)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Review this answer first."); return }
    setBusy(true)
    try {
      await apiRequest(`/api/review-tasks/${encodeURIComponent(task.id)}`, { method: "PATCH", body: JSON.stringify(body) })
      setDone(dismiss ? "Decision left unanswered. A linked waiting workflow may pause." : approval ? "Preparation approved. Nothing was submitted." : "Decision saved. The workflow will recheck its requirements.")
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this decision. Your input is retained.")
    } finally { setBusy(false) }
  }

  return <section aria-labelledby={`question-${task.id}`} className="min-w-0 space-y-5 rounded-lg border border-border bg-card p-4 sm:p-6">
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{humanize(task.kind)}</Badge><Badge variant={task.status === "OPEN" ? "warning" : "neutral"}>{humanize(task.status)}</Badge></div>
      <h2 ref={questionHeading} id={`question-${task.id}`} tabIndex={-1} className="break-words text-lg font-semibold">{task.question}</h2>
      <p className="text-sm text-muted-foreground">{application.data?.application?.job ? `${application.data.application.job.title} · ${application.data.application.job.companyName}` : task.jobApplicationId ? "Linked application" : task.atsPreparationId ? "Unlinked ATS preparation" : "Standalone question"}</p>
      <p className="text-sm"><span className="font-medium">Why this needs you: </span>{task.reason}</p>
      <div className="flex flex-wrap gap-3 text-sm">
        {task.jobApplicationId && <Link className="text-brand-400 underline underline-offset-4" href={`/jobs/${encodeURIComponent(task.jobApplicationId)}`}>Open application</Link>}
        {task.runId && <Link className="text-brand-400 underline underline-offset-4" href={`/workspace?view=runs&run=${encodeURIComponent(task.runId)}`}>Open workflow</Link>}
        <time className="text-muted-foreground" dateTime={task.createdAt}>{new Date(task.createdAt).toLocaleString()}</time>
      </div>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2">Source identifiers</summary><dl className="space-y-1 break-all"><div><dt className="inline">Decision: </dt><dd className="inline">{task.id}</dd></div>{task.runId && <div><dt className="inline">Workflow: </dt><dd className="inline">{task.runId}</dd></div>}{task.atsPreparationId && <div><dt className="inline">ATS preparation: </dt><dd className="inline">{task.atsPreparationId}</dd></div>}</dl></details>
    </div>
    <EvidenceBundle task={task} />
    {approval && task.runId && <PreparedPlan runId={task.runId} />}
    {task.fallback && <p className="rounded-md bg-muted p-3 text-sm">{task.fallback}</p>}
    {(checkpoint || task.kind === "MISSING_PROFILE_FACT") && <div className="flex flex-wrap gap-3"><Link href="/career-profile?setup=0" className={buttonVariants({ variant: "outline" })}>Edit career profile</Link><Link href={task.jobApplicationId ? `/jobs/${encodeURIComponent(task.jobApplicationId)}#prepare` : "/resumes"} className={buttonVariants({ variant: "outline" })}>Choose or edit a resume</Link></div>}
    {extensionOnly && <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
      <p>{task.kind === "CONFLICTING_ANSWER" ? "Compare the saved value in the RoleSpec extension before replacing it. The web contract does not reveal the previous answer." : "Preview or download your resume, then attach it in the extension or choose the file on the employer page. This page cannot attach files."}</p>
      <Link className="text-brand-400 underline underline-offset-4" href="/settings/api">Extension connection instructions</Link>
      {task.kind === "RESUME_ATTACHMENT" && <p><Link className="text-brand-400 underline underline-offset-4" href="/resumes">Open resumes</Link></p>}
    </div>}
    {closed ? <p role="status" className="text-sm text-muted-foreground">{done ?? `This decision is ${humanize(task.status).toLowerCase()}.`}</p> : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void mutate(false) }}>
      {!approval && !checkpoint && !extensionOnly && <div className="space-y-2"><Label htmlFor={`answer-${task.id}`}>Your answer</Label><Textarea id={`answer-${task.id}`} value={answer} maxLength={8000} onChange={(event) => { setAnswer(event.target.value); setError(null) }} rows={4} aria-describedby={error ? `decision-error-${task.id}` : undefined} /><p className="text-xs text-muted-foreground">Saving an answer does not fill or send an employer form.</p></div>}
      {task.atsPreparationId && !extensionOnly && !approval && <div className="space-y-2"><Label htmlFor={`scope-${task.id}`}>Remember this answer</Label><Select id={`scope-${task.id}`} value={scope} onChange={(event) => { setScope(event.target.value as typeof scope); setAcknowledged(false) }}><option value="APPLICATION">This form only</option><option value="GLOBAL">Future forms with this same question</option></Select><p className="text-xs text-muted-foreground">This form means this ATS preparation, not every role at this company.</p></div>}
      {!extensionOnly && <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-brand-500" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); setError(null) }} />
        <span>{approval ? "I reviewed the preparation and draft. Allow staging; nothing will be submitted." : task.atsPreparationId ? "I approve this answer and understand it may replace a saved answer for this question and scope." : checkpoint ? "I saved the needed facts or reviewed the flagged issues. Recheck this checkpoint; another bounded attempt may run." : "I reviewed this answer and want to resolve this question."}</span>
      </label>}
      {error && <p id={`decision-error-${task.id}`} role="alert" className="text-sm text-error">{error} Your input is retained. Review the current queue before retrying.</p>}
      <div className="flex flex-wrap gap-2">
        {!extensionOnly && <Button type="submit" disabled={offline || !acknowledged || (!approval && !checkpoint && !answer.trim())} loading={busy}>{approval ? "Approve preparation" : checkpoint ? "Recheck checkpoint" : "Save reviewed answer"}</Button>}
        <Button type="button" variant="outline" disabled={offline || busy} onClick={() => void mutate(true)}>{task.runId ? "Dismiss checkpoint" : "Leave unanswered"}</Button>
      </div>
      {task.runId && <p className="text-xs text-muted-foreground">Dismissing the last open checkpoint pauses the linked waiting workflow.</p>}
    </form>}
  </section>
}

function ProfileProposals() {
  const resource = useApiResource<{ runs: IntakeRunDTO[] }>("/api/intake?limit=50")
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Review proposals before applying them. Imported evidence still needs your separate confirmation.</p><Button variant="outline" loading={resource.loading} disabled={resource.offline} onClick={() => void resource.reload()}>Refresh proposals</Button></div>
    <ResourceState {...resource} retry={() => void resource.reload()} hasData={!!resource.data} />
    {resource.data && <><p className="text-xs text-muted-foreground">{resource.data.runs.length === 50 ? "Latest 50" : resource.data.runs.length} loaded intake runs. Counts apply to these runs only.</p><IntakePanel initialRuns={resource.data.runs} resumes={[]} githubUrl={null} websiteUrl={null} missingFields={[]} reviewOnly /></>}
    <Link href="/career-profile?setup=0#intake" className={buttonVariants({ variant: "outline" })}>Import sources or edit profile</Link>
  </div>
}

export function ReviewWorkspace({ initialSection = "questions", initialTaskId }: { initialSection?: ReviewSection; initialTaskId?: string }) {
  const [section, setSection] = useState<ReviewSection>(initialSection)
  const [status, setStatus] = useState("OPEN")
  const [kind, setKind] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId ?? null)
  const [notice, setNotice] = useState<string | null>(null)
  const resource = useApiResource<{ items: ReviewTaskDTO[] }>(section === "questions" ? `/api/review-tasks?status=${status}&limit=50${kind ? `&kind=${kind}` : ""}` : null)
  const heading = useRef<HTMLHeadingElement>(null)
  const tasks = resource.data?.items ?? []
  const selected = tasks.find((task) => task.id === selectedId) ?? null

  function changeSection(next: ReviewSection) {
    setSection(next)
    const url = new URL(window.location.href)
    url.searchParams.set("section", next)
    window.history.replaceState(null, "", url)
  }
  async function changed() {
    await resource.reload()
    setSelectedId(null)
    setNotice("Decision saved. The queue has been refreshed from persisted state.")
    heading.current?.focus()
    const url = new URL(window.location.href)
    url.searchParams.delete("task")
    window.history.replaceState(null, "", url)
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><h1 ref={heading} tabIndex={-1} className="text-2xl font-bold">Review</h1><p className="max-w-2xl text-sm text-muted-foreground">Your decisions, before anything moves forward. Facts stay yours; applications are never submitted here.</p></div><ShieldCheck className="h-6 w-6 text-muted-foreground" aria-hidden="true" /></div>
    <SegmentedControl size="default" value={section} onChange={changeSection} label="Review sections" options={[{ value: "questions", label: "Questions" }, { value: "profile", label: "Profile proposals" }, { value: "memory", label: "Answer memory" }]} />
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {section === "memory" && <section className="max-w-2xl space-y-4 rounded-lg border border-border bg-card p-5"><h2 className="text-lg font-semibold">Answers you have approved</h2><p className="text-sm text-muted-foreground">Manage saved answers in the RoleSpec browser extension. Answers you approve here for an ATS question use the same memory.</p><p className="text-sm text-muted-foreground">Open the extension’s Autofill panel on an employer form to inspect, replace or revoke saved answers. Sensitive values are kept out of notifications and browser storage. This web workspace cannot read the extension’s bearer-only answer list.</p><Link href="/settings/api" className={buttonVariants({ variant: "outline" })}>Extension connection instructions</Link></section>}
    {section === "profile" && <ProfileProposals />}
    {section === "questions" && <>
      <div className="flex flex-wrap items-end gap-3"><div className="space-y-1"><Label htmlFor="review-status">Status</Label><Select id="review-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option><option value="EXPIRED">Expired</option></Select></div><div className="min-w-0 space-y-1"><Label htmlFor="review-kind">Decision type</Label><Select id="review-kind" value={kind} onChange={(event) => setKind(event.target.value)}><option value="">All decision types</option>{REVIEW_KINDS.map((value) => <option value={value} key={value}>{humanize(value)}</option>)}</Select></div><Button variant="outline" disabled={resource.offline} loading={resource.loading} onClick={() => void resource.reload()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh</Button></div>
      <ResourceState {...resource} retry={() => void resource.reload()} hasData={!!resource.data} />
      {resource.data && <p className="text-xs text-muted-foreground">{tasks.length === 50 ? "Latest 50 matching questions" : `${tasks.length} loaded ${status.toLowerCase()} questions`}. No decisions are approved automatically.</p>}
      {resource.data && selectedId && !selected && <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm">The requested question is unavailable in the current results, which are limited to the latest 50 matches. Change the status or decision type, or refresh to locate it. This does not mean it was deleted.</p>}
      {resource.data && tasks.length === 0 && <section className="space-y-3 rounded-lg border border-border py-12 text-center"><CheckCheck className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" /><h2 className="text-lg font-semibold">{status === "OPEN" ? "No open questions" : "No matching decisions"}</h2><p className="px-4 text-sm text-muted-foreground">{status === "OPEN" ? "New workflow checkpoints and employer questions will appear here when they need your decision." : "Choose a different status or decision type."}</p><Link href="/workspace?view=runs" className={buttonVariants({ variant: "outline" })}>Open workflow runs</Link></section>}
      {tasks.length > 0 && <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]"><ul aria-label="Review questions" className={`${selected ? "hidden xl:block" : ""} min-w-0 divide-y divide-border rounded-lg border border-border`}>{tasks.map((task) => <li key={task.id}><button type="button" aria-pressed={selectedId === task.id} onClick={() => { setSelectedId(task.id); const url = new URL(window.location.href); url.searchParams.set("task", task.id); window.history.replaceState(null, "", url) }} className={`w-full space-y-2 p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === task.id ? "bg-muted" : ""}`}><span className="block break-words text-sm font-medium">{task.question}</span><span className="block text-xs text-muted-foreground">{humanize(task.kind)} · {new Date(task.createdAt).toLocaleDateString()}</span><span className="block text-xs text-muted-foreground">{task.reason}</span></button></li>)}</ul><div className="min-w-0">{selected ? <div className="space-y-3"><Button variant="ghost" className="xl:hidden" onClick={() => setSelectedId(null)}>Back to questions</Button><ReviewDecision key={selected.id} task={selected} offline={resource.offline} onChanged={changed} /></div> : <p className="hidden p-6 text-sm text-muted-foreground xl:block">Select a question to inspect its evidence and choose what happens next.</p>}</div></div>}
    </>}
  </div>
}
