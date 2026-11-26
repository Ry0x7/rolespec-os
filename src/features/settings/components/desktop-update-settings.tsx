"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/shared/lib/utils"

import { updateDesktopAutoCheck } from "../actions/desktop-updates.actions"

export function DesktopUpdateSettings({ autoCheck }: { autoCheck: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(autoCheck)
  const [isPending, startTransition] = useTransition()

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
    </section>
  )
}
