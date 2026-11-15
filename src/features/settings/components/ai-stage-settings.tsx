"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Select } from "@/shared/ui/select"
import { ConfirmDialog } from "@/shared/ui/confirm-dialog"
import { ResourceState } from "@/shared/components/resource-state"
import { TaskTabs } from "@/shared/components/task-tabs"
import { useApiResource } from "@/shared/hooks/use-api-resource"
import { apiRequest } from "@/shared/lib/api-client"
import { AI_PROVIDER_META, USER_AI_PROVIDERS, type UserAiProvider } from "@/shared/lib/ai-providers/constants"
import { AI_STAGE_VALUES, type AiStage } from "@/shared/lib/ai-stages"
import type { UserAiStageSettingView } from "@/features/settings/services/user-ai-stage-settings.service"

export function AiStageSettings() {
  const resource = useApiResource<{ items: UserAiStageSettingView[]; availableStages: AiStage[] }>("/api/settings/ai-stages")
  return <div className="space-y-6">
    <p className="max-w-prose text-sm text-muted-foreground">Overrides apply only to AI calls in the selected stage. Stages without an override use your normal provider. Manual editing, tracking and deterministic ranking remain available without AI. <Link href="/settings/ai" className="text-brand-400 underline underline-offset-4">Normal AI settings</Link></p>
    <ResourceState {...resource} hasData={!!resource.data} retry={() => void resource.reload()} />
    {resource.data && <TaskTabs label="AI preparation stage" items={AI_STAGE_VALUES.map(stage => ({ id: `stage-${stage}`, label: stage.charAt(0) + stage.slice(1).toLowerCase() }))}>{AI_STAGE_VALUES.map(stage => <StageEditor key={stage} stage={stage} saved={resource.data!.items.find(item => item.stage === stage)} offline={resource.offline} onChanged={resource.reload} />)}</TaskTabs>}
    <p className="text-xs text-muted-foreground">Saved does not mean connection-tested. No per-stage connection test is available. Local and CLI providers require a running, configured server on this machine.</p>
  </div>
}

function StageEditor({ stage, saved, offline, onChanged }: { stage: AiStage; saved?: UserAiStageSettingView; offline: boolean; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [provider, setProvider] = useState<UserAiProvider>(saved?.provider ?? "openai")
  const [model, setModel] = useState(saved?.model ?? "")
  const [key, setKey] = useState("")
  const [clearKey, setClearKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  async function save() {
    if (busy || offline) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      await apiRequest("/api/settings/ai-stages", { method: "PUT", body: JSON.stringify({ stage, provider, model: model.trim(), ...(key.trim() ? { apiKey: key.trim() } : clearKey ? { clearApiKey: true } : {}) }) })
      setKey(""); setClearKey(false); setEditing(false); await onChanged(); setSuccess("Override saved.")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save. Please retry.") }
    finally { setBusy(false) }
  }
  async function remove() {
    if (busy || offline) return
    setConfirmClear(false); setBusy(true); setError(null); setSuccess(null)
    try { await apiRequest(`/api/settings/ai-stages?stage=${stage}`, { method: "DELETE" }); setEditing(false); setKey(""); await onChanged(); setSuccess("Using the normal provider again.") }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove the override. Please retry.") }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 py-5" aria-labelledby={`stage-${stage}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id={`stage-${stage}`} className="font-semibold">{stage.charAt(0) + stage.slice(1).toLowerCase()}</h2><p className="mt-1 text-sm text-muted-foreground">{saved ? `${AI_PROVIDER_META[saved.provider].label} · ${saved.model ?? saved.defaultModel}${saved.last4 ? ` · key ending ${saved.last4}` : " · no saved stage key"}` : "Uses the normal provider"}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy || offline} onClick={() => { if (editing) { setEditing(false); setKey(""); setClearKey(false) } else { setProvider(saved?.provider ?? "openai"); setModel(saved?.model ?? ""); setError(null); setSuccess(null); setEditing(true) } }}>{editing ? "Cancel edit" : saved ? "Edit override" : "Add override"}</Button>{saved && <Button size="sm" variant="ghost" disabled={busy || offline} onClick={() => setConfirmClear(true)}>Use normal provider</Button>}</div></div>
    {success && <p role="status" className="text-sm text-success">{success}</p>}
    {error && <p role="alert" className="text-sm text-error">{error} Retry the same action.</p>}
    {editing && <form className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void save() }}>
      <label className="space-y-1 text-sm">Provider<Select aria-label="Provider" value={provider} disabled={busy} onChange={event => setProvider(event.target.value as UserAiProvider)}>{USER_AI_PROVIDERS.map(value => <option key={value} value={value}>{AI_PROVIDER_META[value].label}</option>)}</Select></label>
      <label className="space-y-1 text-sm">Model (optional)<Input aria-label="Model (optional)" value={model} maxLength={200} disabled={busy} onChange={event => setModel(event.target.value)} placeholder="Use provider default" /></label>
      <label className="space-y-1 text-sm sm:col-span-2">{saved?.configured ? "Replace saved key (optional)" : "API key (optional)"}<Input type="password" value={key} maxLength={500} autoComplete="new-password" disabled={busy} onChange={event => setKey(event.target.value)} /><span className="block text-xs text-muted-foreground">Leave blank to keep the existing key. The key is never returned by the server.</span></label>
      {saved?.configured && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={clearKey} disabled={busy || !!key.trim()} onChange={event => setClearKey(event.target.checked)} />Remove the stored key when saving</label>}
      {saved && provider !== saved.provider && <p className="text-sm text-warning sm:col-span-2">Changing provider clears the old provider’s key unless you supply a new key.</p>}
      <div className="sm:col-span-2"><Button type="submit" loading={busy} disabled={offline}>Save {stage.toLowerCase()} override</Button></div>
    </form>}
    <ConfirmDialog open={confirmClear} title={`Remove the ${stage.toLowerCase()} override?`} description="The stage will use your normal provider and model. Its saved stage key will be removed." confirmLabel="Use normal provider" destructive onConfirm={() => void remove()} onCancel={() => setConfirmClear(false)} />
  </section>
}
