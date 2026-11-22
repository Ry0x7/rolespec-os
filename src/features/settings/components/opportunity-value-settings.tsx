"use client"

import { useState } from "react"

import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { currencyOptions } from "@/shared/lib/money/currencies"
import {
  PRESET_WEIGHTS,
  type OpportunitySettings,
  type OpportunityWeights,
} from "@/features/opportunity/types"

import type { PreferredCurrency } from "../schemas/preferences.schema"

/**
 * Opportunity Value settings.
 *
 * Everything here is a weighting or a filter, never an inference: the engine
 * still refuses to guess a workload or a currency. The copy says what each
 * control does to the ranking, because a weight slider with no stated effect is
 * a control the user can only experiment with.
 */

const CURRENCY_OPTIONS: { value: PreferredCurrency; label: string }[] = currencyOptions()

const PRESETS: Array<{
  value: OpportunitySettings["preset"]
  label: string
  help: string
}> = [
  {
    value: "BALANCED",
    label: "Balanced",
    help: "Profile fit, eligibility and pay carry similar weight.",
  },
  {
    value: "PAY_OVER_LOAD",
    label: "High pay / lighter workload",
    help: "Pay and workload dominate; a heavy role cannot offset a big salary.",
  },
]

const WEIGHT_FIELDS: Array<{ key: keyof OpportunityWeights; label: string }> = [
  { key: "compensation", label: "Verified compensation" },
  { key: "effectiveHourly", label: "Effective hourly pay" },
  { key: "workload", label: "Workload" },
  { key: "friction", label: "Application friction" },
  { key: "eligibility", label: "Eligibility" },
  { key: "confidence", label: "Job confidence" },
  { key: "fit", label: "Profile fit" },
  { key: "risk", label: "Risk" },
]

const MINIMUM_PAY_PATTERN = /^\d{1,12}(?:\.\d{1,2})?$/

const WORKLOAD_OPTIONS: Array<{ value: OpportunitySettings["workloadPreference"]; label: string }> = [
  { value: "LIGHTER", label: "Lighter — I want a calm week" },
  { value: "BALANCED", label: "Balanced" },
  { value: "INTENSE", label: "Intense — I am fine with a heavy role" },
]

const UNKNOWN_PAY_OPTIONS: Array<{ value: OpportunitySettings["unknownPay"]; label: string }> = [
  { value: "ALLOW", label: "Allow — keep the posting, no warning" },
  { value: "FLAG", label: "Flag — keep it, but mark the pay as unstated" },
  { value: "REJECT", label: "Reject — hide postings that do not state pay" },
]

function total(weights: OpportunityWeights): number {
  return WEIGHT_FIELDS.reduce((sum, field) => sum + (weights[field.key] || 0), 0)
}

export interface OpportunityValueSettingsProps {
  value: OpportunitySettings
  onChange: (next: OpportunitySettings) => void
  disabled?: boolean
  idPrefix?: string
}

