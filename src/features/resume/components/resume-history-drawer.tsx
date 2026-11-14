"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Drawer, DrawerHeader, DrawerBody } from "@/shared/ui/drawer"
import { ConfirmDialog } from "@/shared/ui/confirm-dialog"
import { getResumeHistory, type ResumeHistory, type ResumeSnapshotEntry } from "../actions/history"
import { rollbackTailoredResume } from "../actions/rollback"
import { useResumeStore } from "../hooks/use-resume-store"

export function ResumeHistoryDrawer({ resumeId, open, onClose }: { resumeId: string; open: boolean; onClose: () => void }) {
  const [history, setHistory] = useState<ResumeHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [selected, setSelected] = useState<ResumeSnapshotEntry | null>(null)
  const [restoring, setRestoring] = useState(false)
  const dirty = useResumeStore(state => state.isDirty)
  const saving = useResumeStore(state => state.saveStatus === "saving")
  const version = useResumeStore(state => state.resume?.version)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const result = await getResumeHistory(resumeId)
      if ("error" in result) setError(result.error)
      else setHistory(result.data)
    } catch { setError("Could not load resume history. Your edits are preserved; retry when connected.") }
    finally { setLoading(false) }
  }, [resumeId])
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => void load(), 0)
    return () => clearTimeout(timer)
  }, [open, load])
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update(); window.addEventListener("online", update); window.addEventListener("offline", update)
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update) }
  }, [])
  async function restore() {
    if (!selected || restoring || dirty || saving || offline) return
    setRestoring(true); setError(null)
    try {
      const result = await rollbackTailoredResume(resumeId, selected.id)
      if ("error" in result) setError(result.error)
      else { window.location.reload(); return }
    } catch { setError("Could not restore this snapshot. Reload history before retrying.") }
    setRestoring(false); setSelected(null)
  }
  return <>
    <Drawer open={open} onClose={() => { if (!restoring) onClose() }} aria-label="Resume history and validation" width="max-w-2xl">
      <DrawerHeader><h2 className="text-lg font-semibold">History and validation</h2><p className="text-sm text-muted-foreground">Saved revisions, captured sources and the latest recorded validation.</p></DrawerHeader>
      <DrawerBody className="space-y-6">
        <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" loading={loading} disabled={offline || restoring} onClick={() => void load()}>Refresh history</Button>{offline && <p role="status" className="text-sm text-warning">Offline. Showing the last loaded history.</p>}</div>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        {loading && !history && <p role="status" className="text-sm text-muted-foreground">Loading saved history…</p>}
        {history && <>
          <section className="space-y-3"><h3 className="font-semibold">Recorded validation</h3>{history.latestValidation ? <><div className="flex flex-wrap items-center gap-2"><Badge variant="neutral">Historical {history.latestValidation.status.replaceAll("_", " ")}</Badge><time className="text-xs text-muted-foreground" dateTime={history.latestValidation.createdAt}>{new Date(history.latestValidation.createdAt).toLocaleString()}</time></div><p className="text-sm text-muted-foreground">This report is not proof that the current draft passes. The backend does not bind this report to a draft version; edits require a new assisted preparation attempt for validation.</p><ValidationFindings report={history.latestValidation.report} /></> : <p className="text-sm text-muted-foreground">No validation report recorded. Manual editing and PDF export remain available.</p>}</section>
          <section className="space-y-3 border-t border-border pt-5"><h3 className="font-semibold">Requirement evidence</h3>{Array.isArray(history.requirements) && history.requirements.length ? <ul className="space-y-3">{history.requirements.map((requirement, index) => { const item = object(requirement); return <li key={index} className="space-y-2 rounded-md bg-muted/40 p-3 text-sm"><p className="font-medium">{string(item.text) || "Requirement text unavailable"}</p><Badge variant="neutral">{string(item.verdict) || "Unknown"}</Badge><EvidenceQuotes value={item.evidenceRefs} /></li> })}</ul> : <p className="text-sm text-muted-foreground">No requirement comparison recorded for this resume.</p>}</section>
          <section className="space-y-3 border-t border-border pt-5"><h3 className="font-semibold">Captured source revisions</h3><p className="text-sm text-muted-foreground">Restore replaces this tailored resume’s current content with the captured source. It preserves the source resume and records a restore event. These are source snapshots, not an undo for every edit.</p>{(dirty || saving) && <p role="status" className="text-sm text-warning">Save your current edits before restoring a snapshot.</p>}
            {history.snapshots.length ? <ul className="divide-y divide-border">{history.snapshots.map(snapshot => <li className="flex flex-wrap items-start justify-between gap-3 py-3" key={snapshot.id}><div><p className="text-sm font-medium">Source version {snapshot.sourceVersion}</p><p className="text-xs text-muted-foreground">Captured {new Date(snapshot.capturedAt).toLocaleString()} · restored {snapshot.restoreCount} times</p><p className="mt-1 max-w-full break-all font-mono text-xs text-muted-foreground" title={snapshot.hash}>Hash {snapshot.hash.slice(0, 16)}…</p></div><Button variant="outline" size="sm" disabled={dirty || saving || offline || restoring} onClick={() => setSelected(snapshot)}>Restore source v{snapshot.sourceVersion}</Button></li>)}</ul> : <p className="text-sm text-muted-foreground">No captured source snapshots. Older tailored resumes may compare against their live source.</p>}<p className="text-xs text-muted-foreground">Latest {history.snapshots.length} of up to 20 snapshots.</p>
          </section>
          <section className="space-y-3 border-t border-border pt-5"><h3 className="font-semibold">Edit timeline</h3><p className="text-xs text-muted-foreground">Saved version {history.version}{version && version !== history.version ? ` · editor version ${version}; refresh history for the latest saves` : ""}</p>{history.editEvents.length ? <ol className="divide-y divide-border">{history.editEvents.map(event => <li key={event.id} className="space-y-1 py-3"><p className="text-sm font-medium">{event.kind.replaceAll("_", " ").toLowerCase()} · v{event.versionBefore} → v{event.versionAfter}</p><p className="text-sm text-muted-foreground">{event.summary}</p><time className="text-xs text-muted-foreground" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time></li>)}</ol> : <p className="text-sm text-muted-foreground">No edit events recorded yet.</p>}<p className="text-xs text-muted-foreground">Latest {history.editEvents.length} of up to 50 edit events. Arbitrary edit-event undo is unavailable.</p></section>
        </>}
      </DrawerBody>
    </Drawer>
    <ConfirmDialog open={!!selected} title="Restore this captured source?" description={`This replaces all current content in this tailored resume with captured source version ${selected?.sourceVersion ?? ""}. Later edits are not included. Your source resume is unchanged.`} confirmLabel={restoring ? "Restoring…" : "Restore captured source"} destructive onConfirm={() => void restore()} onCancel={() => { if (!restoring) setSelected(null) }} />
  </>
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function string(value: unknown): string { return typeof value === "string" ? value : "" }

