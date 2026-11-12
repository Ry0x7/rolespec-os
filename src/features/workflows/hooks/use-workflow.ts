"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { apiRequest } from "@/shared/lib/api-client"
import type { WorkflowEventDTO, WorkflowRunDTO } from "../types"
import { isLiveRun } from "../client/presentation"

export type WorkflowConnection = "loading" | "live" | "interrupted" | "offline" | "idle" | "hidden"

/** One stream for the selected run; every progress message is a persisted DTO. */
export function useWorkflow(runId: string) {
  const [run, setRun] = useState<WorkflowRunDTO | null>(null)
  const [events, setEvents] = useState<WorkflowEventDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [connection, setConnection] = useState<WorkflowConnection>("loading")
  const [revision, setRevision] = useState(0)
  const currentRunId = useRef("")
  const replace = useCallback((next: WorkflowRunDTO) => {
    setRun(next)
  }, [])
  const reconnect = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let disposed = false
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    let lastEventsUpdate = ""
    let loadingEvents = false
    let eventsDirty = false
    let requestVersion = 0

    async function loadEvents() {
      if (disposed) return
      if (loadingEvents) { eventsDirty = true; return }
      loadingEvents = true
      try {
        const result = await apiRequest<{ events: WorkflowEventDTO[] }>(`/api/workflows/${encodeURIComponent(runId)}/events?limit=200`)
        if (!disposed) {
          setEvents([...new Map(result.events.map((event) => [event.id, event])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
          setEventsError(null)
        }
      } catch (reason) {
        if (!disposed) setEventsError(reason instanceof Error ? reason.message : "Event history could not load.")
      } finally {
        loadingEvents = false
        if (eventsDirty && !disposed) { eventsDirty = false; void loadEvents() }
      }
    }
    function stop() {
      source?.close()
      source = null
      if (timer) clearTimeout(timer)
      timer = null
    }
    function currentVisibility() {
      if (!navigator.onLine) { setConnection("offline"); return false }
      if (document.visibilityState === "hidden") { setConnection("hidden"); return false }
      return true
    }
    async function refreshAndConnect() {
      const version = ++requestVersion
      stop()
      if (disposed || !currentVisibility()) { setLoading(false); return }
      try {
        const result = await apiRequest<{ workflow: WorkflowRunDTO }>(`/api/workflows/${encodeURIComponent(runId)}`)
        if (disposed || version !== requestVersion || !currentVisibility()) return
        if (currentRunId.current !== runId) { currentRunId.current = runId; setEvents([]) }
        replace(result.workflow)
        setError(null)
        void loadEvents()
        if (!isLiveRun(result.workflow)) { setConnection("idle"); return }
        const stream = new EventSource(`/api/workflows/${encodeURIComponent(runId)}/stream`)
        source = stream
        stream.onopen = () => { if (!disposed && source === stream) setConnection("live") }
        stream.addEventListener("progress", (message) => {
          if (disposed || source !== stream) return
          try {
            const next = JSON.parse((message as MessageEvent).data) as WorkflowRunDTO
            if (next.id !== runId || !Array.isArray(next.steps)) throw new Error("Unreadable workflow update")
            replace(next)
            setError(null)
            setConnection(isLiveRun(next) ? "live" : "idle")
            const eventsUpdate = JSON.stringify([next.state, next.updatedAt, next.openReviewTaskIds, next.steps.map((step) => [step.id, step.status, step.attempts, step.finishedAt, step.lastError])])
            if (eventsUpdate !== lastEventsUpdate) { failures = 0; lastEventsUpdate = eventsUpdate; void loadEvents() }
            if (!isLiveRun(next)) stop()
          } catch { interrupted() }
        })
        stream.addEventListener("ping", () => { if (!disposed && source === stream) { failures = 0; setConnection("live") } })
        stream.onerror = () => { if (source === stream) interrupted() }
      } catch (reason) {
        if (!disposed && version === requestVersion) {
          setError(reason instanceof Error ? reason.message : "Could not load this preparation.")
          interrupted()
        }
      } finally { if (!disposed) setLoading(false) }
    }
    function interrupted() {
      requestVersion++
      stop()
      if (disposed || !currentVisibility()) return
      setConnection("interrupted")
      if (failures >= 5) return
      const wait = [1000, 2000, 5000, 10000, 30000][failures++]
      timer = setTimeout(() => void refreshAndConnect(), wait)
    }
    function visibilityChanged() {
      requestVersion++
      stop()
      if (currentVisibility()) { failures = 0; void refreshAndConnect() }
    }
    void refreshAndConnect()
    window.addEventListener("offline", visibilityChanged)
    window.addEventListener("online", visibilityChanged)
    document.addEventListener("visibilitychange", visibilityChanged)
    return () => {
      disposed = true
      stop()
      window.removeEventListener("offline", visibilityChanged)
      window.removeEventListener("online", visibilityChanged)
      document.removeEventListener("visibilitychange", visibilityChanged)
    }
  }, [runId, revision, replace])

  return { run: run?.id === runId ? run : null, events: run?.id === runId ? events : [], error, eventsError, loading, connection, replace, reconnect }
}
