"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { Textarea } from "@/shared/ui/textarea"
import { updatePreferences } from "../actions/preferences.actions"
import {
  MAX_AI_INSTRUCTIONS_LENGTH,
  type PreferredCurrency,
  type UserPreferences,
} from "../schemas/preferences.schema"

const CURRENCY_OPTIONS: { value: PreferredCurrency; label: string }[] = [
  { value: "USD", label: "$ US Dollar" },
  { value: "PHP", label: "₱ Philippine Peso" },
]

export function PreferencesForm({ preferences }: { preferences: UserPreferences }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [instructions, setInstructions] = useState(preferences.defaultAiInstructions)
  const [emailNotifications, setEmailNotifications] = useState(
    preferences.emailNotifications
  )
  const [preferredCurrency, setPreferredCurrency] = useState<PreferredCurrency>(
    preferences.preferredCurrency
  )

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updatePreferences({
        defaultAiInstructions: instructions,
        emailNotifications,
        preferredCurrency,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Preferences saved")
      router.refresh()
    })
  }

  /** Low-friction: toggles save instantly without waiting for the form submit. */
  function handleInstantSave(patch: {
    emailNotifications: boolean
    preferredCurrency: PreferredCurrency
  }) {
    startTransition(async () => {
      const result = await updatePreferences({
        defaultAiInstructions: instructions,
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="defaultAiInstructions">Default AI instructions</Label>
        <Textarea
          id="defaultAiInstructions"
          name="defaultAiInstructions"
          rows={5}
          maxLength={MAX_AI_INSTRUCTIONS_LENGTH}
          placeholder="e.g. Keep my tone concise and results-focused, and prefer metrics over adjectives."
          value={instructions}
          disabled={isPending}
          onChange={(e) => setInstructions(e.target.value)}
          className="resize-y"
        />
        <p className="text-xs text-muted-foreground">
          Saved as a hint for future AI generations. {instructions.length}/
          {MAX_AI_INSTRUCTIONS_LENGTH}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="preferredCurrency">Salary display currency</Label>
        <Select
          id="preferredCurrency"
          name="preferredCurrency"
          value={preferredCurrency}
          disabled={isPending}
          onChange={(e) => {
            const next = e.target.value as PreferredCurrency
            setPreferredCurrency(next)
            handleInstantSave({ emailNotifications, preferredCurrency: next })
          }}
        >
          {CURRENCY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">
          Job salaries are shown converted into this currency.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/40 p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Email notifications</p>
          <p className="text-xs text-muted-foreground">
            Receive product updates and job hunt reminders by email.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={emailNotifications}
          aria-label="Email notifications"
          disabled={isPending}
          onClick={() => {
            const next = !emailNotifications
            setEmailNotifications(next)
            handleInstantSave({ emailNotifications: next, preferredCurrency })
          }}
          className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
            emailNotifications ? "bg-brand-600" : "bg-input"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              emailNotifications ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save preferences"}
      </Button>
    </form>
  )
}
