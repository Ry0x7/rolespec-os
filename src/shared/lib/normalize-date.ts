const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
const FULL_MONTHS: Record<string, string> = {
  january:"Jan",february:"Feb",march:"Mar",april:"Apr",may:"May",june:"Jun",
  july:"Jul",august:"Aug",september:"Sep",october:"Oct",november:"Nov",december:"Dec",
}
const PRESENT_ALIASES = new Set(["present","current","ongoing","now","today","active"])

export function normalizeDateString(raw: string | undefined): string | undefined {
  if (!raw) return raw
  const trimmed = raw.trim()
  if (!trimmed) return raw

  if (PRESENT_ALIASES.has(trimmed.toLowerCase())) return "Present"

  // Already "MMM YYYY"
  if (/^[A-Z][a-z]{2} \d{4}$/.test(trimmed)) return trimmed

  // Full month name "January 2024" or "January, 2024"
  const fullMonthMatch = trimmed.match(/^([A-Za-z]+)[,\s]+(\d{4})$/)
  if (fullMonthMatch) {
    const abbr = FULL_MONTHS[fullMonthMatch[1].toLowerCase()]
    if (abbr) return `${abbr} ${fullMonthMatch[2]}`
  }

  // ISO "2024-01" or "2024-01-15"
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  if (isoMatch) {
    const monthIdx = parseInt(isoMatch[2], 10) - 1
    if (monthIdx >= 0 && monthIdx < 12) return `${MONTHS[monthIdx]} ${isoMatch[1]}`
  }

  // "MM-YYYY" or "MM.YYYY" (e.g. "08-2024", "08.2024")
  const mdyMatch = trimmed.match(/^(\d{1,2})[-.](\d{4})$/)
  if (mdyMatch) {
    const monthIdx = parseInt(mdyMatch[1], 10) - 1
    if (monthIdx >= 0 && monthIdx < 12) return `${MONTHS[monthIdx]} ${mdyMatch[2]}`
  }

  // Year only "2024"
  if (/^\d{4}$/.test(trimmed)) return trimmed

  // Unrecognized — return as-is to avoid crashes
  return raw
}

/**
 * Numeric sort key for a resume date string (months since year 0).
 * "Present"-style aliases sort last (Infinity); unparseable input returns NaN
 * so callers can exclude it from ranges.
 */
export function dateSortKey(raw: string | undefined | null): number {
  if (!raw || !raw.trim()) return NaN

  const normalized = normalizeDateString(raw)
  if (!normalized) return NaN

  const trimmed = normalized.trim()
  if (trimmed === "Present") return Infinity

  const monthYear = trimmed.match(/^([A-Z][a-z]{2}) (\d{4})$/)
  if (monthYear) {
    const monthIdx = MONTHS.indexOf(monthYear[1])
    if (monthIdx >= 0) return parseInt(monthYear[2], 10) * 12 + monthIdx
  }

  if (/^\d{4}$/.test(trimmed)) return parseInt(trimmed, 10) * 12

  return NaN
}
