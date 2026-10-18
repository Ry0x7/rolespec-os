import { cn } from "@/shared/lib/utils"

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  /** Shown after the label, muted, e.g. "Confirmed (3)". */
  count?: number
}

interface SegmentedControlProps<V extends string> {
  value: V
  options: SegmentedOption<V>[]
  onChange: (value: V) => void
  /** Accessible name for the button group, e.g. "Filter capabilities". */
  label?: string
  size?: "sm" | "default"
  className?: string
}

/**
 * A row of toggle buttons where exactly one is pressed — the pattern the
 * appearance settings use. Plain buttons with aria-pressed, so each one is a
 * native tab stop and needs no roving focus.
 */
export function SegmentedControl<V extends string>({
  value,
  options,
  onChange,
  label,
  size = "sm",
  className,
}: SegmentedControlProps<V>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1",
        className
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              size === "sm" ? "h-8 text-xs" : "h-11 min-w-[44px] text-sm",
              selected
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <>
                {" "}
                <span className="tabular-nums text-muted-foreground">({option.count})</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
