"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Download, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/shared/ui/button"
import { Progress } from "@/shared/ui/progress"
import { cn } from "@/shared/lib/utils"

import {
  getDesktopUpdateStatus,
  requestDesktopUpdateCheck,
  updateDesktopAutoCheck,
} from "../actions/desktop-updates.actions"
import type { DesktopUpdateState, DesktopUpdateStatus } from "../services/desktop-updates"

const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

const IN_PROGRESS_STATES = new Set<DesktopUpdateState>([
  "checking",
  "available",
  "downloading",
  "installing",
])

/** States where the shell has finished answering and no more polling helps. */
const FINAL_STATES = new Set<DesktopUpdateState>([
  "upToDate",
  "declined",
  "error",
  "unavailable",
  "busy",
])

function statusText(status: DesktopUpdateStatus | null): string {
  if (!status) return "Check now without waiting for the next launch."
  if (status.state === "downloading") {
    const version = status.version ? `RoleSpec ${status.version}` : "the update"
    return status.progress === undefined
      ? `Downloading ${version}…`
      : `Downloading ${version} — ${status.progress}%`
  }

  switch (status.state) {
    case "checking":
      return "Checking for updates…"
    case "upToDate":
      return status.currentVersion
        ? `You're on the latest version (${status.currentVersion}).`
        : "You're on the latest version."
    case "available":
      return status.version
        ? `RoleSpec ${status.version} is available. Confirm the install in the dialog.`
        : "An update is available. Confirm the install in the dialog."
    case "installing":
      return "Installing the update. RoleSpec will restart."
    case "declined":
      return "Update postponed. You can install it another time."
    case "error":
      return status.message ?? "The update check failed. Try again."
    case "unavailable":
      return status.message ?? "This build does not include update configuration."
    case "busy":
      return status.message ?? "A check is already running. Try again in a moment."
    default:
      return "Check now without waiting for the next launch."
  }
}

function StatusIcon({ state }: { state: DesktopUpdateState | null }) {
  if (state === "upToDate") {
    return (
      <CheckCircle2
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-500"
        aria-hidden="true"
      />
    )
  }
  if (state === "error" || state === "unavailable") {
    return (
      <AlertTriangle
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500"
        aria-hidden="true"
      />
    )
  }
  if (state === "downloading" || state === "installing" || state === "available") {
    return (
      <Download
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    )
  }
  return (
    <RefreshCw
      className={cn(
        "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground",
        state === "checking" && "animate-spin motion-reduce:animate-none"
      )}
      aria-hidden="true"
    />
  )
}

export function DesktopUpdateSettings({ autoCheck }: { autoCheck: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(autoCheck)
  const [isPending, startTransition] = useTransition()
  const [manualStatus, setManualStatus] = useState<DesktopUpdateStatus | null>(null)
  const [isRequesting, setIsRequesting] = useState(false)
  const poll = useRef<{
    cancelled: boolean
    timer: ReturnType<typeof setTimeout> | null
  } | null>(null)

  useEffect(() => {
    return () => {
      if (poll.current) {
        poll.current.cancelled = true
        if (poll.current.timer) clearTimeout(poll.current.timer)
        poll.current = null
      }
    }
  }, [])

  function stopPolling() {
    if (!poll.current) return
    poll.current.cancelled = true
    if (poll.current.timer) clearTimeout(poll.current.timer)
    poll.current = null
  }

  function startPolling(requestId: string) {
    stopPolling()
    const token = {
      cancelled: false,
      timer: null as ReturnType<typeof setTimeout> | null,
    }
    poll.current = token
    const deadline = Date.now() + POLL_TIMEOUT_MS

    const tick = async () => {
      if (token.cancelled) return
      if (Date.now() > deadline) {
        setManualStatus({
          id: requestId,
          state: "error",
          message: "The update check timed out. Try again.",
        })
        stopPolling()
        return
      }

      const result = await getDesktopUpdateStatus()
      if (token.cancelled) return
      if ("error" in result) {
        setManualStatus({ id: requestId, state: "error", message: result.error })
        stopPolling()
        return
      }

      const status = result.status
      if (status && status.id === requestId) {
        setManualStatus(status)
        if (FINAL_STATES.has(status.state)) {
          stopPolling()
          return
        }
      }

      token.timer = setTimeout(tick, POLL_INTERVAL_MS)
    }

    // The shell polls its request file every second; waiting a little before
    // the first answer avoids reading the previous request's status.
    token.timer = setTimeout(tick, 500)
  }

  function toggle() {
    const next = !enabled
    startTransition(async () => {
      const result = await updateDesktopAutoCheck({ autoCheck: next })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setEnabled(next)
      toast.success(next ? "Automatic update checks enabled" : "Automatic update checks disabled")
      router.refresh()
    })
  }

  async function checkNow() {
    if (isRequesting || (manualStatus && IN_PROGRESS_STATES.has(manualStatus.state))) {
      return
    }

    setIsRequesting(true)
    setManualStatus(null)
    try {
      const result = await requestDesktopUpdateCheck()
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      setManualStatus({ id: result.id, state: "checking" })
      startPolling(result.id)
    } catch {
      toast.error("Could not start an update check.")
    } finally {
      setIsRequesting(false)
    }
  }

  const checking = isRequesting || (manualStatus ? IN_PROGRESS_STATES.has(manualStatus.state) : false)
  const progress =
    manualStatus?.state === "downloading" && manualStatus.progress !== undefined
      ? manualStatus.progress
      : null

  return (
    <section
      aria-label="Desktop updates"
      className="rounded-lg border border-border bg-muted/20 p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Desktop updates
          </p>
          <p className="text-xs text-muted-foreground">
            RoleSpec checks GitHub for a newer signed release about ten seconds after
            launch and asks before installing it. Turn this off to skip the check;
            the change applies the next time the app starts. You can still install a
            newer build manually.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Check for updates automatically"
          disabled={isPending}
          onClick={toggle}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            enabled ? "bg-brand-600" : "bg-input"
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 rounded-full bg-white transition-transform",
              enabled ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground" aria-live="polite">
        {enabled ? "Automatic checks are on." : "Automatic checks are off."}
      </p>

      <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">Check for updates</p>
            <p
              role="status"
              aria-live="polite"
              className="flex items-start gap-1.5 text-xs text-muted-foreground"
            >
              <StatusIcon state={manualStatus?.state ?? null} />
              <span>{statusText(manualStatus)}</span>
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={isRequesting}
            disabled={checking}
            onClick={checkNow}
            className="shrink-0 self-start"
          >
            Check for updates
          </Button>
        </div>
        {progress !== null ? (
          <Progress value={progress} label="Update download progress" size="sm" />
        ) : null}
      </div>
    </section>
  )
}
