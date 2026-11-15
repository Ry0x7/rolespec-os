/**
 * Deterministic, fail-closed validation for tailored resume content.
 *
 * This module never calls a model and never edits anything. It compares the
 * source snapshot with the generated copy, then names every claim the copy
 * cannot back with a source reference. A single error makes the report FAIL:
 * the persistence layer must not present such a resume as ready.
 *
 * Pure text/object work on purpose — no database, Next.js or provider imports —
 * so it can be unit-tested and reused by the workflow executor.
 */

import { diffBullets } from "@/features/resume/services/resume-diff.service"
import { BANNED_RESUME_PHRASES } from "@/shared/lib/prompts/human-voice"

import type {
  ClaimEvidence,
  EvidenceReference,
  RequirementEvidence,
  ResumeSectionSnapshot,
  TailoringValidationReport,
  ValidationIssue,
  ValidationIssueCode,
} from "./types"

// ─── Text helpers ───────────────────────────────────────────────────────────

const TOKEN_CHAR = /[a-z0-9+#]/

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from",
  "had", "has", "have", "in", "into", "is", "it", "its", "of", "on", "or", "that",
  "the", "their", "then", "there", "these", "they", "this", "those", "to", "was",
  "were", "which", "while", "with", "using", "used", "via", "over", "under",
  "through", "across", "also", "more", "most", "such", "than", "them", "will",
  "would", "can", "could", "should", "may", "might", "not", "all", "any", "each",
  "other", "some", "very", "just", "our", "your", "you", "we", "us", "who", "what",
  "when", "where", "how", "why", "work", "working", "role", "team", "teams",
])

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Whole-token containment, tolerant of `c++`, `c#` and `node.js`. */
export function containsTerm(haystack: string, term: string): boolean {
  const needle = normalize(term)
  if (!needle) return false
  const pattern = new RegExp(escapeRegExp(needle), "g")
  const hay = normalize(haystack)
  let match: RegExpExecArray | null
  while ((match = pattern.exec(hay)) !== null) {
    const before = match.index > 0 ? hay[match.index - 1] : ""
    const after = match.index + match[0].length < hay.length ? hay[match.index + match[0].length] : ""
    if (!TOKEN_CHAR.test(before) && !TOKEN_CHAR.test(after)) return true
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1
  }
  return false
}

function distinctiveTokens(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9+#.]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token) && !/^\d+$/.test(token))
}

function sharedDistinctiveTokens(a: string, b: string): string[] {
  const left = new Set(distinctiveTokens(a))
  return [...new Set(distinctiveTokens(b))].filter((token) => left.has(token))
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : []
}

/** All readable text of one item, used for item-scoped fact checks. */
function itemText(content: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(content)) {
    if (typeof value === "string") parts.push(value)
    else if (Array.isArray(value)) {
      parts.push(...value.filter((entry): entry is string => typeof entry === "string"))
    } else if (value && typeof value === "object") {
      parts.push(JSON.stringify(value))
    }
    void key
  }
  return parts.join("\n")
}

// ─── Claim extraction ───────────────────────────────────────────────────────

/**
 * Numbers, percentages, currency and magnitude suffixes. Normalized so
 * `10K` and `10,000` compare equal while `10K` and `100K` do not.
 */
const NUMBER_CLAIM = /[$₱€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|[kKmMbB]|\+)\b|\b\d[\d,]*(?:\.\d+)?\b/g

export function normalizeNumericClaim(raw: string): string {
  const cleaned = raw.replace(/[$₱€£,\s]/g, "").toLowerCase()
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kmb])?([%+]?)$/)
  if (!match) return cleaned
  const multiplier =
    match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : match[2] === "b" ? 1_000_000_000 : 1
  return `${Number(match[1]) * multiplier}${match[3]}`
}

function numericClaims(text: string): string[] {
  return Array.from(text.matchAll(NUMBER_CLAIM), (match) => normalizeNumericClaim(match[0]))
}

