"use client"

import { useEffect, useState } from "react"

export function ConnectionStatus() {
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update) }
  }, [])
  if (!offline) return null
  return <div role="status" className="border-b border-border bg-muted px-4 py-3 text-sm">You’re offline. Loaded work remains visible. Reconnect before saving or running preparation; changes are not queued.</div>
}
