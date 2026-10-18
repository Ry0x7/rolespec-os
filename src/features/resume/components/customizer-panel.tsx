"use client"

import { useEffect, useRef } from "react"
import { RotateCcw } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { useResumeStore } from "../hooks/use-resume-store"
import {
  ACCENT_PRESETS,
  DENSITY_OPTIONS,
  FONT_FAMILY_OPTIONS,
  FONT_SCALE_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  MARGIN_OPTIONS,
  TEXT_ALIGN_OPTIONS,
  type ResumeCustomization,
} from "../types/customization"

const OPTION_BUTTON =
  "flex-1 rounded-md border border-transparent px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

const OPTION_BUTTON_ACTIVE = "border-border bg-background text-foreground shadow-sm"

interface Props {
  onClose: () => void
}

/**
 * Popover for the per-resume presentation settings. Values live in the resume
 * store (persisted to localStorage), so the preview and the PDF export stay in
 * sync without touching the database.
 */
export function CustomizerPanel({ onClose }: Props) {
  const customization = useResumeStore((s) => s.customization)
  const setCustomization = useResumeStore((s) => s.setCustomization)
  const resetCustomization = useResumeStore((s) => s.resetCustomization)
  const panelRef = useRef<HTMLDivElement>(null)

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
      aria-label="Resume appearance settings"
      className="absolute right-0 top-9 z-30 w-64 space-y-3 rounded-lg border border-border bg-card p-3 shadow-lg"
    >
      <OptionRow<ResumeCustomization["density"]>
        label="Spacing"
        options={DENSITY_OPTIONS}
        value={customization.density}
        onChange={(density) => setCustomization({ density })}
      />
      <OptionRow<ResumeCustomization["fontFamily"]>
        label="Font"
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
      <OptionRow<ResumeCustomization["textAlign"]>
        label="Alignment"
        options={TEXT_ALIGN_OPTIONS}
        value={customization.textAlign}
        onChange={(textAlign) => setCustomization({ textAlign })}
      />

      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Accent
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Accent colour">
          {ACCENT_PRESETS.map((preset) => {
            const selected = customization.accent === preset.value
            return (
              <button
                key={preset.value || "default"}
                type="button"
                aria-label={preset.label}
                aria-pressed={selected}
                title={preset.label}
                onClick={() => setCustomization({ accent: preset.value })}
                className={cn(
                  "h-6 w-6 rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-foreground" : "border-border"
                )}
                style={
                  preset.value
                    ? { backgroundColor: preset.value }
                    : {
                        backgroundImage:
                          "linear-gradient(135deg, #94a3b8 0%, #94a3b8 50%, #e2e8f0 50%, #e2e8f0 100%)",
                      }
                }
              />
            )
          })}
        </div>
      </div>

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
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
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
