import { findIntroducedKeywords } from "@/shared/lib/evidence-grounding"
import {
  MAX_TAILOR_BULLET_LENGTH,
  MAX_TAILOR_SKILLS_LENGTH,
  MAX_TAILOR_SUMMARY_LENGTH,
  type JobTailorSuggestion,
  type TailorTarget,
} from "../services/tailor-resume"
import { containsTerm, normalizeNumericClaim } from "./claim-validator"
import type {
  RejectedTailoringSuggestion,
  ResumeSectionSnapshot,
} from "./types"

const TARGET_ID = /^s(\d+)::i(\d+)(?:::b(\d+))?$/
const LEADING_GLYPHS = /^[\s\-–—•*·▪◦]+/
const NUMERIC_CLAIM = /\b\d[\d,]*(?:\.\d+)?\s?(?:[%+kKmMbB])?\b/g
const SCOPE_CLAIM = /\b(?:all|every|entire|company-wide|organization-wide|organisation-wide|global|worldwide|thousands|millions)\b/gi
const CAPITALIZED_TERM = /\b[A-Z][A-Za-z0-9]*(?:[+#.][A-Za-z0-9]+)*\b/g

const MAX_LENGTH = {
  summary: MAX_TAILOR_SUMMARY_LENGTH,
  bullet: MAX_TAILOR_BULLET_LENGTH,
  skills: MAX_TAILOR_SKILLS_LENGTH,
} as const

/** Comma-list entries, trimmed and lowercased, as a multiset key. */
function skillEntries(list: string): string[] {
  return list
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .sort()
}

function numericClaims(text: string): string[] {
  return Array.from(text.matchAll(NUMERIC_CLAIM), (match) => normalizeNumericClaim(match[0]))
}

function scopeClaims(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(SCOPE_CLAIM), (m) => m[0].toLowerCase())))
}

/**
 * Deterministic per-suggestion check. The prompt asks the model not to invent
 * facts; this is the enforcement. A rejected suggestion never enters a resume,
 * and its reason is fed back to the bounded repair pass.
 */
