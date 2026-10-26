"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Bell, Coins, Wand2 } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { updatePreferences } from "../actions/preferences.actions"
import type { PreferredCurrency, UserPreferences } from "../schemas/preferences.schema"

function Toggle({
  checked,
  onFlip,
  label,
  disabled,
}: {
  checked: boolean
  onFlip: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onFlip}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        checked ? "bg-brand-600" : "bg-input"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  )
}

/**
 * One-click quick toggles for the most-touched settings. Each flip saves
 * immediately — no form submit, no page reload — so fixing a preference is a
 * single press from any settings page that renders this card.
 */
export function QuickToggles({ preferences }: { preferences: UserPreferences }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function save(patch: Partial<UserPreferences>) {
    startTransition(async () => {
      const result = await updatePreferences({
        defaultAiInstructions: preferences.defaultAiInstructions,
        emailNotifications: preferences.emailNotifications,
        preferredCurrency: preferences.preferredCurrency,
        ...patch,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Saved")
      router.refresh()
    })
  }

  return (
    <section aria-label="Quick toggles" className="rounded-lg border border-border bg-muted/20 p-4">
      <p className="text-sm font-semibold">Quick toggles</p>
      <p className="mb-3 text-xs text-muted-foreground">
        One press each — saves instantly.
      </p>
      <ul className="space-y-2">
        <li className="flex items-center justify-between gap-3 rounded-md bg-background/60 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Email notifications</span>
          </span>
          <Toggle
            checked={preferences.emailNotifications}
            disabled={isPending}
            label="Email notifications"
            onFlip={() => save({ emailNotifications: !preferences.emailNotifications })}
          />
        </li>
        <li className="flex items-center justify-between gap-3 rounded-md bg-background/60 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Salary in {preferences.preferredCurrency}</span>
          </span>
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              save({
                preferredCurrency:
                  preferences.preferredCurrency === "USD"
                    ? ("PHP" as PreferredCurrency)
                    : ("USD" as PreferredCurrency),
              })
            }
            className="rounded-full border border-border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            Switch to {preferences.preferredCurrency === "USD" ? "PHP ₱" : "USD $"}
          </button>
        </li>
        <li className="flex items-center justify-between gap-3 rounded-md bg-background/60 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <Wand2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Concise AI tone</span>
          </span>
          <Toggle
            checked={preferences.defaultAiInstructions.length > 0}
            disabled={isPending}
            label="Concise AI tone"
            onFlip={() =>
              save({
                defaultAiInstructions:
                  preferences.defaultAiInstructions.length > 0
                    ? ""
                    : "Keep my tone concise and results-focused, and prefer metrics over adjectives.",
              })
            }
          />
        </li>
      </ul>
    </section>
  )
}
