"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { Textarea } from "@/shared/ui/textarea"
import { updatePreferences } from "../actions/preferences.actions"
import {
  MAX_AI_INSTRUCTIONS_LENGTH,
  type PreferredCurrency,
  type UserPreferences,
} from "../schemas/preferences.schema"
import {
  DAILY_JOB_GOAL_MAX,
  DAILY_JOB_GOAL_MIN,
} from "@/features/jobs/constants/goals"

const CURRENCY_OPTIONS: { value: PreferredCurrency; label: string }[] = [
  { value: "USD", label: "$ US Dollar" },
  { value: "PHP", label: "₱ Philippine Peso" },
]

export function PreferencesForm({ preferences }: { preferences: UserPreferences }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dailyGoal, setDailyGoal] = useState(
    String(preferences.dailyApplicationGoal)
  )
  const [instructions, setInstructions] = useState(preferences.defaultAiInstructions)
  const emailNotifications = preferences.emailNotifications
  const [preferredCurrency, setPreferredCurrency] = useState<PreferredCurrency>(
    preferences.preferredCurrency
  )

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updatePreferences({
        dailyApplicationGoal: Number(dailyGoal),
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
    // A half-typed goal must not block the currency toggle. The form submit
    // still reports the invalid value; an instant toggle keeps the saved one.
    const parsedGoal = Number(dailyGoal)
    const savedGoal =
      Number.isInteger(parsedGoal) &&
      parsedGoal >= DAILY_JOB_GOAL_MIN &&
      parsedGoal <= DAILY_JOB_GOAL_MAX
        ? parsedGoal
        : preferences.dailyApplicationGoal

    startTransition(async () => {
      const result = await updatePreferences({
        dailyApplicationGoal: savedGoal,
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
        <Label htmlFor="dailyApplicationGoal">Daily application goal</Label>
        <Input
          id="dailyApplicationGoal"
          name="dailyApplicationGoal"
          type="number"
          inputMode="numeric"
          min={DAILY_JOB_GOAL_MIN}
          max={DAILY_JOB_GOAL_MAX}
          step={1}
          value={dailyGoal}
          disabled={isPending}
          onChange={(e) => setDailyGoal(e.target.value)}
          className="w-24"
        />
        <p className="text-xs text-muted-foreground">
          How many applications you aim to submit each day ({DAILY_JOB_GOAL_MIN}–
          {DAILY_JOB_GOAL_MAX}). The dashboard uses this for today&apos;s progress.
        </p>
      </div>

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
