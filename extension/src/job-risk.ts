import { JOB_RISK_LEVELS } from "./types"
import type { JobRisk } from "./types"

/**
 * Reads the optional `risk` object off a 201 from POST /api/extension/jobs.
 *
 * Deliberately strict and non-throwing: a save that already succeeded must never be
 * turned into a failure by a malformed or unknown-shaped warning, so anything that is
 * not a recognised level with a usable reason list comes back as null.
 */
export function parseJobRisk(value: unknown): JobRisk | null {
  if (typeof value !== "object" || value === null) return null
  const row = value as Record<string, unknown>

  const level = row.level
  if (typeof level !== "string") return null
  if (!(JOB_RISK_LEVELS as readonly string[]).includes(level)) return null

  if (!Array.isArray(row.reasons)) return null
  const reasons = row.reasons
    .filter((reason): reason is string => typeof reason === "string")
    .map((reason) => reason.trim())
    .filter((reason) => reason.length > 0)

  // An empty list still keeps the flag: the level alone is worth showing the user.
  return { level: level as JobRisk["level"], reasons }
}