const DATE_CLAIM =
  /\b(?:19|20)\d{2}\b|\b(?:0?[1-9]|1[0-2])\/(?:19|20)?\d{2,4}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?:19|20)\d{2}\b/gi

function dateClaims(text: string): string[] {
  return Array.from(text.matchAll(DATE_CLAIM), (match) => normalize(match[0]))
}

const SCOPE_CLAIM =
  /\b(?:all|every|entire|company-wide|organization-wide|organisation-wide|global|worldwide|first|only|sole|unique)\b/gi

function scopeClaims(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(SCOPE_CLAIM), (m) => m[0].toLowerCase())))
}

/**
 * Credentials and explicit expertise claims. Ordinary words like "degree" can
 * appear in a job requirement; here they are checked only against candidate
 * evidence, and only when the rewrite introduced them.
 */
const CREDENTIAL_CLAIM =
  /\b(?:certified|certification|certificate|licensed|license|degree|bachelor(?:'s)?|master(?:'s)?|phd|doctorate|cpa|pmp|scrum master|security clearance|expert)\b/gi

function credentialClaims(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(CREDENTIAL_CLAIM), (m) => m[0].toLowerCase())))
}

const SENIORITY_RANKS: Record<number, string[]> = {
  1: ["supported", "assisted", "contributed", "helped", "participated"],
  2: ["maintained", "operated", "ran", "used", "handled"],
  3: ["built", "developed", "implemented", "designed", "created", "launched", "delivered", "produced"],
  4: ["led", "managed", "directed", "owned", "headed", "spearheaded", "drove"],
}

const SENIORITY_BY_VERB = new Map<string, number>(
  Object.entries(SENIORITY_RANKS).flatMap(([rank, verbs]) =>
    verbs.map((verb) => [verb, Number(rank)] as const)
  )
)

function strongestVerb(text: string): { verb: string; rank: number } | null {
  let strongest: { verb: string; rank: number } | null = null
  for (const token of normalize(text).split(/[^a-z]+/)) {
    const rank = SENIORITY_BY_VERB.get(token)
    if (!rank) continue
    if (!strongest || rank > strongest.rank) strongest = { verb: token, rank }
  }
  return strongest
}

// ─── Source evidence corpus ─────────────────────────────────────────────────

interface SourceAtom {
  ref: string
  label: string
  quote: string
  itemText: string
  sectionType: string
}

function stableId(value: string | undefined, fallback: number): string {
  return value && value.trim() ? value : String(fallback)
}

function sectionRef(section: ResumeSectionSnapshot, index: number): string {
  return `section:${section.type}:${stableId(section.id, index)}`
}

function itemRef(section: ResumeSectionSnapshot, sectionIndex: number, itemIndex: number): string {
  return `${sectionRef(section, sectionIndex)}/item:${stableId(
    section.items[itemIndex]?.id,
    itemIndex
  )}`
}

/**
 * Addressable source facts for evidence references. Mirrors the shape of the
 * evidence map but stays local so validation has no ordering dependency on it.
 */
function sourceAtoms(sections: ResumeSectionSnapshot[]): SourceAtom[] {
  const atoms: SourceAtom[] = []

  sections.forEach((section, sectionIndex) => {
    section.items.forEach((item, itemIndex) => {
      const content = item.content ?? {}
      const base = itemRef(section, sectionIndex, itemIndex)
      const all = itemText(content)

      const push = (field: string, text: string) => {
        if (!text.trim()) return
        atoms.push({
          ref: `${base}:${field}`,
          label: `${section.title} — ${field}`,
          quote: text.slice(0, 400),
          itemText: all,
          sectionType: section.type,
        })
      }

      if (section.type === "SUMMARY") push("text", stringValue(content.text))
      if (section.type === "SKILLS") {
        stringList(content.skills).forEach((skill, index) => push(`skills.${index}`, skill))
        push("category", stringValue(content.category))
      }
      if (section.type === "EXPERIENCE" || section.type === "PROJECTS") {
        const header = [stringValue(content.role), stringValue(content.company), stringValue(content.name)]
          .filter(Boolean)
          .join(" at ")
        push("header", header)
        stringList(content.bullets).forEach((bullet, index) => push(`bullets.${index}`, bullet))
        stringList(content.technologies).forEach((tech, index) => push(`technologies.${index}`, tech))
      }
      if (section.type === "EDUCATION") {
        push(
          "education",
          [content.degree, content.field, content.school].filter((v): v is string => typeof v === "string").join(" ")
        )
      }
      if (section.type === "CERTIFICATIONS") {
        push(
          "certification",
          [content.name, content.organization, content.credentialId]
            .filter((v): v is string => typeof v === "string")
            .join(" ")
        )
      }
      if (section.type === "CUSTOM") {
        push("title", stringValue(content.title))
        push("content", stringValue(content.content) || stringValue(content.text))
      }
      // The joined item text is always available as an evidence fallback; it is
      // never the primary quote when a narrower field exists.
      if (all.trim()) push("item", all)
    })
  })

  return atoms
}

