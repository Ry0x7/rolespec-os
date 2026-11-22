import { CAREER_PATH_CATALOG } from "./data/occupations"
import type {
  CareerCapabilityDefinition,
  CareerCapabilityMatch,
  CareerEntryFeasibility,
  CareerEntryLevel,
  CareerGeographyEligibility,
  CareerOccupation,
  CareerPathCapabilityInput,
  CareerPathCatalog,
  CareerPathConflict,
  CareerPathEvidenceInput,
  CareerPathGroupId,
  CareerPathProfileInput,
  CareerPathResult,
  CareerRecommendation,
  CareerRegion,
  CareerRequirement,
} from "./types"

/**
 * Deterministic Career Path Intelligence.
 *
 * The engine never predicts, never calls a model and never writes. It measures
 * confirmed capabilities against a versioned occupation catalogue, reports the
 * evidence behind every match, and keeps unknown things unknown. No salary
 * figure is produced because the shipped catalogue has no trustworthy regional
 * pay series.
 */

const REQUIRED_THRESHOLD = 55
const PREFERRED_THRESHOLD = 45
const SELF_DECLARED_CAP = 45

const RATING_POINTS: Record<string, number> = {
  LEARNING: 0,
  COMPETENT: 8,
  STRONG: 14,
  EXPERT: 18,
}

const DEPTH_POINTS: Record<string, number> = {
  EXPOSURE: 3,
  WORKING: 8,
  DEEP: 15,
}

const ENTRY_RANK: Record<CareerEntryLevel, number> = {
  ENTRY: 1,
  MID: 2,
  SENIOR: 3,
}

const EXPERIENCE_RANK: Record<string, number> = {
  JUNIOR: 1,
  MID: 2,
  SENIOR: 3,
  LEAD: 4,
  EXECUTIVE: 5,
}

const REGION_LABELS: Record<Exclude<CareerRegion, "GLOBAL">, readonly string[]> = {
  US: ["united states", "usa", "u.s.", "us"],
  EU: ["european union", "europe", "eu"],
  UK: ["united kingdom", "uk", "england", "scotland", "wales"],
  CA: ["canada", "ca"],
  AU: ["australia", "au"],
  PH: ["philippines", "ph"],
  IN: ["india", "in"],
  SG: ["singapore", "sg"],
  AE: ["united arab emirates", "uae", "dubai", "abu dhabi"],
}

interface EvidenceRef {
  id: string
  title: string
  kind: CareerPathEvidenceInput["kind"]
  sourceUrl: string | null
  outcome: string | null
}

interface ScoredRecord {
  strength: number
  evidence: EvidenceRef[]
  selfAssessment: CareerPathCapabilityInput["selfAssessment"]
}

interface CapabilityAggregate extends ScoredRecord {
  key: string
  label: string
}

interface OccupationAnalysis {
  occupation: CareerOccupation
  matched: CareerCapabilityMatch[]
  missing: CareerCapabilityMatch[]
  requiredCoverage: number
  preferredCoverage: number
  evidenceShare: number
  criticalPenalty: number
  score: number
  coverage: number
  breakdown: {
    requiredCoverage: number
    preferredCoverage: number
    evidenceShare: number
    criticalPenalty: number
    total: number
  }
  confidence: CareerRecommendation["confidence"]
  evidenceBackedCapabilities: number
  entryFeasibility: CareerEntryFeasibility
  geography: CareerGeographyEligibility
  steps: string[]
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+(?:\.\d+)*\b/g, " ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function buildAliasIndex(catalog: CareerPathCatalog): Map<string, CareerCapabilityDefinition> {
  const index = new Map<string, CareerCapabilityDefinition>()
  for (const definition of catalog.capabilityDefinitions) {
    for (const candidate of [definition.key, definition.label, ...definition.aliases]) {
      const normalized = normalizeName(candidate)
      if (normalized && !index.has(normalized)) index.set(normalized, definition)
    }
  }
  return index
}

