"use client"

import { Button } from "@/shared/ui/button"

export function ResourceState({ loading, error, offline, retry, hasData = false }: {
  loading: boolean; error: string | null; offline: boolean; retry: () => void; hasData?: boolean
}) {
  if (offline) return <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm">You’re offline. {hasData ? "Showing the last loaded data." : "Connect to load this workspace."} Changes are not queued.</p>
  if (error) return <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-error/40 p-3 text-sm"><p className="min-w-0 flex-1">{error}{hasData ? " Showing the last loaded data." : ""}</p><Button variant="outline" onClick={retry} loading={loading}>Retry</Button></div>
  if (loading) return <p role="status" className="text-sm text-muted-foreground">{hasData ? "Refreshing persisted data…" : "Loading…"}</p>
  return null
}