function corpusOf(sections: ResumeSectionSnapshot[]): string {
  // Only candidate-written fields count as evidence. Serializing the whole row
  // would let provenance metadata (adapter names, ids) "support" a claim the
  // candidate never made.
  return sourceAtoms(sections)
    .map((atom) => atom.quote)
    .join("\n")
}

function referenceFromAtom(atom: SourceAtom): EvidenceReference {
  return { ref: atom.ref, label: atom.label, quote: atom.quote, origin: "resume" }
}

function dedupeReferences(references: EvidenceReference[]): EvidenceReference[] {
  const seen = new Map<string, EvidenceReference>()
  for (const reference of references) {
    const key = `${reference.ref}::${reference.quote.slice(0, 80)}`
    if (!seen.has(key)) seen.set(key, reference)
  }
  return [...seen.values()]
}

/** Best source atoms for a claim, used when there is no direct target text. */
function supportingAtoms(text: string, atoms: SourceAtom[], limit = 3): SourceAtom[] {
  return atoms
    .map((atom) => ({ atom, shared: sharedDistinctiveTokens(atom.quote, text) }))
    .filter((entry) => entry.shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length)
    .slice(0, limit)
    .map((entry) => entry.atom)
}

function requirementRefs(text: string, requirements: RequirementEvidence[]): EvidenceReference[] {
  const refs: EvidenceReference[] = []
  const matchedRequirements = requirements.filter(
    (requirement) =>
      requirement.matchedTerms.some((term) => containsTerm(text, term)) ||
      sharedDistinctiveTokens(requirement.text, text).length >= 2
  )
  for (const requirement of matchedRequirements) {
    for (const evidence of requirement.evidenceRefs) {
      refs.push({
        ref: evidence.ref,
        label: evidence.label,
        quote: evidence.quote.slice(0, 400),
        origin: evidence.origin,
        requirementIds: [requirement.id],
      })
    }
  }
  return refs
}

function requirementIdsFor(text: string, requirements: RequirementEvidence[]): string[] {
  return requirements
    .filter(
      (requirement) =>
        requirement.matchedTerms.some((term) => containsTerm(text, term)) ||
        sharedDistinctiveTokens(requirement.text, text).length >= 2
    )
    .map((requirement) => requirement.id)
}

// ─── Validation ─────────────────────────────────────────────────────────────

interface SectionPair {
  source?: ResumeSectionSnapshot
  tailored?: ResumeSectionSnapshot
  sourceIndex: number
  tailoredIndex: number
}

function pairSections(
  source: ResumeSectionSnapshot[],
  tailored: ResumeSectionSnapshot[]
): SectionPair[] {
  const pairs: SectionPair[] = []
  const usedTailored = new Set<number>()

  source.forEach((sourceSection, sourceIndex) => {
    const tailoredIndex = tailored.findIndex(
      (candidate, index) => !usedTailored.has(index) && candidate.type === sourceSection.type
    )
    if (tailoredIndex === -1) {
      pairs.push({ source: sourceSection, sourceIndex, tailoredIndex: -1 })
      return
    }
    usedTailored.add(tailoredIndex)
    pairs.push({
      source: sourceSection,
      tailored: tailored[tailoredIndex],
      sourceIndex,
      tailoredIndex,
    })
  })

  tailored.forEach((section, tailoredIndex) => {
    if (usedTailored.has(tailoredIndex)) return
    pairs.push({ tailored: section, sourceIndex: -1, tailoredIndex })
  })

  return pairs
}