function asDate(value: Date | string | null): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function yearsBetween(earlier: Date, later: Date): number {
  return Math.abs(later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
}

function recencyPoints(lastUsed: Date | null, asOf: Date | null): number {
  if (!lastUsed || !asOf) return 0
  const years = yearsBetween(lastUsed, asOf)
  if (years <= 2) return 8
  if (years <= 5) return 4
  return 0
}

function evidenceRef(row: CareerPathEvidenceInput): EvidenceRef {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    sourceUrl: row.sourceUrl ?? null,
    outcome: row.outcome ?? null,
  }
}

function scoreCapabilityRecord(
  capability: CareerPathCapabilityInput,
  evidenceById: Map<string, CareerPathEvidenceInput>,
  asOf: Date | null
): ScoredRecord {
  const confirmedLinks = capability.links.filter(
    (link) => evidenceById.get(link.evidenceId)?.status === "CONFIRMED"
  )

  const bestDepth = confirmedLinks.reduce((best, link) => {
    const points = DEPTH_POINTS[link.depth] ?? 0
    return Math.max(best, points)
  }, 0)

  const latestUse = confirmedLinks.reduce<Date | null>((latest, link) => {
    const date = asDate(link.lastUsedAt)
    if (!date) return latest
    return latest === null || date.getTime() > latest.getTime() ? date : latest
  }, null)

  let strength =
    40 +
    (RATING_POINTS[capability.selfAssessment ?? ""] ?? 0) +
    Math.min(confirmedLinks.length, 3) * 6 +
    bestDepth +
    (confirmedLinks.some((link) => link.hasMeasuredOutcome) ? 8 : 0) +
    recencyPoints(latestUse, asOf)

  if (confirmedLinks.length === 0) strength = Math.min(SELF_DECLARED_CAP, strength)
  strength = Math.max(0, Math.min(100, strength))

  const seen = new Set<string>()
  const evidence: EvidenceRef[] = []
  for (const link of confirmedLinks) {
    if (seen.has(link.evidenceId)) continue
    const row = evidenceById.get(link.evidenceId)
    if (!row) continue
    seen.add(link.evidenceId)
    evidence.push(evidenceRef(row))
  }
  evidence.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))

  return { strength, evidence, selfAssessment: capability.selfAssessment }
}

function compareMatches(a: CareerCapabilityMatch, b: CareerCapabilityMatch): number {
  if (a.source !== b.source) return a.source === "REQUIRED" ? -1 : 1
  if (a.critical !== b.critical) return a.critical ? -1 : 1
  if (a.weight !== b.weight) return b.weight - a.weight
  return a.label.localeCompare(b.label)
}

function toMatch(
  requirement: CareerRequirement,
  source: CareerCapabilityMatch["source"],
  definition: CareerCapabilityDefinition | undefined,
  aggregate: CapabilityAggregate | undefined
): CareerCapabilityMatch {
  const label = definition?.label ?? requirement.capabilityKey
  const threshold = source === "REQUIRED" ? REQUIRED_THRESHOLD : PREFERRED_THRESHOLD
  const strength = aggregate?.strength ?? null
  let status: CareerCapabilityMatch["status"] = "MISSING"
  if (strength !== null) {
    status = strength >= threshold ? "SUPPORTED" : "SELF_DECLARED"
  }

  let explanation: string
  if (status === "MISSING") {
    explanation = "No confirmed capability in the profile matches this requirement."
  } else if (aggregate && aggregate.evidence.length === 0) {
    explanation = `Self-declared strength ${strength}; no confirmed evidence is linked yet.`
  } else {
    explanation = `Strength ${strength} from ${aggregate?.evidence.length ?? 0} confirmed evidence item${
      (aggregate?.evidence.length ?? 0) === 1 ? "" : "s"
    }; the ${source === "REQUIRED" ? "required" : "preferred"} threshold is ${threshold}.`
  }

  return {
    key: requirement.capabilityKey,
    label,
    weight: requirement.weight,
    critical: Boolean(requirement.critical),
    source,
    status,
    strength,
    selfAssessment: aggregate?.selfAssessment ?? null,
    evidence: aggregate?.evidence ?? [],
    explanation,
  }
}