function EvidenceQuotes({ value }: { value: unknown }) {
  if (!Array.isArray(value) || !value.length) return <p className="text-xs text-muted-foreground">No candidate evidence reference recorded.</p>
  return <ul className="space-y-2">{value.map((entry, index) => { const ref = object(entry); return <li key={index} className="text-xs text-muted-foreground"><p className="font-medium">{string(ref.label) || "Evidence"} · {string(ref.origin) || "unknown source"}</p>{string(ref.quote) && <blockquote className="mt-1 border-l border-border pl-3">{string(ref.quote)}</blockquote>}{string(ref.ref) && <p className="mt-1 break-all font-mono">{string(ref.ref)}</p>}</li> })}</ul>
}

function ValidationFindings({ report }: { report: unknown }) {
  const data = object(report)
  const issues = Array.isArray(data.issues) ? data.issues : []
  const claims = Array.isArray(data.claims) ? data.claims : []
  return <div className="space-y-4">{issues.length ? <ul className="space-y-3">{issues.map((entry, index) => { const issue = object(entry); return <li key={index} className="space-y-2 rounded-md border border-border p-3 text-sm"><p className="font-medium">{string(issue.code).replaceAll("_", " ")} · {string(issue.severity)}</p><p>{string(issue.message)}</p>{string(issue.claim) && <blockquote className="text-muted-foreground">{string(issue.claim)}</blockquote>}<EvidenceQuotes value={issue.evidenceRefs} /></li> })}</ul> : <p className="text-sm text-muted-foreground">No issues recorded in this report.</p>}
    {claims.length > 0 && <details className="text-sm"><summary className="cursor-pointer">Review {claims.length} recorded claim changes</summary><ul className="mt-3 space-y-3">{claims.map((entry, index) => { const claim = object(entry); return <li key={index} className="space-y-2 rounded-md bg-muted/40 p-3"><p className="font-medium">{string(claim.sectionType)} · {string(claim.change)}</p><p className="text-xs text-muted-foreground">Source</p><p>{string(claim.sourceText) || "No source text"}</p><p className="text-xs text-muted-foreground">Tailored</p><p>{string(claim.tailoredText) || "Removed"}</p><EvidenceQuotes value={claim.evidenceRefs} /></li> })}</ul></details>}
  </div>
}
