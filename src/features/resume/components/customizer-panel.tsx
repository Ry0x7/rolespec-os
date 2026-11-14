"use client"

import { useEffect, useRef } from "react"
import { Check, RotateCcw, X } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { useResumeStore } from "../hooks/use-resume-store"
import {
  ACCENT_PRESETS,
  DENSITY_OPTIONS,
  FONT_FAMILY_OPTIONS,
  FONT_SCALE_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  MARGIN_OPTIONS,
  STYLE_PRESETS,
  TEXT_ALIGN_OPTIONS,
  activeStylePreset,
  type ResumeCustomization,
} from "../types/customization"

const OPTION_BUTTON =
  "flex-1 rounded-md border border-transparent px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

const OPTION_BUTTON_ACTIVE = "border-border bg-background text-foreground shadow-sm"

const GROUP_LABEL =
  "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"

interface Props {
  onClose: () => void
}

/**
 * Design panel for the per-resume presentation settings. Values live in the
 * resume store (persisted to localStorage), so the preview and the PDF export
 * stay in sync without touching the database.
 *
 * It is a popover rather than a modal: the point is to watch the page change
 * while adjusting it, so the preview must stay visible underneath.
 */
export function CustomizerPanel({ onClose }: Props) {
  const customization = useResumeStore((s) => s.customization)
  const setCustomization = useResumeStore((s) => s.setCustomization)
  const resetCustomization = useResumeStore((s) => s.resetCustomization)
  const panelRef = useRef<HTMLDivElement>(null)
  const preset = activeStylePreset(customization)

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const node = panelRef.current
      const target = event.target as HTMLElement | null
      // The trigger owns its own toggle; closing here too would re-open it.
      if (target?.closest("[data-customizer-trigger]")) return
      if (node && target && !node.contains(target)) onClose()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Resume design settings"
      className="absolute right-0 top-9 z-30 max-h-[min(75vh,34rem)] w-80 max-w-[calc(100vw-2rem)] space-y-4 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-3 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border pb-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">Design</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            Applies to the preview and the PDF.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close design panel"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <section aria-labelledby="design-presets-heading" className="space-y-1.5">
        <h3 id="design-presets-heading" className={GROUP_LABEL}>
          Style presets
        </h3>
        <div role="group" aria-label="Style presets" className="grid grid-cols-2 gap-1.5">
          {STYLE_PRESETS.map((option) => {
            const selected = preset === option.id
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                aria-label={`${option.label}: ${option.description}`}
                title={option.description}
                onClick={() => setCustomization({ ...option.values })}
                className={cn(
                  "min-w-0 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-muted/20 hover:bg-muted/50"
                )}
              >
                <span className="flex items-center gap-1 text-xs font-semibold">
                  <span className="truncate">{option.label}</span>
                  {selected && <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />}
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                  {option.description}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section aria-labelledby="design-typography-heading" className="space-y-2">
        <h3 id="design-typography-heading" className={GROUP_LABEL}>
          Typography
        </h3>
        <OptionRow<ResumeCustomization["fontFamily"]>
          label="Font family"
          options={FONT_FAMILY_OPTIONS}
          value={customization.fontFamily}
          onChange={(fontFamily) => setCustomization({ fontFamily })}
        />
        <OptionRow<ResumeCustomization["fontScale"]>
          label="Text size"
          options={FONT_SCALE_OPTIONS}
          value={customization.fontScale}
          onChange={(fontScale) => setCustomization({ fontScale })}
        />
      </section>

      <section aria-labelledby="design-spacing-heading" className="space-y-2">
        <h3 id="design-spacing-heading" className={GROUP_LABEL}>
          Spacing &amp; margins
        </h3>
        <OptionRow<ResumeCustomization["density"]>
          label="Spacing"
          options={DENSITY_OPTIONS}
          value={customization.density}
          onChange={(density) => setCustomization({ density })}
        />
        <OptionRow<ResumeCustomization["margins"]>
          label="Margins"
          options={MARGIN_OPTIONS}
          value={customization.margins}
          onChange={(margins) => setCustomization({ margins })}
        />
        <OptionRow<ResumeCustomization["lineHeight"]>
          label="Line height"
          options={LINE_HEIGHT_OPTIONS}
          value={customization.lineHeight}
          onChange={(lineHeight) => setCustomization({ lineHeight })}
        />
      </section>

      <section aria-labelledby="design-colour-heading" className="space-y-2">
        <h3 id="design-colour-heading" className={GROUP_LABEL}>
          Colour
        </h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Accent colour">
          {ACCENT_PRESETS.map((accentPreset) => {
            const selected = customization.accent === accentPreset.value
            return (
              <button
                key={accentPreset.value || "default"}
                type="button"
                aria-label={accentPreset.label}
                aria-pressed={selected}
                title={accentPreset.label}
                onClick={() => setCustomization({ accent: accentPreset.value })}
                className={cn(
                  "h-6 w-6 rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-foreground" : "border-border"
                )}
                style={
                  accentPreset.value
                    ? { backgroundColor: accentPreset.value }
                    : {
                        backgroundImage:
                          "linear-gradient(135deg, #94a3b8 0%, #94a3b8 50%, #e2e8f0 50%, #e2e8f0 100%)",
                      }
                }
              />
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-2 py-1.5">
          <label
            htmlFor="resume-accent-colour"
            className="min-w-0 text-[11px] font-medium text-muted-foreground"
          >
            Custom colour
          </label>
          <span className="flex shrink-0 items-center gap-2">
            <code className="text-[10px] text-muted-foreground">
              {customization.accent || "default"}
            </code>
            <input
              id="resume-accent-colour"
              type="color"
              aria-label="Custom accent colour"
              value={customization.accent || "#1d4ed8"}
              onChange={(event) => setCustomization({ accent: event.target.value })}
              className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </span>
        </div>
      </section>

      <section aria-labelledby="design-align-heading" className="space-y-2">
        <h3 id="design-align-heading" className={GROUP_LABEL}>
          Alignment
        </h3>
        <OptionRow<ResumeCustomization["textAlign"]>
          label="Body text"
          options={TEXT_ALIGN_OPTIONS}
          value={customization.textAlign}
          onChange={(textAlign) => setCustomization({ textAlign })}
        />
      </section>

      <button
        type="button"
        onClick={resetCustomization}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCcw className="h-3 w-3" />
        Reset to defaults
      </button>
    </div>
  )
}

function OptionRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-1 rounded-lg bg-muted p-0.5" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={value === option.value}
            aria-label={`${label}: ${option.label}`}
            onClick={() => onChange(option.value)}
            className={cn(OPTION_BUTTON, value === option.value && OPTION_BUTTON_ACTIVE)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