function entryFeasibility(
  profile: CareerPathProfileInput,
  occupation: CareerOccupation
): CareerEntryFeasibility {
  const userRank = profile.experienceLevel ? EXPERIENCE_RANK[profile.experienceLevel] : undefined
  const entryRank = ENTRY_RANK[occupation.entryLevel]

  if (userRank === undefined) {
    return {
      status: "UNKNOWN",
      label: "Experience level unknown",
      explanation:
        "The Career Profile does not state an experience level, so entry-level fit cannot be measured.",
    }
  }

  if (userRank >= entryRank) {
    if (occupation.credentialGate) {
      return {
        status: "UNKNOWN",
        label: "Credential not verified",
        explanation: `${occupation.credentialGate.label} is required for this role; the profile does not record holding it.`,
      }
    }
    return {
      status: "FEASIBLE",
      label: "Entry is feasible",
      explanation: `Your stated experience level meets this ${occupation.entryLevel.toLowerCase()}-level role.`,
    }
  }

  if (entryRank - userRank === 1) {
    if (occupation.credentialGate) {
      return {
        status: "UNKNOWN",
        label: "Credential not verified",
        explanation: `${occupation.credentialGate.label} is required for this role; the profile does not record holding it.`,
      }
    }
    return {
      status: "STRETCH",
      label: "A stretch step",
      explanation: `This is one level above your stated experience; it is reachable after a demonstrable step up.`,
    }
  }

  return {
    status: "BLOCKED",
    label: "Too senior for this step",
    explanation: `This is ${entryRank - userRank} levels above your stated experience, so it is not a realistic path yet.`,
  }
}

function mentionsRegion(text: string, region: Exclude<CareerRegion, "GLOBAL">): boolean {
  return REGION_LABELS[region].some((label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(text)
  })
}

function geographyEligibility(
  profile: CareerPathProfileInput,
  occupation: CareerOccupation
): CareerGeographyEligibility {
  const regions = occupation.regions
  if (regions.includes("GLOBAL")) {
    return {
      status: "ELIGIBLE",
      label: "Open, no regional licence",
      explanation:
        "This catalogue entry has no region-specific licence requirement; visa eligibility is not assessed.",
    }
  }

  if (regions.length === 0) {
    return {
      status: "UNKNOWN",
      label: "Region unknown",
      explanation: "The catalogue entry does not state its hiring regions.",
    }
  }

  const profileText = [...profile.locations, profile.workAuthorization ?? ""]
    .join(" ")
    .toLowerCase()

  if (!profileText.trim()) {
    return {
      status: "UNKNOWN",
      label: "Location not stated",
      explanation: `This role is listed for ${regions.join(", ")}; the profile has no location or work authorization to compare.`,
    }
  }

  const eligible = regions.some(
    (region) => region !== "GLOBAL" && mentionsRegion(profileText, region)
  )
  if (eligible) {
    return {
      status: "ELIGIBLE",
      label: "Region matches",
      explanation: `The profile location or work authorization matches ${regions.join(", ")}.`,
    }
  }

  return {
    status: "RESTRICTED",
    label: "Outside listed region",
    explanation: `This role is listed for ${regions.join(", ")}; the profile location and authorization do not match.`,
  }
}

interface DuplicateRecord {
  record: ScoredRecord
  strengths: number[]
}

