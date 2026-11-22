"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Bell, Play, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type { SearchAlertFrequency } from "@/generated/prisma/enums"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Select } from "@/shared/ui/select"

import { MAX_DISCOVERY_QUERIES } from "../services/derive-queries.service"
import {
  deleteDiscoveryPreset,
  saveDiscoveryPreset,
  setDiscoveryPresetAlert,
} from "../presets/actions"
import type { DiscoveryPresetView, PresetRoleOption } from "../presets/types"

const ALERT_OPTIONS: Array<{ value: SearchAlertFrequency; label: string }> = [
  { value: "OFF", label: "Alert off" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
]

interface Props {
  presets: DiscoveryPresetView[]
  roles: PresetRoleOption[]
  onRun: (preset: DiscoveryPresetView) => void
  runningPresetId: string | null
  disabled?: boolean
}

/**
 * Saved searches and their alerts.
 *
 * Alerts are in-app and explicit: there is no background mail sender here, so a
 * due alert is a label on this screen and running the search acknowledges it.
 * Nothing is searched on a timer or without the user pressing Run.
 */
export function DiscoveryPresets({
  presets,
  roles,
  onRun,
  runningPresetId,
  disabled,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | "new" | null>(null)
  const [name, setName] = useState("")
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  // Kept even though this compact editor has no keyword field: editing an
  // alert must not silently discard saved keywords.
  const [keywords, setKeywords] = useState<string[]>([])
  const [includeCareerPathRoles, setIncludeCareerPathRoles] = useState(false)
  const [alertFrequency, setAlertFrequency] = useState<SearchAlertFrequency>("OFF")
  const [nameError, setNameError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const due = presets.filter((preset) => preset.alertDue)
  const activeRoles = roles.filter((role) => role.active)
  const careerPathRoles = activeRoles.filter((role) => role.source === "CAREER_PATH")
  // A recommendation the user has not enabled is not offered as an explicit
  // saved-search role either. Otherwise a saved search could bypass the opt-in
  // while the screen promises disabled recommendations stay out of every run.
  const selectableRoles = activeRoles.filter(
    (role) => role.source !== "CAREER_PATH" || role.discoveryEnabled
  )

  // Move focus into the editor when it opens, so a keyboard user is not left
  // on a button above a form inserted further down the page.
  useEffect(() => {
    if (editingId) nameRef.current?.focus()
  }, [editingId])

  function openEditor(preset?: DiscoveryPresetView) {
    setEditingId(preset?.id ?? "new")
    setName(preset?.name ?? "")
    setSelectedRoles(preset?.roles ?? [])
    setKeywords(preset?.keywords ?? [])
    setIncludeCareerPathRoles(preset?.includeCareerPathRoles ?? false)
    setAlertFrequency(preset?.alertFrequency ?? "OFF")
    setNameError(null)
  }

  function closeEditor() {
    setEditingId(null)
    setName("")
    setSelectedRoles([])
    setKeywords([])
    setIncludeCareerPathRoles(false)
    setNameError(null)
  }

  function toggleRole(title: string) {
    setSelectedRoles((current) =>
      current.includes(title)
        ? current.filter((role) => role !== title)
        : current.length >= MAX_DISCOVERY_QUERIES
          ? current
          : [...current, title]
    )
  }

  function save(event?: React.FormEvent) {
    event?.preventDefault()
    if (!name.trim()) {
      setNameError("Give the search a name.")
      nameRef.current?.focus()
      return
    }
    setNameError(null)
    startTransition(async () => {
      const result = await saveDiscoveryPreset({
        ...(editingId !== "new" && editingId ? { id: editingId } : {}),
        name,
        roles: selectedRoles,
        keywords,
        includeCareerPathRoles,
        alertFrequency,
      })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      closeEditor()
      router.refresh()
      toast.success("Saved search saved.")
    })
  }

  function changeAlert(preset: DiscoveryPresetView, frequency: SearchAlertFrequency) {
    startTransition(async () => {
      const result = await setDiscoveryPresetAlert(preset.id, frequency)
      if ("error" in result) toast.error(result.error)
      else router.refresh()
    })
  }

  function remove(preset: DiscoveryPresetView) {
    startTransition(async () => {
      const result = await deleteDiscoveryPreset(preset.id)
      if ("error" in result) toast.error(result.error)
      else {
        setConfirmDeleteId(null)
        router.refresh()
        toast.success("Saved search removed.")
      }
    })
  }

  return (
    <section
      aria-labelledby="saved-searches-heading"
      className="space-y-3 rounded-md border border-border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="saved-searches-heading" className="text-sm font-medium">
            Saved searches
            {presets.length > 0 ? ` (${presets.length})` : ""}
          </h3>
          <p className="text-xs text-muted-foreground">
            Reusable roles with an in-app alert. Nothing runs on a timer; alerts are
            labelled here and running the search acknowledges them.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => openEditor()}
          disabled={pending || disabled}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New search
        </Button>
      </div>

      {due.length > 0 ? (
        <p
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning"
        >
          <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          {due.length === 1
            ? "1 saved search is due."
            : `${due.length} saved searches are due.`}
          <span className="text-muted-foreground">Run one to acknowledge it.</span>
        </p>
      ) : null}

      {presets.length > 0 ? (
        <ul className="divide-y divide-border">
          {presets.map((preset) => (
            <li key={preset.id} className="flex flex-wrap items-start gap-2 py-2 first:pt-0">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {preset.name}
                  {preset.alertDue ? (
                    <Badge variant="warning" size="sm">
                      Due
                    </Badge>
                  ) : null}
                </p>
                <p className="break-words text-xs text-muted-foreground">
                  {preset.roles.length > 0 ? preset.roles.join(" · ") : "No roles"}
                  {preset.includeCareerPathRoles
                    ? " · plus enabled recommended roles"
                    : ""}
                </p>
                {preset.lastRunAt ? (
                  <p className="text-[11px] text-muted-foreground">
                    Last run {new Date(preset.lastRunAt).toLocaleString()}
                    {preset.lastRunCount !== null
                      ? ` · ${preset.lastRunCount} result${preset.lastRunCount === 1 ? "" : "s"}`
                      : ""}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <label className="sr-only" htmlFor={`alert-${preset.id}`}>
                  Alert frequency for {preset.name}
                </label>
                <Select
                  id={`alert-${preset.id}`}
                  value={preset.alertFrequency}
                  onChange={(event) =>
                    changeAlert(preset, event.target.value as SearchAlertFrequency)
                  }
                  disabled={pending || disabled}
                  className="h-8 w-auto py-0 text-xs"
                >
                  {ALERT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Run saved search ${preset.name}`}
                  onClick={() => onRun(preset)}
                  loading={runningPresetId === preset.id}
                  disabled={disabled || (runningPresetId !== null && runningPresetId !== preset.id)}
                >
                  {runningPresetId === preset.id ? null : (
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Run
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit saved search ${preset.name}`}
                  onClick={() => openEditor(preset)}
                >
                  Edit
                </Button>
                {confirmDeleteId === preset.id ? (
                  <span
                    role="group"
                    aria-label={`Confirm deleting ${preset.name}`}
                    className="flex items-center gap-1"
                  >
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => remove(preset)}
                      disabled={pending}
                    >
                      Confirm delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete saved search ${preset.name}`}
                    onClick={() => setConfirmDeleteId(preset.id)}
                    disabled={pending}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          Save a set of roles you search for often. A saved search never adds a
          career-path role to discovery unless you choose it.
        </p>
      )}

      {editingId ? (
        <form
          onSubmit={save}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeEditor()
          }}
          className="space-y-3 rounded-md border border-border bg-muted/20 p-3"
        >
          <div className="space-y-1">
            <label htmlFor="preset-name" className="text-xs font-medium">
              Name
            </label>
            <Input
              id="preset-name"
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Remote frontend roles"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "preset-name-error" : undefined}
            />
            {nameError ? (
              <p id="preset-name-error" role="alert" className="text-xs text-error">
                {nameError}
              </p>
            ) : null}
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">
              Roles ({selectedRoles.length}/{MAX_DISCOVERY_QUERIES})
            </legend>
            {selectableRoles.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Add an active target role in your Career Profile first. Enable a
                recommended role above before choosing it here.
              </p>
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {selectableRoles.map((role) => (
                  <li key={role.id}>
                    <label className="flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-brand-600"
                        checked={selectedRoles.includes(role.title)}
                        onChange={() => toggleRole(role.title)}
                        disabled={
                          !selectedRoles.includes(role.title) &&
                          selectedRoles.length >= MAX_DISCOVERY_QUERIES
                        }
                      />
                      <span className="min-w-0">
                        {role.title}
                        {role.source === "CAREER_PATH" ? (
                          <span className="ml-1 text-muted-foreground">(recommended)</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          {careerPathRoles.length > 0 ? (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-brand-600"
                checked={includeCareerPathRoles}
                onChange={(event) => setIncludeCareerPathRoles(event.target.checked)}
              />
              <span>
                Also search recommended roles you already enabled for discovery.
                Disabled recommendations stay out.
              </span>
            </label>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs">
              <span className="block font-medium">Alert</span>
              <Select
                aria-label="Alert frequency"
                value={alertFrequency}
                onChange={(event) =>
                  setAlertFrequency(event.target.value as SearchAlertFrequency)
                }
                className="h-8 w-auto py-0 text-xs"
              >
                {ALERT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              type="submit"
              size="sm"
              loading={pending}
              disabled={disabled}
            >
              Save search
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={closeEditor}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
