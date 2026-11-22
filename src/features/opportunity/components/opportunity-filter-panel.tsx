"use client"

import { useEffect, useId, useRef, useState } from "react"
import { SlidersHorizontal, X } from "lucide-react"

import type { ExperienceLevel, JobRiskLevel, SalaryPeriod } from "@/generated/prisma/enums"
import { SUPPORTED_CURRENCIES } from "@/shared/lib/money/currencies"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { cn } from "@/shared/lib/utils"

import {
  ALLOWED_WORKLOAD_FILTERS,
  DEFAULT_CRITERIA,
  QUICK_PRESETS,
  criteriaForPreset,
  hasActiveCriteria,
  presetForCriteria,
  type OpportunityFilterCriteria,
  type QuickPresetId,
} from "../filters"

/**
 * One filter panel for Discovery, Saved jobs and Ranking.
 *
 * The default view is four preset chips and a `Filters` button: a job list is
 * something a person scrolls, not a form they fill in. Everything narrow lives
 * behind the disclosure, and each screen renders the same panel so a filter
 * learned on one screen behaves identically on the next.
 *
 * Persistence: the criteria are written to `localStorage` so a reload keeps the
 * user's view. The parent owns the URL, because only it knows which other
 * parameters (status, search, page) must survive. On mount, stored criteria are
 * restored only when the parent starts from the default set — a URL that says
 * `?preset=HIGH_PAY` always wins over the remembered one.
 */

export const OPPORTUNITY_FILTER_STORAGE_KEY = "rolespec:opportunity-filters:v1"

export interface OpportunityFilterCounts {
  eligible: number
  unknown: number
  excluded: number
}

export interface OpportunityFilterPanelProps {
  criteria: OpportunityFilterCriteria
  onChange: (criteria: OpportunityFilterCriteria) => void
  onReset: () => void
  counts?: OpportunityFilterCounts
  /** Disable the controls while the parent is fetching. */
  disabled?: boolean
  /** Set false on screens where the URL is the only source of truth. */
  persist?: boolean
  /**
   * Per-screen key. Saved jobs, Discovery and Ranking collect different
   * postings, so a pay floor typed on one must not silently reshape another.
   */
  storageKey?: string
  className?: string
}

const PERIODS: Array<{ value: SalaryPeriod | "ANY"; label: string }> = [
  { value: "ANY", label: "Any period" },
  { value: "HOURLY", label: "Hourly" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Annual" },
  { value: "CONTRACT", label: "Contract" },
]

const HOME_MODES = [
  { value: "ANY", label: "Any work mode" },
  { value: "REMOTE", label: "Remote only" },
  { value: "REMOTE_OR_HYBRID", label: "Remote or hybrid" },
] as const

const EXPERIENCES: Array<{ value: ExperienceLevel | "ANY"; label: string }> = [
  { value: "ANY", label: "Any experience" },
  { value: "JUNIOR", label: "Junior" },
  { value: "MID", label: "Mid" },
  { value: "SENIOR", label: "Senior" },
  { value: "LEAD", label: "Lead" },
  { value: "EXECUTIVE", label: "Executive" },
]

const RISKS: Array<{ value: JobRiskLevel | "ANY"; label: string }> = [
  { value: "ANY", label: "Any risk" },
  { value: "LOW", label: "Low risk" },
  { value: "MEDIUM", label: "Medium risk" },
  { value: "HIGH", label: "High risk" },
]

const FRESHNESS = [
  { value: "", label: "Any age" },
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
]

const SORTS = [
  { value: "BEST_VALUE", label: "Best value" },
  { value: "PAY_DESC", label: "Highest pay" },
  { value: "EASIEST", label: "Easiest to apply" },
  { value: "FRESHEST", label: "Freshest" },
  { value: "NEWEST", label: "Newest added" },
] as const

const WORKLOAD_LABELS: Record<(typeof ALLOWED_WORKLOAD_FILTERS)[number], string> = {
  ON_CALL: "On-call",
  OVERTIME: "Overtime",
  SHIFTS: "Shifts",
  QUOTAS: "Quotas",
  TRAVEL: "Travel",
  ROLE_BREADTH: "Broad role",
  SCHEDULE_RIGIDITY: "Rigid schedule",
}

function activeFilterCount(criteria: OpportunityFilterCriteria): number {
  let count = 0
  if (criteria.minPay !== null) count += 1
  if (criteria.currency !== null) count += 1
  if (criteria.period !== "ANY") count += 1
  if (criteria.remote !== "ANY") count += 1
  if (criteria.location.trim() !== "") count += 1
  if (criteria.experience !== "ANY") count += 1
  if (criteria.risk !== "ANY") count += 1
  if (criteria.maxAgeDays !== null) count += 1
  if (criteria.minFriction !== null) count += 1
  if (criteria.minWorkload !== null) count += 1
  if (criteria.requireKnownPay) count += 1
  count += criteria.workload.length
  return count
}

function readStoredCriteria(storageKey: string): OpportunityFilterCriteria | null {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OpportunityFilterCriteria>
    if (!parsed || typeof parsed !== "object") return null
    // Merge over the defaults so a schema addition cannot produce `undefined`.
    const merged: OpportunityFilterCriteria = { ...DEFAULT_CRITERIA, ...parsed }
    return hasActiveCriteria(merged) ? merged : null
  } catch {
    return null
  }
}