function buildAggregates(
  profile: CareerPathProfileInput,
  catalog: CareerPathCatalog,
  asOf: Date | null
): {
  aggregates: Map<string, CapabilityAggregate>
  conflicts: CareerPathConflict[]
} {
  const evidenceById = new Map(profile.evidence.map((row) => [row.id, row]))
  const aliasIndex = buildAliasIndex(catalog)
  const records = new Map<string, DuplicateRecord>()

  for (const capability of profile.capabilities) {
    if (!capability.confirmed) continue
    const normalized = normalizeName(capability.name)
    const definition = aliasIndex.get(normalized)
    if (!definition) continue

    const record = scoreCapabilityRecord(capability, evidenceById, asOf)
    const existing = records.get(definition.key)
    if (!existing) {
      records.set(definition.key, { record, strengths: [record.strength] })
      continue
    }

    existing.strengths.push(record.strength)
    const evidence = new Map(existing.record.evidence.map((item) => [item.id, item]))
    for (const item of record.evidence) evidence.set(item.id, item)
    const mergedEvidence = [...evidence.values()].sort(
      (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
    )

    if (record.strength > existing.record.strength) {
      existing.record = { ...record, evidence: mergedEvidence }
    } else {
      existing.record = { ...existing.record, evidence: mergedEvidence }
    }
  }

  const aggregates = new Map<string, CapabilityAggregate>()
  const conflicts: CareerPathConflict[] = []
  const definitions = new Map(catalog.capabilityDefinitions.map((def) => [def.key, def]))

  for (const [key, entry] of records) {
    const strengths = [...entry.strengths].sort((a, b) => a - b)
    const max = strengths[strengths.length - 1] ?? 0
    const min = strengths[0] ?? 0
    const label = definitions.get(key)?.label ?? key

    aggregates.set(key, { ...entry.record, key, label })

    if (strengths.length > 1 && max - min >= 20) {
      conflicts.push({
        capabilityKey: key,
        label,
        detail: `Duplicate confirmed records for ${label} score ${strengths.join(
          " and "
        )}; the strongest record is used once, never summed.`,
      })
    }
  }

  conflicts.sort((a, b) => a.label.localeCompare(b.label) || a.capabilityKey.localeCompare(b.capabilityKey))
  return { aggregates, conflicts }
}

function analyseOccupation(
  occupation: CareerOccupation,
  profile: CareerPathProfileInput,
  catalog: CareerPathCatalog,
  aggregates: Map<string, CapabilityAggregate>
): OccupationAnalysis {
  const definitions = new Map(catalog.capabilityDefinitions.map((def) => [def.key, def]))

  const required = occupation.requirements.map((requirement) =>
    toMatch(
      requirement,
      "REQUIRED",
      definitions.get(requirement.capabilityKey),
      aggregates.get(requirement.capabilityKey)
    )
  )
  const preferred = occupation.preferred.map((requirement) =>
    toMatch(
      requirement,
      "PREFERRED",
      definitions.get(requirement.capabilityKey),
      aggregates.get(requirement.capabilityKey)
    )
  )

  const all = [...required, ...preferred]
  const matched = all.filter((match) => match.status === "SUPPORTED").sort(compareMatches)
  const missing = all.filter((match) => match.status !== "SUPPORTED").sort(compareMatches)

  const requiredWeight = occupation.requirements.reduce((sum, req) => sum + req.weight, 0)
  const preferredWeight = occupation.preferred.reduce((sum, req) => sum + req.weight, 0)
  const matchedRequiredWeight = required
    .filter((match) => match.status === "SUPPORTED")
    .reduce((sum, match) => sum + match.weight, 0)
  const matchedPreferredWeight = preferred
    .filter((match) => match.status === "SUPPORTED")
    .reduce((sum, match) => sum + match.weight, 0)

  const requiredCoverage =
    requiredWeight === 0 ? 100 : Math.round((matchedRequiredWeight / requiredWeight) * 100)
  const preferredCoverage =
    preferredWeight === 0 ? 100 : Math.round((matchedPreferredWeight / preferredWeight) * 100)

  const supportedRequired = required.filter((match) => match.status === "SUPPORTED")
  const evidenceBackedCapabilities = supportedRequired.filter(
    (match) => match.evidence.length > 0
  ).length
  const evidenceShare =
    required.length === 0
      ? 0
      : Math.round((evidenceBackedCapabilities / required.length) * 100)

  const criticalPenalty = Math.min(
    20,
    required.filter((match) => match.critical && match.status !== "SUPPORTED").length * 4
  )

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        0.7 * requiredCoverage +
          0.2 * preferredCoverage +
          0.1 * evidenceShare -
          criticalPenalty
      )
    )
  )

  const coverageDenominator = requiredWeight + preferredWeight * 0.5
  const coverage =
    coverageDenominator === 0
      ? 0
      : Math.round(
          ((matchedRequiredWeight + matchedPreferredWeight * 0.5) / coverageDenominator) * 100
        )

  const confidence: CareerRecommendation["confidence"] = (() => {
    const missingCritical = required.some(
      (match) => match.critical && match.status !== "SUPPORTED"
    )
    if (requiredCoverage === 100 && evidenceBackedCapabilities >= 2 && !missingCritical) {
      return "HIGH"
    }
    if (requiredCoverage >= 60 || evidenceBackedCapabilities >= 2) return "MEDIUM"
    return "LOW"
  })()

  const steps: string[] = []
  const seenSteps = new Set<string>()
  for (const match of [...missing.filter((item) => item.source === "REQUIRED"), ...missing]) {
    if (match.source === "PREFERRED" && match.evidence.length > 0) continue
    const definition = definitions.get(match.key)
    const step = definition?.learningStep
    if (!step || seenSteps.has(step)) continue
    seenSteps.add(step)
    steps.push(step)
    if (steps.length >= 6) break
  }

  return {
    occupation,
    matched,
    missing,
    requiredCoverage,
    preferredCoverage,
    evidenceShare,
    criticalPenalty,
    score,
    coverage,
    breakdown: {
      requiredCoverage,
      preferredCoverage,
      evidenceShare,
      criticalPenalty,
      total: score,
    },
    confidence,
    evidenceBackedCapabilities,
    entryFeasibility: entryFeasibility(profile, occupation),
    geography: geographyEligibility(profile, occupation),
    steps,
  }
}

