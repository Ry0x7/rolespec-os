"use client"

import { useState } from "react"
import { Button } from "@/shared/ui/button"
import { Drawer, DrawerHeader, DrawerBody } from "@/shared/ui/drawer"
import { exportResumePdf } from "@/features/export/actions/export-pdf"
import { useResumeStore } from "../hooks/use-resume-store"

export function ResumePdfDrawer({ resumeId, onSave, open, onClose }: { resumeId: string; onSave: () => void | Promise<void>; open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [singlePage, setSinglePage] = useState(false)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [exportedVersion, setExportedVersion] = useState<number | undefined>()
  const [exportedPresentation, setExportedPresentation] = useState<string | null>(null)
  const version = useResumeStore(state => state.resume?.version)
  const dirty = useResumeStore(state => state.isDirty)
  const saving = useResumeStore(state => state.saveStatus === "saving")
  const template = useResumeStore(state => state.resume?.template)
  const customization = useResumeStore(state => state.customization)
  const groupAdditional = useResumeStore(state => state.groupAdditional)
  const groupAdditionalTitle = useResumeStore(state => state.groupAdditionalTitle)
  const presentation = JSON.stringify({ template, customization, groupAdditional, groupAdditionalTitle, singlePage })
  const stale = !!url && (dirty || exportedVersion !== version || exportedPresentation !== presentation)
  async function generate() {
    if (busy || useResumeStore.getState().saveStatus === "saving") return
    if (!navigator.onLine) { setError("You’re offline. Reconnect, then generate the PDF again. No request is queued."); return }
    setBusy(true); setError(null); setWarning(null)
    try {
      if (useResumeStore.getState().isDirty) await onSave()
      const state = useResumeStore.getState()
      if (state.isDirty || state.saveStatus === "saving") { setError("Your edits have not been saved. Resolve the save error before exporting."); return }
      const requestedVersion = state.resume?.version
      const options = { groupAdditional: state.groupAdditional, groupAdditionalTitle: state.groupAdditionalTitle, customization: state.customization, singlePage }
      const requestedPresentation = JSON.stringify({ template: state.resume?.template, customization: options.customization, groupAdditional: options.groupAdditional, groupAdditionalTitle: options.groupAdditionalTitle, singlePage })
      const result = await exportResumePdf(resumeId, options)
      if (!("success" in result) || !result.success) { setError(result.error ?? "Could not generate the PDF. Please retry."); return }
      setUrl(result.pdfUrl); setExportedVersion(requestedVersion); setExportedPresentation(requestedPresentation)
      setPageCount("pageCount" in result && typeof result.pageCount === "number" ? result.pageCount : null)
      setWarning("warning" in result && typeof result.warning === "string" ? result.warning : null)
    } catch { setError("Could not generate the PDF. Your resume is preserved; retry when connected.") }
    finally { setBusy(false) }
  }
  return <Drawer open={open} onClose={() => { if (!busy) onClose() }} aria-label="Generated PDF preview" width="max-w-4xl"><DrawerHeader><h2 className="text-lg font-semibold">PDF preview</h2><p className="text-sm text-muted-foreground">Generate the actual PDF from saved content. This is separate from the live HTML preview and uses no AI.</p></DrawerHeader><DrawerBody className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><Button loading={busy} disabled={saving} onClick={() => void generate()}>{url ? "Regenerate PDF" : "Generate PDF preview"}</Button><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={singlePage} onChange={event => setSinglePage(event.target.checked)} />Try to fit one page</label></div>
    {saving && <p role="status" className="text-sm text-muted-foreground">Wait for the current save to finish before generating a PDF.</p>}
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {warning && <p role="status" className="text-sm text-warning">{warning} Content has not been truncated.</p>}
    {stale && <p role="status" className="text-sm text-warning">This PDF does not match the latest edits or presentation settings. Regenerate it to preview the saved draft.</p>}
    {pageCount !== null && <p className="text-sm text-muted-foreground">Rendered PDF: {pageCount} {pageCount === 1 ? "page" : "pages"}. Page count is measured from the generated file.</p>}
    {url ? <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-5"><h3 className="font-semibold">Generated PDF ready</h3><p className="max-w-prose text-sm text-muted-foreground">The workspace security policy blocks embedded documents. Open the actual generated file in a new tab to inspect its pages in your browser’s PDF viewer.</p><a className="inline-flex min-h-11 items-center rounded-md text-sm text-brand-400 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={url} target="_blank" rel="noopener noreferrer">Preview generated PDF in a new tab ↗</a><p className="text-xs text-muted-foreground">Your browser may download the file instead if PDF preview is disabled. If the export has expired, regenerate it.</p></div> : <p className="text-sm text-muted-foreground">No PDF generated in this preview yet. Generate it to inspect the exact pages before applying.</p>}
  </DrawerBody></Drawer>
}