export function OpportunityFilterPanel({
  criteria,
  onChange,
  onReset,
  counts,
  disabled = false,
  persist = true,
  storageKey = OPPORTUNITY_FILTER_STORAGE_KEY,
  className,
}: OpportunityFilterPanelProps) {
  const [open, setOpen] = useState(false)
  const advancedId = useId()
  // The pay floor is an extra constraint on any preset, not a fifth preset, so
  // it does not turn the highlighted chip into "Custom".
  const preset = presetForCriteria({ ...criteria, minPay: null, currency: null })
  const activeCount = activeFilterCount(criteria)
  const restoredRef = useRef(false)

  useEffect(() => {
    if (!persist || restoredRef.current) return
    restoredRef.current = true
    if (JSON.stringify(criteria) !== JSON.stringify(DEFAULT_CRITERIA)) return
    const stored = readStoredCriteria(storageKey)
    if (stored) onChange(stored)
    // Restore runs once per mount, by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!persist) return
    try {
      if (hasActiveCriteria(criteria)) {
        window.localStorage.setItem(storageKey, JSON.stringify(criteria))
      } else {
        window.localStorage.removeItem(storageKey)
      }
    } catch {
      // Private mode or a full quota: filtering still works, it just forgets.
    }
  }, [criteria, persist, storageKey])

  const update = (patch: Partial<OpportunityFilterCriteria>) => onChange({ ...criteria, ...patch })

  const applyPreset = (id: Exclude<QuickPresetId, "CUSTOM">) => {
    onChange({ ...criteriaForPreset(id), minPay: criteria.minPay, currency: criteria.currency })
  }

  return (
    <section
      aria-label="Filter opportunities"
      className={cn("rounded-xl border border-border bg-card", className)}
    >
      <div className="flex flex-wrap items-center gap-2 p-3">
        <div role="group" aria-label="Quick filters" className="flex flex-wrap items-center gap-1.5">
          {QUICK_PRESETS.map((definition) => {
            const active = preset === definition.id
            return (
              <button
                key={definition.id}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                title={definition.description}
                onClick={() => applyPreset(definition.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-brand-600 bg-brand-700 text-white"
                    : "border-border bg-muted text-muted-foreground hover:bg-input hover:text-foreground",
                  "disabled:opacity-50"
                )}
              >
                {definition.label}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={open}
            aria-controls={advancedId}
            disabled={disabled}
            onClick={() => setOpen((current) => !current)}
          >
            <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
            Filters
            {activeCount > 0 && (
              <span className="rounded-full bg-brand-700 px-1.5 text-[10px] font-semibold text-white">
                {activeCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {counts && (
        <p aria-live="polite" className="px-3 pb-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{counts.eligible}</span> eligible
          <span aria-hidden="true"> · </span>
          <span className="font-medium text-foreground">{counts.unknown}</span> need more info
          <span aria-hidden="true"> · </span>
          <span className="font-medium text-foreground">{counts.excluded}</span> excluded
        </p>
      )}

      <div id={advancedId} hidden={!open} className="border-t border-border">
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${advancedId}-pay`}>Minimum pay (annual)</Label>
            <div className="flex gap-2">
              <Input
                id={`${advancedId}-pay`}
                inputMode="decimal"
                placeholder="e.g. 900000"
                value={criteria.minPay ?? ""}
                disabled={disabled}
                onChange={(event) => {
                  const next = event.target.value.trim()
                  update({
                    minPay: next === "" || !Number.isFinite(Number(next)) ? null : next,
                    currency: criteria.currency ?? "PHP",
                  })
                }}
              />
              <Select
                aria-label="Minimum pay currency"
                className="w-24 shrink-0"
                value={criteria.currency ?? "PHP"}
                disabled={disabled}
                onChange={(event) => update({ currency: event.target.value as OpportunityFilterCriteria["currency"] })}
              >
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Compared in the same currency only; nothing is converted here.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${advancedId}-period`}>Pay period</Label>
            <Select
              id={`${advancedId}-period`}
              value={criteria.period}
              disabled={disabled}
              onChange={(event) => update({ period: event.target.value as SalaryPeriod | "ANY" })}
            >
              {PERIODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${advancedId}-remote`}>Remote eligibility</Label>
            <Select
              id={`${advancedId}-remote`}
              value={criteria.remote}
              disabled={disabled}
              onChange={(event) =>
                update({ remote: event.target.value as OpportunityFilterCriteria["remote"] })
              }
            >
              {HOME_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${advancedId}-location`}>Location</Label>
            <Input
              id={`${advancedId}-location`}
              placeholder="City or country"
              value={criteria.location}
              disabled={disabled}
              onChange={(event) => update({ location: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${advancedId}-experience`}>Experience</Label>
            <Select
              id={`${advancedId}-experience`}
              value={criteria.experience}
              disabled={disabled}
              onChange={(event) =>
                update({ experience: event.target.value as ExperienceLevel | "ANY" })
              }
            >
              {EXPERIENCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${advancedId}-fresh`}>Freshness</Label>
            <Select
              id={`${advancedId}-fresh`}
              value={criteria.maxAgeDays === null ? "" : String(criteria.maxAgeDays)}
              disabled={disabled}
              onChange={(event) =>
                update({ maxAgeDays: event.target.value === "" ? null : Number(event.target.value) })
              }
            >
              {FRESHNESS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${advancedId}-risk`}>Risk</Label>
            <Select
              id={`${advancedId}-risk`}
              value={criteria.risk}
              disabled={disabled}
              onChange={(event) => update({ risk: event.target.value as JobRiskLevel | "ANY" })}
            >
              {RISKS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${advancedId}-friction`}>Application friction</Label>
            <Select
              id={`${advancedId}-friction`}
              value={criteria.minFriction === null ? "" : String(criteria.minFriction)}
              disabled={disabled}
              onChange={(event) =>
                update({ minFriction: event.target.value === "" ? null : Number(event.target.value) })
              }
            >
              <option value="">Any effort</option>
              <option value="50">At most moderate effort</option>
              <option value="70">Low effort only</option>
              <option value="85">Very low effort only</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${advancedId}-sort`}>Sort</Label>
            <Select
              id={`${advancedId}-sort`}
              value={criteria.sort}
              disabled={disabled}
              onChange={(event) =>
                update({ sort: event.target.value as OpportunityFilterCriteria["sort"] })
              }
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-3 border-t border-border px-3 py-3 sm:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Workload must state</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {ALLOWED_WORKLOAD_FILTERS.map((id) => (
                <label key={id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border accent-brand-700"
                    checked={criteria.workload.includes(id)}
                    disabled={disabled}
                    onChange={(event) =>
                      update({
                        workload: event.target.checked
                          ? [...criteria.workload, id]
                          : criteria.workload.filter((entry) => entry !== id),
                      })
                    }
                  />
                  {WORKLOAD_LABELS[id]}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Postings that do not mention workload move to “needs more info”, never to a pass.
            </p>
          </fieldset>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-brand-700"
                checked={criteria.requireKnownPay}
                disabled={disabled}
                onChange={(event) => update({ requireKnownPay: event.target.checked })}
              />
              Only postings that state their pay
            </label>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || !hasActiveCriteria(criteria)}
                onClick={onReset}
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
                Reset filters
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {activeCount === 0 ? "No filters applied" : `${activeCount} active`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
