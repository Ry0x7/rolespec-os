"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { Textarea } from "@/shared/ui/textarea"
import { enhanceCareerGoals } from "../actions/enhance"
import { updateCareerPreferences } from "../actions/career-profile.actions"
import {
  EXPERIENCE_LEVEL_LABELS,
  isLegacyWorkAuthorization,
  SALARY_PERIOD_LABELS,
  WORK_AUTHORIZATION_OPTIONS,
  WORK_MODE_LABELS,
} from "../constants/labels"
import { LocationMultiSelect } from "./location-multi-select"
import type { CareerPreferencesValues } from "../types"

const WORK_MODE_VALUES = ["REMOTE", "HYBRID", "ONSITE"] as const
const EXPERIENCE_LEVEL_VALUES = ["JUNIOR", "MID", "SENIOR", "LEAD", "EXECUTIVE"] as const
const SALARY_PERIOD_VALUES = ["HOURLY", "MONTHLY", "YEARLY"] as const
const SALARY_CURRENCY_VALUES = ["USD", "PHP"] as const

/** Form state is all strings — it mirrors what the fields submit. */
interface FormState {
  experienceLevel: string
  locations: string
  openToRelocation: boolean
  workModes: string[]
  workAuthorization: string
  requiresSponsorship: string
  salaryMin: string
  salaryMax: string
  salaryPeriod: string
  salaryCurrency: string
  careerGoals: string
}

function toFormState(values: CareerPreferencesValues): FormState {
  return {
    experienceLevel: values.experienceLevel ?? "",
    locations: values.locations.join("\n"),
    openToRelocation: values.openToRelocation,
    workModes: values.workModes,
    workAuthorization: values.workAuthorization ?? "",
    requiresSponsorship:
      values.requiresSponsorship === null ? "" : values.requiresSponsorship ? "yes" : "no",
    salaryMin: values.salaryMin === null ? "" : String(values.salaryMin),
    salaryMax: values.salaryMax === null ? "" : String(values.salaryMax),
    salaryPeriod: values.salaryPeriod ?? "",
    salaryCurrency: values.salaryCurrency,
    careerGoals: values.careerGoals ?? "",
  }
}

/**
 * Manual save rather than autosave: this card is a single coherent statement of
 * direction, and the rest of the workspace already uses explicit
 * add/remove/confirm actions.
 *
 * Every field is controlled. Uncontrolled `defaultValue` fields looked right on
 * first paint but a `<select>` snapped back to its mount-time value after the
 * `router.refresh()` that follows a save — the row in the database was correct
 * while the form showed the previous choice.
 */