function isQualified(analysis: OccupationAnalysis): boolean {
  return (
    analysis.requiredCoverage === 100 &&
    analysis.evidenceBackedCapabilities >= 1 &&
    analysis.score >= 55 &&
    analysis.entryFeasibility.status !== "BLOCKED" &&
    analysis.geography.status !== "RESTRICTED"
  )
}

function isAdjacent(analysis: OccupationAnalysis): boolean {
  if (isQualified(analysis)) return false
  const supportedRequired = analysis.matched.filter((match) => match.source === "REQUIRED")
  const missingCritical = analysis.missing.filter(
    (match) => match.source === "REQUIRED" && match.critical
  ).length

  return (
    analysis.requiredCoverage >= 50 &&
    supportedRequired.length >= 2 &&
    analysis.entryFeasibility.status !== "BLOCKED" &&
    analysis.geography.status !== "RESTRICTED" &&
    missingCritical <= 1
  )
}

function neighbourIds(occupation: CareerOccupation): string[] {
  return [...new Set([...occupation.adjacentIds, ...occupation.growthIds])]
}

function findPath(
  startId: string,
  targetId: string,
  byId: Map<string, CareerOccupation>,
  maxDepth: number
): string[] | null {
  if (startId === targetId) return [startId]
  const queue: Array<{ id: string; path: string[] }> = [{ id: startId, path: [startId] }]
  const visited = new Set([startId])

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    const occupation = byId.get(current.id)
    if (!occupation) continue
    if (current.path.length > maxDepth) continue

    for (const neighbour of neighbourIds(occupation)) {
      if (visited.has(neighbour)) continue
      const path = [...current.path, neighbour]
      if (neighbour === targetId) return path
      if (path.length <= maxDepth) {
        visited.add(neighbour)
        queue.push({ id: neighbour, path })
      }
    }
  }

  return null
}

