"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { apiRequest } from "@/shared/lib/api-client"

/** Keeps the last persisted read visible on a failed refresh; never queues writes. */
export function useApiResource<T>(path: string | null) {
  const [result, setResult] = useState<{ path: string; value: T } | null>(null)
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null)
  const [pendingPath, setPendingPath] = useState(path)
  const [offline, setOffline] = useState(false)
  const generation = useRef(0)
  const read = useCallback(async (current: number) => {
    if (!path) return
    try {
      const next = await apiRequest<T>(path)
      if (current === generation.current) { setResult({ path, value: next }); setFailure(null) }
    } catch (reason) {
      if (current === generation.current) setFailure({ path, message: reason instanceof Error ? reason.message : "Could not load. Please retry." })
    } finally {
      if (current === generation.current) setPendingPath(null)
    }
  }, [path])
  const reload = useCallback(async () => {
    setPendingPath(path)
    await read(++generation.current)
  }, [path, read])
  useEffect(() => {
    void read(++generation.current)
    // A numeric request generation, not a DOM ref: invalidate any outstanding read on cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { generation.current++ }
  }, [read])
  useEffect(() => {
    const disconnected = () => setOffline(true)
    const connected = () => { setOffline(false); void reload() }
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener("offline", disconnected)
    window.addEventListener("online", connected)
    return () => { window.removeEventListener("offline", disconnected); window.removeEventListener("online", connected) }
  }, [reload])
  const data = result?.path === path ? result.value : null
  const error = failure?.path === path ? failure.message : null
  const loading = Boolean(path && (pendingPath === path || (!data && !error)))
  return { data, error, loading, offline, reload }
}