function checkSuggestion(input: {
  target: TailorTarget
  suggested: string
  evidenceText: string
  barredKeywords: string[]
}): string | null {
  const { target, suggested, evidenceText, barredKeywords } = input

  if (barredKeywords.length > 0) {
    const introduced = findIntroducedKeywords(target.text, suggested, barredKeywords)
    if (introduced.length > 0) {
      return `claims terms the resume cannot back: ${introduced.join(", ")}`
    }
  }

  if (target.field === "skills") {
    const original = skillEntries(target.text)
    const proposed = skillEntries(suggested)
    if (
      original.length !== proposed.length ||
      original.some((entry, index) => entry !== proposed[index])
    ) {
      return "changed the skill set instead of reordering it"
    }
    return null
  }

  const allowedNumbers = new Set(numericClaims(target.text))
  for (const number of numericClaims(suggested)) {
    if (!allowedNumbers.has(number)) return `invented the value "${number}"`
  }

  const allowedScopes = new Set(scopeClaims(target.text))
  for (const scope of scopeClaims(suggested)) {
    if (!allowedScopes.has(scope)) return `invented the scope "${scope}"`
  }

  const evidence = evidenceText.toLowerCase()
  for (const match of suggested.matchAll(CAPITALIZED_TERM)) {
    const term = match[0]
    const start = match.index ?? 0
    const atSentenceStart = start === 0 || /[.!?]\s+$/.test(suggested.slice(0, start))
    const distinctive =
      /^[A-Z]{2,6}$/.test(term) || /[a-z0-9][A-Z]/.test(term) || /[+#.]/.test(term)
    if (atSentenceStart && !distinctive) continue
    if (!evidence.includes(term.toLowerCase())) return `mentions "${term}", absent from the source`
  }

  return null
}

export interface ApplySuggestionsResult {
  sections: ResumeSectionSnapshot[]
  appliedCount: number
  rejected: RejectedTailoringSuggestion[]
  addedSummary: boolean
  /** True when the content differs from the source payload. */
  changed: boolean
}

/**
 * Applies a model's selection/reorder/rephrase payload to a deep copy of the
 * source sections. Never mutates the source, never writes the database, and
 * never invents an item: every mutation lands in text the candidate already
 * wrote, in place.
 */
export function applyTailoringSuggestions(input: {
  sections: ResumeSectionSnapshot[]
  targets: TailorTarget[]
  suggestions: JobTailorSuggestion[]
  generatedSummary?: string
  needsSummary: boolean
  barredKeywords: string[]
  evidenceText: string
}): ApplySuggestionsResult {
  const sections: ResumeSectionSnapshot[] = structuredClone(input.sections)
  const before = JSON.stringify(sections)
  const targetsById = new Map(input.targets.map((target) => [target.targetId, target]))
  const seen = new Set<string>()
  const removals: string[] = []
  const itemExclusions: string[] = []
  const rejected: RejectedTailoringSuggestion[] = []
  let appliedCount = 0

  for (const candidate of input.suggestions) {
    const target = targetsById.get(candidate.targetId)
    if (!target) continue
    if (seen.has(candidate.targetId)) continue
    const match = TARGET_ID.exec(candidate.targetId)
    if (!match) continue
    const [, si, ii, bi] = match
    const item = sections[Number(si)]?.items[Number(ii)]
    if (!item) continue

    if (candidate.action === "remove") {
      if (target.field !== "bullet" || bi === undefined) continue
      seen.add(candidate.targetId)
      removals.push(candidate.targetId)
      continue
    }

    if (candidate.action === "remove-item") {
      if (target.field !== "experience" || bi !== undefined) continue
      seen.add(candidate.targetId)
      itemExclusions.push(`${si}::${ii}`)
      continue
    }

    if (target.field === "experience") continue

    let suggested = (candidate.suggested ?? "").trim()
    if (target.field === "bullet") suggested = suggested.replace(LEADING_GLYPHS, "")
    suggested = suggested.slice(0, MAX_LENGTH[target.field]).trim()
    if (!suggested || suggested === target.text) continue

    const rejection = checkSuggestion({
      target,
      suggested,
      evidenceText: input.evidenceText,
      barredKeywords: input.barredKeywords,
    })
    if (rejection) {
      rejected.push({
        targetId: candidate.targetId,
        field: target.field,
        proposed: suggested.slice(0, 300),
        reason: rejection,
      })
      continue
    }

    seen.add(candidate.targetId)
    if (target.field === "summary") {
      item.content.text = suggested
    } else if (target.field === "skills") {
      item.content.skills = suggested
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    } else if (bi !== undefined && Array.isArray(item.content.bullets)) {
      ;(item.content.bullets as unknown[])[Number(bi)] = suggested
    }
    appliedCount += 1
  }

  if (removals.length > 0) {
    const removedByItem = new Map<string, Set<number>>()
    for (const targetId of removals) {
      const match = TARGET_ID.exec(targetId)
      if (!match || match[3] === undefined) continue
      const key = `${match[1]}::${match[2]}`
      const set = removedByItem.get(key) ?? new Set<number>()
      set.add(Number(match[3]))
      removedByItem.set(key, set)
    }
    for (const [key, removed] of removedByItem) {
      const [si, ii] = key.split("::").map(Number)
      const item = sections[si]?.items[ii]
      if (!item || !Array.isArray(item.content.bullets)) continue
      item.content.bullets = (item.content.bullets as unknown[]).filter(
        (_, index) => !removed.has(index)
      )
      appliedCount += 1
    }
  }

  if (itemExclusions.length > 0) {
    const excludedBySection = new Map<number, Set<number>>()
    for (const key of itemExclusions) {
      const [si, ii] = key.split("::").map(Number)
      const set = excludedBySection.get(si) ?? new Set<number>()
      set.add(ii)
      excludedBySection.set(si, set)
    }
    for (const [si, excluded] of excludedBySection) {
      const section = sections[si]
      if (!section) continue
      if (excluded.size >= section.items.length) {
        excluded.delete(Math.min(...excluded))
      }
      if (excluded.size === 0) continue
      section.items = section.items.filter((_, index) => !excluded.has(index))
      section.items.forEach((item, index) => {
        item.order = index
      })
      appliedCount += 1
    }
  }

  let addedSummary = false
  if (input.needsSummary && input.generatedSummary) {
    const summary = input.generatedSummary.trim().slice(0, MAX_TAILOR_SUMMARY_LENGTH).trim()
    const introduced =
      summary && input.barredKeywords.length > 0
        ? findIntroducedKeywords("", summary, input.barredKeywords)
        : []
    if (summary && introduced.length === 0) {
      const existing = sections.find((section) => section.type === "SUMMARY")
      if (existing) {
        const item = existing.items[0]
        if (item) item.content.text = summary
        else existing.items.push({ content: { text: summary }, metadata: null, order: 0 })
      } else {
        const contactIndex = sections.findIndex((section) => section.type === "CONTACT")
        sections.splice(contactIndex + 1, 0, {
          type: "SUMMARY",
          title: "Summary",
          order: 0,
          visible: true,
          items: [{ content: { text: summary }, metadata: null, order: 0 }],
        })
        sections.forEach((section, index) => {
          section.order = index
        })
      }
      addedSummary = true
    } else if (introduced.length > 0) {
      rejected.push({
        targetId: "generatedSummary",
        field: "summary",
        proposed: summary.slice(0, 300),
        reason: `summary claims unsupported terms: ${introduced.join(", ")}`,
      })
    }
  }

  return {
    sections,
    appliedCount,
    rejected,
    addedSummary,
    changed: JSON.stringify(sections) !== before,
  }
}

/**
 * Requirement terms a rewrite asserts, used when attributing a claim to the
 * posting. Pure whole-token containment, no model.
 */
export function assertedTerms(text: string, terms: readonly string[]): string[] {
  return terms.filter((term) => containsTerm(text, term))
}
