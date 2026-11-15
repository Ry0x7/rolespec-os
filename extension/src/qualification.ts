import { CONFIDENCE_LEVELS, QUALIFICATION_VERDICTS } from "./types"
import type {
  JobConfidence,
  JobMarketFit,
  JobQualification,
  QualificationMatch,
  QualificationStep,
} from "./types"

/**
 * Reads the optional `qualification` object off a 201 from POST /api/extension/jobs.
 *
 * Same rule as `parseJobRisk`: a save that already succeeded must never be turned
 * into a failure by a malformed extra, so an unrecognised verdict — or anything
 * that is not an object — comes back as null. Everything below the verdict
 * degrades instead of failing: a missing step reads as an empty one, because a
 * verdict with no breakdown is still worth showing.
 */
export function parseQualification(value: unknown): JobQualification | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>

  const verdict = row.verdict
  if (typeof verdict !== "string") return null
  if (!(QUALIFICATION_VERDICTS as readonly string[]).includes(verdict)) return null

  return {
    verdict: verdict as JobQualification["verdict"],
    nextAction: typeof row.nextAction === "string" ? row.nextAction.trim() : "",
    worthIt: parseStep(row.worthIt),
    eligible: parseStep(row.eligible),
    match: parseMatch(row.match),
    risk: parseStep(row.risk),
  }
}

/**
 * One `{level, reasons}` step. `level` stays an opaque string: the server owns the
 * vocabulary and a value this build has never heard of must not cost the user the
 * rest of the verdict.
 */
function parseStep(value: unknown): QualificationStep {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { level: "", reasons: [] }
  }
  const row = value as Record<string, unknown>
  return {
    level: typeof row.level === "string" ? row.level.trim() : "",
    reasons: parseStrings(row.reasons),
  }
}

/** The match step. A non-numeric or negative `confirmedCount` reads as none. */
function parseMatch(value: unknown): QualificationMatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { level: "", matchedCapabilities: [], confirmedCount: 0 }
  }
  const row = value as Record<string, unknown>
  const count = row.confirmedCount
  return {
    level: typeof row.level === "string" ? row.level.trim() : "",
    matchedCapabilities: parseStrings(row.matchedCapabilities),
    confirmedCount: typeof count === "number" && Number.isFinite(count) && count > 0 ? count : 0,
  }
}

/**
 * Reads the optional `marketFit` block off a 201. Same rule as the verdict: this
 * is a bonus on a save that already succeeded, so anything without a label to
 * show comes back as null rather than as a blank chip. `fit` stays opaque — only
 * `label` and `reason` are ever displayed.
 */
export function parseMarketFit(value: unknown): JobMarketFit | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const label = typeof row.label === "string" ? row.label.trim() : ""
  if (!label) return null
  return {
    fit: typeof row.fit === "string" ? row.fit.trim() : "",
    label,
    reason: typeof row.reason === "string" ? row.reason.trim() : "",
  }
}

/**
 * Reads the optional `confidence` block off a 201. An unrecognised level is no
 * chip at all rather than a raw one: the four levels carry the whole meaning,
 * and a build that has not heard of a fifth cannot say what it means.
 */
export function parseConfidence(value: unknown): JobConfidence | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const level = typeof row.level === "string" ? row.level.trim() : ""
  if (!(CONFIDENCE_LEVELS as readonly string[]).includes(level)) return null
  return {
    level: level as JobConfidence["level"],
    summary: typeof row.summary === "string" ? row.summary.trim() : "",
  }
}

/**
 * The eligibility flags a 201 carries alongside `risk` — e.g. `NO_SPONSORSHIP`,
 * `US_ONLY`. A missing or malformed list is no flags at all.
 */
export function parseRequirements(value: unknown): string[] {
  return parseStrings(value)
}

/** Shared list reader: non-strings and blanks are dropped, never guessed at. */
function parseStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}
