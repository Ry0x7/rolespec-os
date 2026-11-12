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
  const emailNotifications = preferences.emailNotifications
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

      <div className="space-y-1 rounded-md border border-border bg-muted/40 p-3">
        <p className="text-sm font-medium">Reminders stay in your workspace</p>
        <p className="text-xs text-muted-foreground">Use the attention tray and Staging &amp; follow-ups to act on saved reminders. Email delivery is not connected. Your existing stored notification preference is preserved.</p>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save preferences"}
      </Button>
    </form>
  )
}