function nearestBranch(
  targetId: string,
  anchors: OccupationAnalysis[],
  byId: Map<string, CareerOccupation>
): { anchor: OccupationAnalysis; path: string[] } | null {
  let best: { anchor: OccupationAnalysis; path: string[] } | null = null

  for (const anchor of anchors) {
    if (anchor.occupation.id === targetId) continue
    const idPath = findPath(anchor.occupation.id, targetId, byId, 2)
    if (!idPath) continue

    const candidate = {
      anchor,
      path: idPath
        .map((id) => byId.get(id)?.title)
        .filter((title): title is string => Boolean(title)),
    }

    if (!best) {
      best = candidate
      continue
    }
    if (candidate.path.length !== best.path.length) {
      if (candidate.path.length < best.path.length) best = candidate
      continue
    }
    if (candidate.anchor.score !== best.anchor.score) {
      if (candidate.anchor.score > best.anchor.score) best = candidate
      continue
    }
    if (candidate.anchor.occupation.title.localeCompare(best.anchor.occupation.title) < 0) {
      best = candidate
    }
  }

  return best
}

function branchFor(
  analysis: OccupationAnalysis,
  group: CareerPathGroupId,
  qualified: OccupationAnalysis[],
  anchors: OccupationAnalysis[],
  byId: Map<string, CareerOccupation>
): string[] {
  if (group === "QUALIFIED_NOW") return [analysis.occupation.title]

  const candidates = group === "ADJACENT" ? qualified : anchors
  const nearest = nearestBranch(analysis.occupation.id, candidates, byId)
  if (!nearest) return [analysis.occupation.title]

  const branch = [...new Set([...nearest.path, analysis.occupation.title])]
  if (branch.length <= 4) return branch
  return [branch[0], ...branch.slice(-2)]
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function matchesTargetTitle(
  occupation: CareerOccupation,
  targetTitles: readonly string[]
): boolean {
  const occupationTitle = normalizeTitle(occupation.title)
  if (!occupationTitle) return false
  return targetTitles.some((raw) => {
    const target = normalizeTitle(raw)
    if (!target) return false
    return target === occupationTitle || ` ${target} `.includes(` ${occupationTitle} `)
  })
}

function buildReasons(
  analysis: OccupationAnalysis,
  group: CareerPathGroupId,
  branch: string[]
): string[] {
  const reasons: string[] = []

  if (group === "QUALIFIED_NOW") {
    reasons.push("All required capabilities are supported by confirmed profile evidence.")
  } else if (group === "ADJACENT") {
    reasons.push(
      `${analysis.requiredCoverage}% of required capability weight is supported; ${analysis.missing.filter(
        (match) => match.source === "REQUIRED"
      ).length} required gap${analysis.missing.filter((match) => match.source === "REQUIRED").length === 1 ? "" : "s"} remain.`
    )
  } else {
    const from = branch.length > 1 ? branch[0] : null
    reasons.push(
      from
        ? `A realistic next branch from ${from}, built from transferable capabilities and a bounded set of gaps.`
        : "A growth path that matches a stated target role; the gaps below are learning steps."
    )
  }

  const strongest = analysis.matched
    .filter((match) => match.source === "REQUIRED" && match.strength !== null)
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        (b.strength ?? 0) - (a.strength ?? 0) ||
        a.label.localeCompare(b.label)
    )
    .slice(0, 2)

  if (strongest.length > 0) {
    reasons.push(
      `Strongest confirmed signals: ${strongest
        .map((match) => `${match.label} (${match.strength})`)
        .join(", ")}.`
    )
  }

  const criticalGaps = analysis.missing.filter(
    (match) => match.source === "REQUIRED" && match.critical
  )
  if (criticalGaps.length > 0) {
    reasons.push(
      `Critical gap${criticalGaps.length === 1 ? "" : "s"}: ${criticalGaps
        .map((match) => match.label)
        .join(", ")}.`
    )
  } else {
    const requiredGaps = analysis.missing.filter((match) => match.source === "REQUIRED")
    if (requiredGaps.length > 0) {
      reasons.push(
        `Learning gaps: ${requiredGaps.map((match) => match.label).join(", ")}.`
      )
    }
  }

  if (analysis.entryFeasibility.status !== "FEASIBLE") {
    reasons.push(analysis.entryFeasibility.explanation)
  }
  if (analysis.geography.status !== "ELIGIBLE") {
    reasons.push(analysis.geography.explanation)
  }

  return [...new Set(reasons)].slice(0, 5)
}

