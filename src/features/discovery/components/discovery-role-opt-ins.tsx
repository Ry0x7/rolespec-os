"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/shared/ui/badge"

import { setTargetRoleDiscoveryEnabled } from "@/features/career-profile/actions/career-profile.actions"
import type { PresetRoleOption } from "../presets/types"

/**
 * Approved career-path roles are in Target Roles, but approval alone does not
 * search for them. Each row here is the separate opt-in, and switching it off
 * removes the role from the next discovery run without deleting the target.
 */
export function DiscoveryRoleOptIns({ roles }: { roles: PresetRoleOption[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const recommended = roles.filter((role) => role.source === "CAREER_PATH" && role.active)
  if (recommended.length === 0) return null

  const enabled = recommended.filter((role) => role.discoveryEnabled).length

  function toggle(id: string, next: boolean) {
    if (pending) return
    startTransition(async () => {
      const result = await setTargetRoleDiscoveryEnabled(id, next)
      if ("error" in result) toast.error(result.error)
      else router.refresh()
    })
  }

  return (
    <details className="rounded-md border border-border px-3 py-2">
      <summary className="cursor-pointer rounded-sm text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Recommended roles in discovery · {enabled} of {recommended.length} enabled
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Approving a career recommendation adds it to Target Roles, not to your
        searches. Enable only the ones you want searched; disabled roles stay out of
        every run and saved search.
      </p>
      <ul className="mt-2 space-y-1.5" aria-busy={pending}>
        {recommended.map((role) => (
          <li key={role.id}>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-brand-600"
                checked={role.discoveryEnabled}
                onChange={(event) => toggle(role.id, event.target.checked)}
              />
              <span className="min-w-0">
                {role.title}
                {role.discoveryEnabled ? (
                  <Badge variant="success" size="sm" className="ml-1.5">
                    In discovery
                  </Badge>
                ) : (
                  <Badge variant="neutral" size="sm" className="ml-1.5">
                    Not searched
                  </Badge>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  )
}
