"use client"

import { X } from "lucide-react"
import { Badge } from "@/shared/ui/badge"
import { Select } from "@/shared/ui/select"
import { COUNTRY_OPTIONS, MAX_LOCATIONS } from "../constants/locations"

interface LocationMultiSelectProps {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  id?: string
}

/**
 * Pick-from-list locations. Stored values that are not in the country list
 * (older free-text entries such as "Berlin, Germany") still render as chips and
 * can be removed — they are never dropped just because the list lacks them.
 */
export function LocationMultiSelect({ value, onChange, disabled, id }: LocationMultiSelectProps) {
  const atCap = value.length >= MAX_LOCATIONS
  const available = COUNTRY_OPTIONS.filter((option) => !value.includes(option))

  function handleAdd(next: string) {
    if (!next || atCap || value.includes(next)) return
    onChange([...value, next])
  }

  function handleRemove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      <Select
        id={id}
        // Always controlled at "" so the select falls back to the placeholder
        // after each pick.
        value=""
        disabled={disabled || atCap}
        onChange={(e) => handleAdd(e.target.value)}
      >
        <option value="">Add a location…</option>
        {available.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((location, index) => (
            <Badge key={`${location}-${index}`} variant="brand" className="gap-1.5 py-1">
              {location}
              <button
                type="button"
                aria-label={`Remove ${location}`}
                disabled={disabled}
                onClick={() => handleRemove(index)}
                className="text-brand-300/70 hover:text-brand-200 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