function relatedRoles(
  occupation: CareerOccupation,
  byId: Map<string, CareerOccupation>
): CareerRecommendation["related"] {
  const related: CareerRecommendation["related"] = []
  const seen = new Set<string>()

  for (const [ids, relationship] of [
    [occupation.adjacentIds, "ADJACENT"],
    [occupation.growthIds, "NEXT"],
  ] as const) {
    for (const id of ids) {
      if (seen.has(id) || id === occupation.id) continue
      const target = byId.get(id)
      if (!target) continue
      seen.add(id)
      related.push({ occupationId: id, title: target.title, relationship })
    }
  }

  return related
    .sort(
      (a, b) =>
        (a.relationship === b.relationship ? 0 : a.relationship === "ADJACENT" ? -1 : 1) ||
        a.title.localeCompare(b.title)
    )
    .slice(0, 6)
}

function toRecommendation(
  analysis: OccupationAnalysis,
  group: CareerPathGroupId,
  branch: string[],
  byId: Map<string, CareerOccupation>,
  familyLabel: string
): CareerRecommendation {
  return {
    occupationId: analysis.occupation.id,
    title: analysis.occupation.title,
    familyId: analysis.occupation.familyId,
    familyLabel,
    summary: analysis.occupation.summary,
    group,
    entryLevel: analysis.occupation.entryLevel,
    score: analysis.score,
    coverage: analysis.coverage,
    breakdown: analysis.breakdown,
    confidence: analysis.confidence,
    evidenceBackedCapabilities: analysis.evidenceBackedCapabilities,
    matched: analysis.matched,
    missing: analysis.missing,
    entryFeasibility: analysis.entryFeasibility,
    geography: analysis.geography,
    steps: analysis.steps,
    branch,
    related: relatedRoles(analysis.occupation, byId),
    salaryPotential: null,
    reasons: buildReasons(analysis, group, branch),
  }
}

function sortRecommendations(items: CareerRecommendation[]): CareerRecommendation[] {
  return [...items].sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title)
  )
}

/**
 * Builds the three recommendation groups from confirmed profile facts.
 *
 * `options.catalog` is injectable so tests and a future imported dataset do not
 * need to mutate the shipped catalogue. `options.asOf` pins recency scoring.
 */
