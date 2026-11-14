/**
 * Deterministic evidence grounding for tailored application content.
 *
 * A job description is not proof of anything about the candidate. The ATS
 * analyzer hands us the keywords a posting wants but the resume does not
 * contain (`missingKeywords`), and every generation prompt used to receive that
 * list as "keywords to work in" — which is how a posting's JPQL or JMS can
 * become a claimed skill the user has never touched.
 *
 * This module classifies each requirement against the candidate's own text
 * before any of it reaches a prompt, and gives the callers a deterministic
 * post-check so a model that ignores the instruction still cannot land an
 * unsupported claim in the output.
 *
 * Dependency-free on purpose: it is pure text work, runs on both the enhance
 * and the export path, and must be unit-testable without a database or a model.
 */

/** How well the candidate's own text backs a requirement. */
export type EvidenceVerdict = "supported" | "ambiguous" | "unsupported"

export interface KeywordEvidence {
  /** The requirement as the analyzer spelled it. */
  keyword: string
  verdict: EvidenceVerdict
  /**
   * Why the verdict was reached — surfaced to the user, never to the model, so
   * that "we did not add this" is explainable rather than mysterious.
   */
  reason: string
}

export interface GroundedKeywords {
  /** Present in the candidate's text; safe to surface or emphasise. */
  supported: string[]
  /** Partial evidence only. May be phrased carefully, never asserted outright. */
  ambiguous: string[]
  /** No evidence at all. Must never be presented as the candidate's experience. */
  unsupported: string[]
  /** Per-keyword detail, in the order the keywords were supplied. */
  details: KeywordEvidence[]
}

/**
 * Characters that continue a technology token. `.` is deliberately excluded so
 * that a comma/space/slash-separated list still matches, and `+`/`#` are
 * included so `c++` and `c#` are not truncated to `c`.
 */
const WORD_CHAR = /[a-z0-9+#]/

/** Words that carry no evidentiary weight inside a multi-word requirement. */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "or",
  "of",
  "the",
  "in",
  "on",
  "for",
  "to",
  "with",
  "using",
  "experience",
  "knowledge",
  "skills",
  "strong",
  "years",
  "plus",
])

/** Below this length a substring hit is noise ("go" inside "google"). */
const MIN_SUBSTRING_LENGTH = 3

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * True when `needle` occurs in `haystack` as a whole token — not glued to more
 * token characters on either side. Both arguments must already be normalized.
 */
function hasWholeTokenMatch(haystack: string, needle: string): boolean {
  if (!needle) return false
  const pattern = new RegExp(escapeRegExp(needle), "g")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(haystack)) !== null) {
    const before = match.index > 0 ? haystack[match.index - 1] : ""
    const afterIndex = match.index + match[0].length
    const after = afterIndex < haystack.length ? haystack[afterIndex] : ""
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true
    if (match.index === pattern.lastIndex) pattern.lastIndex++
  }
  return false
}