export function OpportunityValueSettings({
  value,
  onChange,
  disabled = false,
  idPrefix = "opportunityValue",
}: OpportunityValueSettingsProps) {
  const id = (name: string) => `${idPrefix}-${name}`

  // Weights are shown when the user opted into them, or when stored settings
  // already carry an explicit set.
  const [customWeights, setCustomWeights] = useState(value.weights !== null)
  const [weights, setWeights] = useState<OpportunityWeights>(
    value.weights ?? PRESET_WEIGHTS[value.preset]
  )

  const amount = value.minimumAnnualPay ?? ""
  const amountInvalid = amount.trim() !== "" && !MINIMUM_PAY_PATTERN.test(amount.trim())

  function update(patch: Partial<OpportunitySettings>) {
    onChange({ ...value, ...patch })
  }

  function changePreset(preset: OpportunitySettings["preset"]) {
    // The preset is a starting point: switching it resets the visible weights
    // so the numbers on screen always match the policy that will be applied.
    const next = PRESET_WEIGHTS[preset]
    setWeights(next)
    update({ preset, weights: customWeights ? next : null })
  }

  function changeWeight(key: keyof OpportunityWeights, raw: string) {
    const parsed = Number(raw)
    const nextValue = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0
    const next = { ...weights, [key]: nextValue }
    setWeights(next)
    update({ weights: next })
  }

  function toggleCustom(next: boolean) {
    setCustomWeights(next)
    if (next) {
      const initial = value.weights ?? PRESET_WEIGHTS[value.preset]
      setWeights(initial)
      update({ weights: initial })
    } else {
      // Back to the preset: send `null`, never a stale copy of the preset's
      // numbers, or a later preset change would not take effect.
      update({ weights: null })
    }
  }

  return (
    <fieldset className="space-y-4 rounded-lg border border-border p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">Opportunity value</legend>
      <p className="text-xs text-muted-foreground">
        How RoleSpec weighs pay, workload and fit when it scores a job. Nothing here
        changes what the posting actually says — unknown facts stay unknown.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={id("preset")}>Preset</Label>
          <Select
            id={id("preset")}
            name="opportunityValue.preset"
            value={value.preset}
            onChange={(e) => changePreset(e.target.value as OpportunitySettings["preset"])}
          >
            {PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            {PRESETS.find((preset) => preset.value === value.preset)?.help}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={id("workload")}>Workload preference</Label>
          <Select
            id={id("workload")}
            name="opportunityValue.workloadPreference"
            value={value.workloadPreference}
            onChange={(e) =>
              update({
                workloadPreference: e.target.value as OpportunitySettings["workloadPreference"],
              })
            }
          >
            {WORKLOAD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Only changes how heavily stated burdens count. A posting that does not say is
            still unknown, not light.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="opportunityValue.customWeights"
            checked={customWeights}
            onChange={(e) => toggleCustom(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Use custom weights
        </label>

        {customWeights && (
          <fieldset className="space-y-3 rounded-md border border-border/70 p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Dimension weights
            </legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {WEIGHT_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label htmlFor={id(`weight-${field.key}`)} className="text-xs">
                    {field.label}
                  </Label>
                  <Input
                    id={id(`weight-${field.key}`)}
                    name={`opportunityValue.weights.${field.key}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    value={String(weights[field.key])}
                    onChange={(e) => changeWeight(field.key, e.target.value)}
                    className="w-24"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Total {total(weights)}. Weights are normalised when a job is scored, so they
              do not have to add up to 100.
            </p>
          </fieldset>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={id("minimumAnnualPay")}>Minimum annual pay</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={id("minimumAnnualPay")}
            name="opportunityValue.minimumAnnualPay"
            inputMode="decimal"
            placeholder="e.g. 900000"
            value={amount}
            onChange={(e) => update({ minimumAnnualPay: e.target.value.trim() === "" ? null : e.target.value })}
            aria-invalid={amountInvalid}
            aria-describedby={amountInvalid ? id("minimum-pay-error") : id("minimum-pay-help")}
            className="min-w-40 flex-1"
          />
          <Select
            id={id("minimumPayCurrency")}
            name="opportunityValue.minimumPayCurrency"
            aria-label="Minimum pay currency"
            value={value.minimumPayCurrency ?? ""}
            onChange={(e) =>
              update({
                minimumPayCurrency: (e.target.value || null) as OpportunitySettings["minimumPayCurrency"],
              })
            }
            className="w-48"
          >
            <option value="">— currency —</option>
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        {amountInvalid ? (
          <p id={id("minimum-pay-error")} className="text-xs text-destructive" role="alert">
            Enter a yearly amount, for example 900000 or 900000.50.
          </p>
        ) : (
          <p id={id("minimum-pay-help")} className="text-xs text-muted-foreground">
            Annual figure. It is only applied to postings that state pay in the same
            currency — no rate is guessed to make a match.
          </p>
        )}
        {!amountInvalid && amount.trim() !== "" && !value.minimumPayCurrency && (
          <p className="text-xs text-muted-foreground" role="status">
            Choose a currency so the floor can be applied.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="opportunityValue.minimumPayStrict"
            checked={value.minimumPayStrict}
            onChange={(e) => update({ minimumPayStrict: e.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          Strict — reject postings below this
        </label>
        <p className="text-xs text-muted-foreground">
          Without strict, a below-floor posting is kept and marked. A commission-only figure
          is never treated as guaranteed, so it cannot be rejected this way.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={id("unknownPay")}>Postings that do not state pay</Label>
        <Select
          id={id("unknownPay")}
          name="opportunityValue.unknownPay"
          value={value.unknownPay}
          onChange={(e) =>
            update({ unknownPay: e.target.value as OpportunitySettings["unknownPay"] })
          }
        >
          {UNKNOWN_PAY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
    </fieldset>
  )
}