export function buildCareerPath(
  profile: CareerPathProfileInput,
  options: { catalog?: CareerPathCatalog; asOf?: Date | string } = {}
): CareerPathResult {
  const catalog = options.catalog ?? CAREER_PATH_CATALOG
  const rawAsOf = options.asOf ?? new Date()
  const parsedAsOf = rawAsOf instanceof Date ? rawAsOf : new Date(rawAsOf)
  const asOf = Number.isNaN(parsedAsOf.getTime()) ? null : parsedAsOf

  const evidenceById = new Map(profile.evidence.map((row) => [row.id, row]))
  const confirmedCapabilities = profile.capabilities.filter((capability) => capability.confirmed)
  const confirmedEvidence = profile.evidence.filter((row) => row.status === "CONFIRMED")

  const { aggregates, conflicts } = buildAggregates(profile, catalog, asOf)

  const confirmedKeys = new Set<string>()
  const aliasIndex = buildAliasIndex(catalog)
  for (const capability of confirmedCapabilities) {
    const definition = aliasIndex.get(normalizeName(capability.name))
    if (definition) confirmedKeys.add(definition.key)
  }

  const hasEnoughEvidence = confirmedKeys.size >= 2 && confirmedEvidence.length >= 1

  const byId = new Map(catalog.occupations.map((occupation) => [occupation.id, occupation]))
  const familyLabels = new Map(catalog.families.map((family) => [family.id, family.label]))

  const analyses = catalog.occupations.map((occupation) =>
    analyseOccupation(occupation, profile, catalog, aggregates)
  )

  const groups: CareerPathResult["groups"] = {
    QUALIFIED_NOW: [],
    ADJACENT: [],
    GROWTH: [],
  }

  const notices: string[] = []
  if (confirmedCapabilities.length === 0) {
    notices.push(
      "No confirmed capabilities yet. Confirm skills in the Skills tab before roles can be evaluated."
    )
  } else {
    const anyConfirmedLink = confirmedCapabilities.some((capability) =>
      capability.links.some(
        (link) => evidenceById.get(link.evidenceId)?.status === "CONFIRMED"
      )
    )
    if (!anyConfirmedLink) {
      notices.push(
        "Confirmed skills have no confirmed evidence linked yet; they are treated as self-declared and cannot qualify a role alone."
      )
    }
    if (confirmedKeys.size < 2) {
      notices.push(
        "At least two confirmed capabilities and one confirmed evidence item are needed for a meaningful recommendation."
      )
    }
  }

  if (hasEnoughEvidence) {
    const qualified = analyses.filter(isQualified)
    const adjacent = analyses.filter((analysis) => !isQualified(analysis) && isAdjacent(analysis))
    const anchors = [...qualified, ...adjacent].sort(
      (a, b) => b.score - a.score || a.occupation.title.localeCompare(b.occupation.title)
    )

    const growth: OccupationAnalysis[] = []
    for (const analysis of analyses) {
      if (isQualified(analysis) || isAdjacent(analysis)) continue
      if (
        analysis.entryFeasibility.status === "BLOCKED" ||
        analysis.geography.status === "RESTRICTED"
      ) {
        continue
      }

      const reachable = nearestBranch(analysis.occupation.id, anchors, byId) !== null
      const targeted = matchesTargetTitle(analysis.occupation, profile.targetRoleTitles)
      // A graph edge alone can surface a role the profile shares nothing with.
      // A growth path is a direction from real evidence, so a reachable role
      // must also have at least one supported capability and a non-trivial
      // score. A stated target title is the user's own direction, so it may
      // still be shown while the gap is larger.
      const hasTransferableGround =
        analysis.matched.length > 0 && analysis.score >= 10
      if (targeted || (reachable && hasTransferableGround)) growth.push(analysis)
    }

    groups.QUALIFIED_NOW = sortRecommendations(
      qualified.map((analysis) =>
        toRecommendation(
          analysis,
          "QUALIFIED_NOW",
          branchFor(analysis, "QUALIFIED_NOW", qualified, anchors, byId),
          byId,
          familyLabels.get(analysis.occupation.familyId) ?? analysis.occupation.familyId
        )
      )
    )
    groups.ADJACENT = sortRecommendations(
      adjacent.map((analysis) =>
        toRecommendation(
          analysis,
          "ADJACENT",
          branchFor(analysis, "ADJACENT", qualified, anchors, byId),
          byId,
          familyLabels.get(analysis.occupation.familyId) ?? analysis.occupation.familyId
        )
      )
    )
    groups.GROWTH = sortRecommendations(
      growth.map((analysis) =>
        toRecommendation(
          analysis,
          "GROWTH",
          branchFor(analysis, "GROWTH", qualified, anchors, byId),
          byId,
          familyLabels.get(analysis.occupation.familyId) ?? analysis.occupation.familyId
        )
      )
    )
  }

  if (profile.targetRoleTitles.length > 0) {
    const unmatched = profile.targetRoleTitles.filter(
      (title) =>
        !catalog.occupations.some((occupation) =>
          matchesTargetTitle(occupation, [title])
        )
    )
    if (unmatched.length > 0) {
      notices.push(
        `No catalogue role matches these target titles yet: ${unmatched
          .slice(0, 4)
          .join(", ")}.`
      )
    }
  }

  return {
    taxonomyVersion: catalog.version,
    attribution: catalog.attribution,
    groups,
    counts: {
      QUALIFIED_NOW: groups.QUALIFIED_NOW.length,
      ADJACENT: groups.ADJACENT.length,
      GROWTH: groups.GROWTH.length,
    },
    conflicts,
    notices,
    evaluatedCount: catalog.occupations.length,
    hasEnoughEvidence,
  }
}