function identityKey(content: Record<string, unknown>): string {
  return [content.role, content.company, content.name]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join("|")
    .toLowerCase()
}

class ValidationCollector {
  readonly issues: ValidationIssue[] = []
  readonly claims: ClaimEvidence[] = []
  private claimCounter = 0

  addIssue(
    code: ValidationIssueCode,
    message: string,
    subject: { sectionType?: string; itemRef?: string; field?: string; claim?: string },
    severity: ValidationIssue["severity"] = "error"
  ): void {
    this.issues.push({ code, severity, message, ...subject })
  }

  addClaim(claim: Omit<ClaimEvidence, "claimId">): ClaimEvidence {
    this.claimCounter += 1
    const stored: ClaimEvidence = { claimId: `claim-${this.claimCounter}`, ...claim }
    this.claims.push(stored)
    return stored
  }
}

interface ClaimContext {
  sourceText: string
  /** Text of the whole source item — attribution scope for verbs and skills. */
  sourceItemText: string
  /** Text the fact checks search. Summary uses the whole resume. */
  factSourceText: string
  sectionType: string
  itemRef: string
  field: string
  change: "rewritten" | "added" | "removed"
  sourceAtomRefs?: EvidenceReference[]
}

function validateClaim(
  tailoredText: string,
  context: ClaimContext,
  collector: ValidationCollector,
  sourceCorpus: string,
  atoms: SourceAtom[],
  requirements: RequirementEvidence[]
): void {
  if (context.change === "removed") {
    collector.addClaim({
      sectionType: context.sectionType,
      itemRef: context.itemRef,
      field: context.field,
      change: "removed",
      sourceText: context.sourceText,
      tailoredText: "",
      evidenceRefs: context.sourceAtomRefs ?? [],
      requirementIds: [],
    })
    return
  }

  const issueSubject = {
    sectionType: context.sectionType,
    itemRef: context.itemRef,
    field: context.field,
    claim: tailoredText.slice(0, 400),
  }

  // A whole new achievement bullet is not a reformulation, even when every
  // noun and number in it already appears somewhere in the role. The pipeline
  // never generates one; a stored draft that gained one since generation is
  // exactly what the VALIDATE replay must catch.
  if (
    context.change === "added" &&
    (context.sectionType === "EXPERIENCE" || context.sectionType === "PROJECTS")
  ) {
    collector.addIssue(
      "UNSUPPORTED_ADDED_ITEM",
      "The tailored resume adds an achievement bullet with no source counterpart.",
      issueSubject
    )
  }

  const allowedNumbers = new Set(numericClaims(context.factSourceText))
  for (const number of numericClaims(tailoredText)) {
    if (!allowedNumbers.has(number)) {
      collector.addIssue(
        "FABRICATED_METRIC",
        `The rewrite asserts the value "${number}" which the source text does not contain.`,
        issueSubject
      )
    }
  }

  const allowedDates = new Set(dateClaims(context.factSourceText))
  for (const date of dateClaims(tailoredText)) {
    if (!allowedDates.has(date)) {
      collector.addIssue(
        "FABRICATED_DATE",
        `The rewrite asserts the date "${date}" which the source text does not contain.`,
        issueSubject
      )
    }
  }

  for (const scope of scopeClaims(tailoredText)) {
    if (!containsTerm(context.factSourceText, scope)) {
      collector.addIssue(
        "UNSUPPORTED_SCOPE",
        `The rewrite claims "${scope}" scope that the source text does not contain.`,
        issueSubject
      )
    }
  }

  // Proper nouns and technology names must exist somewhere in the source
  // resume. Sentence-initial ordinary words ("Built", "Led") are not names.
  const originalCase = tailoredText
  for (const match of originalCase.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[+#.][A-Za-z0-9]+)*\b/g)) {
    const term = match[0]
    if (term.length <= 1) continue
    const start = match.index ?? 0
    const atSentenceStart =
      start === 0 || /[.!?;:\n]\s*$/.test(originalCase.slice(0, start)) || /^[-\s]*$/.test(originalCase.slice(0, start))
    const distinctive =
      /^[A-Z]{2,6}$/.test(term) || /[a-z0-9][A-Z]/.test(term) || /[+#.]/.test(term)
    if (atSentenceStart && !distinctive) continue
    if (/^(i|january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(term)) {
      continue
    }
    // Acronyms are commonly pluralized by adding a lowercase s. "APIs" in the
    // source genuinely backs "API" in a rewrite; refusing that would force the
    // generator to keep an awkward plural instead of failing a real claim.
    const pluralMatch =
      /^[A-Z]{2,6}$/.test(term) &&
      (containsTerm(sourceCorpus, term.endsWith("S") ? term.slice(0, -1) : `${term}s`))
    if (!containsTerm(sourceCorpus, term) && !pluralMatch) {
      collector.addIssue(
        "UNSUPPORTED_ENTITY",
        `The rewrite mentions "${term}", which does not appear anywhere in the source resume.`,
        issueSubject
      )
    }
  }

  const allowedCredentials = new Set(credentialClaims(context.factSourceText))
  for (const credential of credentialClaims(tailoredText)) {
    if (!allowedCredentials.has(credential) && !containsTerm(sourceCorpus, credential)) {
      collector.addIssue(
        "IMPLIED_CREDENTIAL",
        `The rewrite implies the credential "${credential}", which no source evidence supports.`,
        issueSubject
      )
    }
  }

  const sourceStrength = strongestVerb(context.sourceItemText)
  const tailoredStrength = strongestVerb(tailoredText)
  if (
    tailoredStrength &&
    (!sourceStrength || tailoredStrength.rank > sourceStrength.rank) &&
    !containsTerm(context.sourceItemText, tailoredStrength.verb)
  ) {
    collector.addIssue(
      "IMPLIED_SENIORITY",
      `The rewrite escalates to "${tailoredStrength.verb}" while the source item only supports "${sourceStrength?.verb ?? "no action verb"}".`,
      issueSubject
    )
  }

  if (context.change === "rewritten") {
    const sourceTokens = distinctiveTokens(context.sourceText)
    const shared = sharedDistinctiveTokens(context.sourceText, tailoredText)
    // Only judge connection when the source gives enough substantive terms to
    // judge. "Cut latency by 20%" has one distinctive word; a faithful rewrite
    // of it must not be treated as drift for that reason alone.
    if (sourceTokens.length >= 2 && shared.length === 0) {
      collector.addIssue(
        "SEMANTIC_DRIFT",
        "The rewrite shares no substantive term with the text it replaces.",
        issueSubject
      )
    } else if (sourceTokens.length >= 2 && shared.length === 1) {
      collector.addIssue(
        "SEMANTIC_DRIFT",
        `The rewrite is only loosely connected to the source text (shared term: "${shared[0]}").`,
        issueSubject,
        "warning"
      )
    }
  }

  const directRefs = context.sourceAtomRefs ?? []
  const matchedRequirementRefs = requirementRefs(tailoredText, requirements)
  const fallbackRefs =
    directRefs.length === 0
      ? supportingAtoms(tailoredText, atoms).map(referenceFromAtom)
      : []
  const evidenceRefs = dedupeReferences([...directRefs, ...matchedRequirementRefs, ...fallbackRefs])

  if (evidenceRefs.length === 0) {
    collector.addIssue(
      "MISSING_EVIDENCE_REF",
      "The rewrite has no evidence reference in the source resume.",
      issueSubject
    )
  }

  collector.addClaim({
    sectionType: context.sectionType,
    itemRef: context.itemRef,
    field: context.field,
    change: context.change,
    sourceText: context.sourceText,
    tailoredText,
    evidenceRefs,
    requirementIds: requirementIdsFor(tailoredText, requirements),
  })
}

export function validateTailoredResume(input: {
  source: ResumeSectionSnapshot[]
  tailored: ResumeSectionSnapshot[]
  requirements: RequirementEvidence[]
  sourceHash: string
  now?: Date
}): TailoringValidationReport {
  const collector = new ValidationCollector()
  const atoms = sourceAtoms(input.source)
  const sourceCorpus = corpusOf(input.source)
  const resumeFacts = sourceCorpus

  const pairs = pairSections(input.source, input.tailored)

  for (const pair of pairs) {
    const { source, tailored } = pair
    const sectionType = tailored?.type ?? source?.type ?? "UNKNOWN"

    // A whole section that did not exist in the source is an addition. Every
    // bullet in a new experience/project item is unsupported by definition.
    if (!source && tailored) {
      tailored.items.forEach((item, itemIndex) => {
        const ref = itemRef(tailored, pair.tailoredIndex, itemIndex)
        if (tailored.type === "EXPERIENCE" || tailored.type === "PROJECTS") {
          collector.addIssue(
            "UNSUPPORTED_ADDED_ITEM",
            "The tailored resume contains an experience or project item with no source counterpart.",
            { sectionType, itemRef: ref }
          )
        }
        const texts =
          tailored.type === "EXPERIENCE" || tailored.type === "PROJECTS"
            ? stringList(item.content.bullets)
            : tailored.type === "SKILLS"
              ? stringList(item.content.skills)
              : [stringValue(item.content.text) || stringValue(item.content.content)]
        // A summary written from the candidate's own resume is a condensation,
        // not a new fact: allow figures/entities already present anywhere in the
        // source resume, while still requiring evidence references. An added
        // experience/project/skill item remains unsupported by definition.
        const summaryFromResume = tailored.type === "SUMMARY"
        for (const text of texts) {
          if (!text) continue
          validateClaim(
            text,
            {
              sourceText: "",
              sourceItemText: "",
              factSourceText: summaryFromResume ? resumeFacts : "",
              sectionType,
              itemRef: ref,
              field: "added",
              change: "added",
            },
            collector,
            sourceCorpus,
            atoms,
            input.requirements
          )
        }
      })
      continue
    }

    if (!tailored || !source) continue

    if (sectionType === "SUMMARY") {
      const sourceItem = source.items[0]
      const tailoredItem = tailored.items[0]
      if (!tailoredItem) continue
      const before = stringValue(sourceItem?.content?.text)
      const after = stringValue(tailoredItem.content?.text)
      if (!after || after === before) continue
      const ref = itemRef(tailored, pair.tailoredIndex, 0)
      validateClaim(
        after,
        {
          sourceText: before,
          sourceItemText: before,
          factSourceText: resumeFacts,
          sectionType,
          itemRef: ref,
          field: "text",
          change: before ? "rewritten" : "added",
          sourceAtomRefs: sourceItem
            ? [
                {
                  ref: `${itemRef(source, pair.sourceIndex, 0)}:text`,
                  label: `${source.title} — text`,
                  quote: before.slice(0, 400),
                  origin: "resume",
                },
              ]
            : [],
        },
        collector,
        sourceCorpus,
        atoms,
        input.requirements
      )
      continue
    }

    if (sectionType === "SKILLS") {
      const count = Math.max(source.items.length, tailored.items.length)
      for (let index = 0; index < count; index += 1) {
        const sourceItem = source.items[index]
        const tailoredItem = tailored.items[index]
        if (!tailoredItem) continue
        const before = stringList(sourceItem?.content?.skills)
        const after = stringList(tailoredItem.content?.skills)
        const left = [...before].map((entry) => entry.trim().toLowerCase()).sort()
        const right = [...after].map((entry) => entry.trim().toLowerCase()).sort()
        const sameSet = left.length === right.length && left.every((entry, i) => entry === right[i])
        if (!sameSet) {
          collector.addIssue(
            "SKILL_SET_CHANGED",
            "The tailored skills list is not a reordering of the source entries.",
            {
              sectionType,
              itemRef: itemRef(tailored, pair.tailoredIndex, index),
              field: "skills",
              claim: after.join(", ").slice(0, 400),
            }
          )
        }
        if (JSON.stringify(before) === JSON.stringify(after) || before.length === 0) continue
        if (sameSet) continue
        validateClaim(
          after.join(", "),
          {
            sourceText: before.join(", "),
            sourceItemText: before.join(", "),
            factSourceText: before.join(", "),
            sectionType,
            itemRef: itemRef(tailored, pair.tailoredIndex, index),
            field: "skills",
            change: "rewritten",
            sourceAtomRefs: sourceItem
              ? [
                  {
                    ref: `${itemRef(source, pair.sourceIndex, index)}:skills`,
                    label: `${source.title} — skills`,
                    quote: before.join(", ").slice(0, 400),
                    origin: "resume",
                  },
                ]
              : [],
          },
          collector,
          sourceCorpus,
          atoms,
          input.requirements
        )
      }
      continue
    }

    if (sectionType !== "EXPERIENCE" && sectionType !== "PROJECTS" && sectionType !== "CUSTOM") {
      continue
    }

    // Pair experience/project items by identity, never by position: one removed
    // role must not turn every later role into a fabricated addition.
    const unmatchedTailored = [...tailored.items]
    const pairsForItems: Array<{
      sourceItem?: (typeof source.items)[number]
      sourceItemIndex?: number
      tailoredItem?: (typeof tailored.items)[number]
      tailoredIndex: number
    }> = []

    source.items.forEach((sourceItem, sourceItemIndex) => {
      const key = identityKey(sourceItem.content)
      const matchIndex =
        key.length > 0
          ? unmatchedTailored.findIndex((item) => identityKey(item.content) === key)
          : unmatchedTailored.length > 0
            ? 0
            : -1
      if (matchIndex === -1) {
        pairsForItems.push({ sourceItem, sourceItemIndex, tailoredIndex: -1 })
        return
      }
      const [tailoredItem] = unmatchedTailored.splice(matchIndex, 1)
      const tailoredIndex = tailored.items.indexOf(tailoredItem)
      pairsForItems.push({ sourceItem, sourceItemIndex, tailoredItem, tailoredIndex })
    })
    unmatchedTailored.forEach((tailoredItem) => {
      pairsForItems.push({
        tailoredItem,
        tailoredIndex: tailored.items.indexOf(tailoredItem),
      })
    })

    for (const { sourceItem, sourceItemIndex, tailoredItem, tailoredIndex } of pairsForItems) {
      const ref =
        tailoredIndex >= 0
          ? itemRef(tailored, pair.tailoredIndex, tailoredIndex)
          : itemRef(source!, pair.sourceIndex, sourceItemIndex ?? 0)

      if (!sourceItem) {
        collector.addIssue(
          "UNSUPPORTED_ADDED_ITEM",
          "The tailored resume contains an experience or project item with no source counterpart.",
          { sectionType, itemRef: ref }
        )
        const bullets = stringList(tailoredItem?.content.bullets)
        for (const bullet of bullets) {
          validateClaim(
            bullet,
            {
              sourceText: "",
              sourceItemText: "",
              factSourceText: "",
              sectionType,
              itemRef: ref,
              field: "bullets",
              change: "added",
            },
            collector,
            sourceCorpus,
            atoms,
            input.requirements
          )
        }
        continue
      }

      if (!tailoredItem) {
        const bullets = stringList(sourceItem.content.bullets)
        for (const bullet of bullets) {
          validateClaim(
            bullet,
            {
              sourceText: bullet,
              sourceItemText: itemText(sourceItem.content),
              factSourceText: itemText(sourceItem.content),
              sectionType,
              itemRef: ref,
              field: "bullets",
              change: "removed",
            },
            collector,
            sourceCorpus,
            atoms,
            input.requirements
          )
        }
        continue
      }

      const sourceItemText = itemText(sourceItem.content)
      const sourceBullets = stringList(sourceItem.content.bullets)
      const tailoredBullets = stringList(tailoredItem.content.bullets)
      const primaryRef: EvidenceReference = {
        ref: `${ref}:item`,
        label: `${source.title} — ${stringValue(sourceItem.content.role) || stringValue(sourceItem.content.name) || "item"}`,
        quote: sourceItemText.slice(0, 400),
        origin: "resume",
      }

      const changes = diffBullets(sourceBullets, tailoredBullets)
      changes.forEach((change, index) => {
        if (change.status === "unchanged") return
        const tailoredText = change.tailored ?? ""
        if (change.status === "removed") {
          collector.addClaim({
            sectionType,
            itemRef: ref,
            field: `bullets.${index}`,
            change: "removed",
            sourceText: change.original ?? "",
            tailoredText: "",
            evidenceRefs: [primaryRef],
            requirementIds: [],
          })
          return
        }
        validateClaim(
          tailoredText,
          {
            sourceText: change.original ?? "",
            sourceItemText,
            factSourceText: sourceItemText,
            sectionType,
            itemRef: ref,
            field: `bullets.${index}`,
            change: change.status === "added" ? "added" : "rewritten",
            sourceAtomRefs: [primaryRef],
          },
          collector,
          sourceCorpus,
          atoms,
          input.requirements
        )
      })

      if (sectionType === "CUSTOM") {
        const before = stringValue(sourceItem.content.content) || stringValue(sourceItem.content.text)
        const after = stringValue(tailoredItem.content.content) || stringValue(tailoredItem.content.text)
        if (after && after !== before) {
          validateClaim(
            after,
            {
              sourceText: before,
              sourceItemText,
              factSourceText: sourceItemText,
              sectionType,
              itemRef: ref,
              field: "content",
              change: before ? "rewritten" : "added",
              sourceAtomRefs: [primaryRef],
            },
            collector,
            sourceCorpus,
            atoms,
            input.requirements
          )
        }
      }
    }
  }

  // A prompt rule is not enforcement. Scan only changed claims, and honor the
  // ATS carve-out: a term the posting itself uses is allowed because matching
  // its exact keyword is the point of tailoring.
  const requirementText = input.requirements
    .map((requirement) => requirement.text)
    .join("\n")
  for (const claim of collector.claims) {
    if (!claim.tailoredText) continue
    for (const phrase of BANNED_RESUME_PHRASES) {
      if (!containsTerm(claim.tailoredText, phrase)) continue
      if (containsTerm(claim.sourceText, phrase)) continue
      if (containsTerm(requirementText, phrase)) continue
      collector.addIssue(
        "BANNED_CLICHE",
        `The rewrite uses the banned cliché "${phrase}"; use the concrete verb or fact instead.`,
        {
          sectionType: claim.sectionType,
          itemRef: claim.itemRef,
          field: claim.field,
          claim: claim.tailoredText.slice(0, 400),
        }
      )
    }
  }

  const hasError = collector.issues.some((issue) => issue.severity === "error")
  const hasWarning = collector.issues.some((issue) => issue.severity === "warning")
  const requirements = input.requirements
  const coverage = {
    supported: requirements.filter((requirement) => requirement.verdict === "SUPPORTED").length,
    partial: requirements.filter((requirement) => requirement.verdict === "PARTIAL").length,
    unsupported: requirements.filter((requirement) => requirement.verdict === "UNSUPPORTED").length,
    total: requirements.length,
  }

  return {
    status: hasError ? "FAIL" : hasWarning ? "NEEDS_REVIEW" : "PASS",
    sourceHash: input.sourceHash,
    issues: collector.issues,
    claims: collector.claims,
    requirementCoverage: coverage,
    checkedAt: (input.now ?? new Date()).toISOString(),
  }
}

/** Text helper exported for tests: the numbers a claim asserts. */
export function numericFacts(text: string): string[] {
  return numericClaims(text)
}