/** Significant (non-stopword) tokens of a requirement. */
function significantTokens(keyword: string): string[] {
  return normalize(keyword)
    .split(/[^a-z0-9+#.]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
}

/**
 * Classify one requirement against the candidate's evidence text.
 *
 * Conservative by design: when the evidence is only a fragment the verdict is
 * `ambiguous`, never `supported`. Under-claiming is a phrasing problem;
 * over-claiming is a lie on a job application.
 */
export function classifyKeywordEvidence(
  keyword: string,
  evidenceText: string
): KeywordEvidence {
  const trimmed = keyword.trim()
  const haystack = normalize(evidenceText)
  const needle = normalize(trimmed)

  if (!needle) {
    return { keyword: trimmed, verdict: "unsupported", reason: "Empty requirement." }
  }
  if (!haystack) {
    return {
      keyword: trimmed,
      verdict: "unsupported",
      reason: "No resume text to check against.",
    }
  }

  if (hasWholeTokenMatch(haystack, needle)) {
    return {
      keyword: trimmed,
      verdict: "supported",
      reason: "Appears in your resume.",
    }
  }

  const tokens = significantTokens(trimmed)

  if (tokens.length > 1) {
    const matched = tokens.filter((token) => hasWholeTokenMatch(haystack, token))
    if (matched.length === tokens.length) {
      return {
        keyword: trimmed,
        verdict: "ambiguous",
        reason: `Your resume mentions ${matched.join(" and ")}, but not "${trimmed}" as a whole.`,
      }
    }
    if (matched.length > 0) {
      return {
        keyword: trimmed,
        verdict: "ambiguous",
        reason: `Your resume mentions ${matched.join(" and ")} but not the rest of "${trimmed}".`,
      }
    }
  }

  if (needle.length >= MIN_SUBSTRING_LENGTH && haystack.includes(needle)) {
    return {
      keyword: trimmed,
      verdict: "ambiguous",
      reason: `"${trimmed}" only appears inside a longer term in your resume.`,
    }
  }

  return {
    keyword: trimmed,
    verdict: "unsupported",
    reason: "Nothing in your resume supports this.",
  }
}

/**
 * Partition a requirement list against the candidate's own text.
 *
 * `evidenceText` should be everything the candidate has actually written —
 * the serialized resume plus any unsaved editor text — because a wider evidence
 * base only ever moves a requirement towards `supported`, and the point of the
 * classification is to withhold claims, not to manufacture them.
 */
export function groundKeywords(
  keywords: readonly string[],
  evidenceText: string
): GroundedKeywords {
  const seen = new Set<string>()
  const details: KeywordEvidence[] = []

  for (const keyword of keywords) {
    const trimmed = keyword.trim()
    if (!trimmed) continue
    const dedupeKey = normalize(trimmed)
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    details.push(classifyKeywordEvidence(trimmed, evidenceText))
  }

  return {
    supported: details.filter((d) => d.verdict === "supported").map((d) => d.keyword),
    ambiguous: details.filter((d) => d.verdict === "ambiguous").map((d) => d.keyword),
    unsupported: details
      .filter((d) => d.verdict === "unsupported")
      .map((d) => d.keyword),
    details,
  }
}

/**
 * Deterministic post-check: which of `keywords` the generated `text` asserts
 * that the `original` text did not already contain.
 *
 * This is the enforcement half of the grounding rule. The prompt asks the model
 * not to introduce unsupported requirements; this catches it when it does,
 * without trusting the model's own account of what it wrote.
 */
export function findIntroducedKeywords(
  original: string,
  generated: string,
  keywords: readonly string[]
): string[] {
  const before = normalize(original)
  const after = normalize(generated)
  const introduced: string[] = []

  for (const keyword of keywords) {
    const needle = normalize(keyword)
    if (!needle) continue
    if (!isIntroduced(before, after, needle)) continue
    introduced.push(keyword.trim())
  }

  return introduced
}

/** Shared predicate for the two `findIntroduced*` entry points. */
function isIntroduced(before: string, after: string, needle: string): boolean {
  return hasWholeTokenMatch(after, needle) && !hasWholeTokenMatch(before, needle)
}

/**
 * Sentence terminators, plus the semicolon. A period is only a boundary when
 * whitespace follows it, so `node.js` and `asp.net` stay in one piece.
 */
const SENTENCE_BOUNDARY = /(?<=[.!?;])\s+|\n+/

/**
 * A newline separates two BLOCKS. Splitting on it first, and only then into
 * sentences, is what keeps "the next sentence" from reaching across a paragraph
 * break — or across the `${subject}\n${body}` join every prose service builds,
 * where the body's first sentence is emphatically not the subject's neighbour.
 * The flat sentence sequence is unchanged by the two-step split: the sentence
 * regex already treats `\n+` as a boundary in its own right.
 */
const BLOCK_BOUNDARY = /\n+/

/** One place a keyword occurred, with the little of its position a caller needs. */
export interface KeywordOccurrence {
  /** The sentence the keyword sits in, normalized. */
  sentence: string
  /**
   * The sentence immediately after it, normalized, or `null` when the keyword's
   * sentence is the last one IN ITS BLOCK. Prose admits a gap in the next
   * sentence as often as in the same one ("… JMS and Kafka. I haven't worked
   * with those."), and the flat sentence list cannot express "the next one".
   *
   * A newline ends the link. Across a paragraph break the two sentences are not
   * one thought, and across the `${subject}\n${body}` join the services build
   * they are not even the same field — a claim in a subject line must never be
   * spoken for by the opening line of the body.
   */
  nextSentence: string | null
  /**
   * Keywords from the SAME supplied list that `nextSentence` contains and
   * `sentence` does not — what that sentence brings in on its own. A caller
   * that lets the next sentence speak for this one needs to know when the next
   * sentence is also making its own point.
   */
  keywordsAddedByNextSentence: string[]
}

/** One introduced keyword, plus the sentences it actually occurred in. */
export interface IntroducedKeywordContext {
  /** The requirement as it was supplied. */
  keyword: string
  /**
   * Every sentence of `generated` containing the keyword, normalized (lowercased,
   * whitespace collapsed). Possibly EMPTY: the keyword is confirmed present in
   * the whole text, but a match that straddles a sentence boundary belongs to no
   * single sentence. A caller reading context must treat empty as "no context",
   * never as "no problem".
   */
  sentences: string[]
  /**
   * The same hits as `sentences`, in the same order, carrying their neighbour.
   * `sentences` is kept because most readers only want the flat list.
   */
  occurrences: KeywordOccurrence[]
}

/**
 * `findIntroducedKeywords`, but reporting WHERE each hit landed.
 *
 * The bare keyword list cannot distinguish "I haven't used Kafka" from "I built
 * Kafka pipelines" — both mention Kafka. Callers that need to tell an admitted
 * gap from a claim need the surrounding words, and the sentence is the right
 * unit: gap phrasing sits on either side of the term ("I haven't used Kafka",
 * "Kafka is new to me") and one trailing cue can cover several terms listed
 * together, while a fixed character window would leak cues across sentences.
 *
 * Deliberately a separate function: `findIntroducedKeywords` has callers on the
 * resume paths that want the flat list and should not pay for the split.
 */
export function findIntroducedKeywordContexts(
  original: string,
  generated: string,
  keywords: readonly string[]
): IntroducedKeywordContext[] {
  const before = normalize(original)
  const after = normalize(generated)
  // Blocks first, sentences inside them: same flat sequence as splitting on
  // SENTENCE_BOUNDARY alone (a newline is a boundary either way), but it also
  // records where a block ends, which is where `nextSentence` has to stop.
  const sentences: string[] = []
  const endsBlock: boolean[] = []
  for (const block of generated.split(BLOCK_BOUNDARY)) {
    const blockSentences = block
      .split(SENTENCE_BOUNDARY)
      .map((sentence) => normalize(sentence))
      .filter((sentence) => sentence.length > 0)
    blockSentences.forEach((sentence, index) => {
      sentences.push(sentence)
      endsBlock.push(index === blockSentences.length - 1)
    })
  }

  const needles = keywords
    .map((keyword) => ({ keyword: keyword.trim(), needle: normalize(keyword) }))
    .filter((entry) => entry.needle.length > 0)

  const contexts: IntroducedKeywordContext[] = []

  for (const { keyword, needle } of needles) {
    if (!isIntroduced(before, after, needle)) continue

    const occurrences: KeywordOccurrence[] = []
    sentences.forEach((sentence, index) => {
      if (!hasWholeTokenMatch(sentence, needle)) return
      const nextSentence =
        !endsBlock[index] && index + 1 < sentences.length ? sentences[index + 1] : null
      occurrences.push({
        sentence,
        nextSentence,
        keywordsAddedByNextSentence:
          nextSentence === null
            ? []
            : needles
                .filter(
                  (other) =>
                    hasWholeTokenMatch(nextSentence, other.needle) &&
                    !hasWholeTokenMatch(sentence, other.needle)
                )
                .map((other) => other.keyword),
      })
    })

    contexts.push({
      keyword,
      sentences: occurrences.map((occurrence) => occurrence.sentence),
      occurrences,
    })
  }

  return contexts
}

/**
 * Remove entries from a comma-separated skills list that assert one of
 * `keywords` and were not already present in `original`.
 *
 * Skills lists are the one generated field that can be repaired surgically: an
 * entry is a self-contained claim, so dropping it leaves the rest intact.
 * Prose (a summary or a bullet) cannot be edited this way and is discarded
 * wholesale by the caller instead.
 */
export function stripIntroducedSkills(
  original: string,
  generated: string,
  keywords: readonly string[]
): { skills: string; removed: string[] } {
  const introduced = findIntroducedKeywords(original, generated, keywords)
  if (introduced.length === 0) return { skills: generated, removed: [] }

  const removed: string[] = []
  const kept = generated
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry) return false
      const hit = introduced.find((keyword) =>
        hasWholeTokenMatch(normalize(entry), normalize(keyword))
      )
      if (hit) {
        if (!removed.includes(hit)) removed.push(hit)
        return false
      }
      return true
    })

  return { skills: kept.join(", "), removed }
}
