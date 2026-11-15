"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Calendar, ChevronDown, X } from "lucide-react"
import { cn } from "@/shared/lib/utils"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * The two dropdowns sit in a narrow 2-col grid, so they get the shared Select
 * chevron treatment at a tighter scale: a 0.85rem arrow pinned 0.35rem from the
 * edge with 1.35rem of end padding, rather than the 1.75rem the full-width
 * Select uses. Inline for the same reason as `shared/ui/select.tsx` — a class
 * `pr-*` here would be dropped by tailwind-merge against the `px-2` below.
 */
const NARROW_CHEVRON_STYLE: CSSProperties = {
  backgroundImage: "var(--select-chevron)",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.35rem center",
  backgroundSize: "0.85rem 0.85rem",
  paddingInlineEnd: "1.35rem",
}

function getYears(): number[] {
  const current = new Date().getFullYear()
  const years: number[] = []
  for (let y = current + 2; y >= 1960; y--) years.push(y)
  return years
}

function parseValue(value?: string): { month: string; year: string } | null {
  if (!value || value === "Present") return null
  const parts = value.trim().split(" ")
  if (parts.length === 2 && MONTHS.includes(parts[0]) && /^\d{4}$/.test(parts[1])) {
    return { month: parts[0], year: parts[1] }
  }
  return null
}

interface MonthYearPickerProps {
  value?: string
  onChange: (value: string | undefined) => void
  allowPresent?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function MonthYearPicker({
  value,
  onChange,
  allowPresent = false,
  placeholder = "Select date",
  disabled = false,
  className,
}: MonthYearPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isPresent = value === "Present"
  const parsed = parseValue(value)

  const [month, setMonth] = useState(parsed?.month ?? "")
  const [year, setYear] = useState(parsed?.year ?? String(new Date().getFullYear()))

  // Re-sync the two dropdowns when `value` changes underneath us (a different
  // date loaded into the same picker instance). Compared during render rather
  // than in an effect: an effect committed the stale month/year first and
  // corrected them on a second pass, which is the cascading render
  // `react-hooks/set-state-in-effect` flags. React discards this pass and
  // re-runs before committing, so no stale date is ever painted.
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    const p = parseValue(value)
    if (p) {
      setMonth(p.month)
      setYear(p.year)
    } else if (!value) {
      setMonth("")
      setYear(String(new Date().getFullYear()))
    }
  }

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener("mousedown", handleOutside)
    return () => document.removeEventListener("mousedown", handleOutside)
  }, [open])

  function handleMonthChange(m: string) {
    setMonth(m)
    if (m && year) onChange(`${m} ${year}`)
  }

  function handleYearChange(y: string) {
    setYear(y)
    if (month && y) onChange(`${month} ${y}`)
  }

  function handlePresentToggle(checked: boolean) {
    if (checked) {
      onChange("Present")
    } else {
      onChange(month && year ? `${month} ${year}` : undefined)
    }
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    setMonth("")
    onChange(undefined)
  }

  const displayValue = value === "Present" ? "Present" : value || null

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-border bg-input px-3 py-2 text-sm transition-colors",
          "hover:border-ring/50 focus:outline-none focus:ring-2 focus:ring-ring",
          disabled && "cursor-not-allowed opacity-50",
          !displayValue && "text-muted-foreground"
        )}
      >
        <span className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {displayValue ?? placeholder}
        </span>
        <span className="flex items-center gap-1">
          {displayValue && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onMouseDown={handleClear}
              className="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card p-3 shadow-xl space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Month</label>
              <select
                value={month}
                onChange={(e) => handleMonthChange(e.target.value)}
                disabled={isPresent}
                style={NARROW_CHEVRON_STYLE}
                className={cn(
                  "w-full appearance-none rounded-md border border-border bg-input px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                  isPresent && "opacity-40 cursor-not-allowed"
                )}
              >
                <option value="">Month</option>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Year</label>
              <select
                value={year}
                onChange={(e) => handleYearChange(e.target.value)}
                disabled={isPresent}
                style={NARROW_CHEVRON_STYLE}
                className={cn(
                  "w-full appearance-none rounded-md border border-border bg-input px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                  isPresent && "opacity-40 cursor-not-allowed"
                )}
              >
                {getYears().map((y) => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {allowPresent && (
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isPresent}
                onChange={(e) => handlePresentToggle(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-muted-foreground">Present / Current</span>
            </label>
          )}
        </div>
      )}
    </div>
  )
}