export function PreferencesForm({ values }: { values: CareerPreferencesValues }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [enhancedNote, setEnhancedNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<FormState>(() => toFormState(values))

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((current) => ({ ...current, [key]: value }))
  }

  function toggleWorkMode(mode: string, checked: boolean) {
    setState((current) => ({
      ...current,
      workModes: checked
        ? [...current.workModes, mode]
        : current.workModes.filter((m) => m !== mode),
    }))
  }

  /*
    Enhance reads the STORED goals, not this textarea, so running it over an
    unsaved edit would overwrite what the user just typed. The button waits for
    a save instead.
  */
  const storedGoals = values.careerGoals ?? ""
  const goalsUnsaved = state.careerGoals !== storedGoals
  const canEnhanceGoals = storedGoals.trim().length > 0 && !goalsUnsaved

  async function handleEnhanceGoals() {
    setEnhancing(true)
    setEnhancedNote(null)
    const result = await enhanceCareerGoals()
    setEnhancing(false)
    if ("error" in result) {
      toast.error(result.error)
      return
    }
    if (result.unchanged) {
      setEnhancedNote("Already clear — nothing was changed.")
      toast.success("Career goals already read clearly")
      return
    }
    // The action already persisted this; the local field is only catching up.
    set("careerGoals", result.enhanced)
    setEnhancedNote("Enhanced and saved. Edit it if it lost your meaning.")
    toast.success("Career goals enhanced")
    router.refresh()
  }

  async function handleSubmit(formData: FormData) {
    setSaving(true)
    setError(null)
    const result = await updateCareerPreferences(formData)
    setSaving(false)
    if (result?.error) {
      setError(result.error)
      toast.error(result.error)
      return
    }
    toast.success("Preferences saved")
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Direction &amp; preferences</CardTitle>
        <CardDescription>
          Where you want to go and what you will accept. Facts about what you have
          done belong in Evidence below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="experienceLevel">Experience level</Label>
              <Select
                id="experienceLevel"
                name="experienceLevel"
                value={state.experienceLevel}
                disabled={saving}
                onChange={(e) => set("experienceLevel", e.target.value)}
              >
                <option value="">— not set —</option>
                {EXPERIENCE_LEVEL_VALUES.map((level) => (
                  <option key={level} value={level}>
                    {EXPERIENCE_LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="requiresSponsorship">Needs visa sponsorship</Label>
              <Select
                id="requiresSponsorship"
                name="requiresSponsorship"
                value={state.requiresSponsorship}
                disabled={saving}
                onChange={(e) => set("requiresSponsorship", e.target.value)}
              >
                <option value="">— not answered —</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="locations">Preferred locations</Label>
            {/* The action still reads one location per line. */}
            <input type="hidden" name="locations" value={state.locations} />
            <LocationMultiSelect
              id="locations"
              value={state.locations.split("\n").filter((line) => line.length > 0)}
              disabled={saving}
              onChange={(next) => set("locations", next.join("\n"))}
            />
            <p className="text-xs text-muted-foreground">Pick as many as apply.</p>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">Work modes</span>
            <div className="flex flex-wrap gap-4">
              {WORK_MODE_VALUES.map((mode) => (
                <label key={mode} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="workModes"
                    value={mode}
                    checked={state.workModes.includes(mode)}
                    disabled={saving}
                    onChange={(e) => toggleWorkMode(mode, e.target.checked)}
                    className="h-4 w-4 rounded border-border bg-muted accent-brand-600"
                  />
                  {WORK_MODE_LABELS[mode]}
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="openToRelocation"
              value="true"
              checked={state.openToRelocation}
              disabled={saving}
              onChange={(e) => set("openToRelocation", e.target.checked)}
              className="h-4 w-4 rounded border-border bg-muted accent-brand-600"
            />
            Open to relocation
          </label>

          <div className="space-y-2">
            <Label htmlFor="workAuthorization">Work authorization</Label>
            <Select
              id="workAuthorization"
              name="workAuthorization"
              value={state.workAuthorization}
              disabled={saving}
              onChange={(e) => set("workAuthorization", e.target.value)}
            >
              {WORK_AUTHORIZATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {/* An older free-text answer stays selectable instead of vanishing. */}
              {isLegacyWorkAuthorization(values.workAuthorization) && (
                <option value={values.workAuthorization}>{values.workAuthorization}</option>
              )}
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="salaryMin">Salary min</Label>
              <Input
                id="salaryMin"
                name="salaryMin"
                type="number"
                min={1}
                value={state.salaryMin}
                disabled={saving}
                onChange={(e) => set("salaryMin", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="salaryMax">Salary max</Label>
              <Input
                id="salaryMax"
                name="salaryMax"
                type="number"
                min={1}
                value={state.salaryMax}
                disabled={saving}
                onChange={(e) => set("salaryMax", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="salaryPeriod">Period</Label>
              <Select
                id="salaryPeriod"
                name="salaryPeriod"
                value={state.salaryPeriod}
                disabled={saving}
                onChange={(e) => set("salaryPeriod", e.target.value)}
              >
                <option value="">— not set —</option>
                {SALARY_PERIOD_VALUES.map((period) => (
                  <option key={period} value={period}>
                    {SALARY_PERIOD_LABELS[period]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="salaryCurrency">Currency</Label>
              <Select
                id="salaryCurrency"
                name="salaryCurrency"
                value={state.salaryCurrency}
                disabled={saving}
                onChange={(e) => set("salaryCurrency", e.target.value)}
              >
                {SALARY_CURRENCY_VALUES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="careerGoals">Career goals</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving || enhancing || !canEnhanceGoals}
                title={
                  goalsUnsaved
                    ? "Save your changes first, then enhance them."
                    : "Sharpen this wording. Nothing new is added."
                }
                onClick={handleEnhanceGoals}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {enhancing ? "Enhancing..." : "Enhance"}
              </Button>
            </div>
            <Textarea
              id="careerGoals"
              name="careerGoals"
              rows={3}
              placeholder="What you are aiming for over the next year or two."
              value={state.careerGoals}
              disabled={saving || enhancing}
              onChange={(e) => set("careerGoals", e.target.value)}
            />
            {enhancedNote && (
              <p className="text-xs text-muted-foreground">{enhancedNote}</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save preferences"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
