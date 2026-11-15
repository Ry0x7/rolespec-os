import { buildBm25Index, bm25Score, rankDocuments, tokenize } from "../bm25"
import { evaluateFitFactors, scoreFitFactors } from "../fit-factors"
import type {
  FitFactor,
  RankedEntry,
  RankingExclusion,
  RankingOptions,
  RankingPosting,
  RankingProfile,
  RankingResult,
} from "../types"

/**
 * Hybrid ranking: Okapi BM25 over normalized posting text and confirmed profile
 * evidence, fused with the seven deterministic fit factors.
 *
 * The lexical half answers "does this posting talk about my work?" and the
 * factor half answers "can I actually take it?". Neither alone is enough: a
 * perfect keyword match in a US-only posting is not a lead, and an eligible
 * posting that never mentions the user's skills is not a match either.
 *
 * The result is explainable by construction: every entry carries the BM25
 * score, the factor states and plain sentences. Top-K and the threshold only
 * shape the returned list; excluded postings are reported, never dropped
 * silently.
 */

const DEFAULT_LEXICAL_WEIGHT = 0.4

function profileQueryTerms(profile: RankingProfile): string[] {
  const phrases = [
    ...profile.targetRoleTitles,
    ...profile.capabilities.filter((entry) => entry.confirmed).map((entry) => entry.name),
    ...profile.evidence
      .filter((entry) => entry.confirmed)
      .flatMap((entry) => [entry.title, entry.details ?? ""]),
  ]
  const terms = new Set<string>()
  for (const phrase of phrases) {
    for (const term of tokenize(phrase)) terms.add(term)
  }
  return [...terms].sort()
}

/**
 * The lexical document is the normalized posting description, nothing else.
 * Company and title are facts the factors already read; including them would
 * give a description-less posting a score built entirely from metadata, which
 * is exactly the "no description means no lexical evidence" case.
 */
function documentText(posting: RankingPosting): string {
  return (posting.description ?? "").trim()
}

function explain(
  factors: readonly FitFactor[],
  lexicalScore: number | null,
  lexicalPercent: number
): string[] {
  const lines: string[] = []
  if (lexicalScore === null) {
    lines.push("No description, so there is no lexical score for this posting.")
  } else {
    lines.push(
      `Lexical relevance ${lexicalPercent}% (BM25 ${lexicalScore.toFixed(2)}) against your roles, confirmed skills and evidence.`
    )
  }
  for (const factor of factors) {
    if (factor.state === "MATCH") lines.push(`${factor.label}: ${factor.reason}`)
  }
  for (const factor of factors) {
    if (factor.state === "PARTIAL" || factor.state === "MISMATCH") {
      lines.push(`${factor.label}: ${factor.reason}`)
    }
  }
  for (const factor of factors) {
    if (factor.state === "UNKNOWN") lines.push(`${factor.label}: ${factor.reason}`)
  }
  return lines
}

function normalizeOptions(options: RankingOptions | undefined): {
  topK: number | null
  minScore: number | null
  lexicalWeight: number
  now: Date
} {
  const rawTopK = options?.topK
  const topK =
    typeof rawTopK === "number" && Number.isFinite(rawTopK) && rawTopK > 0
      ? Math.floor(rawTopK)
      : null
  const rawMin = options?.minScore
  const minScore =
    typeof rawMin === "number" && Number.isFinite(rawMin)
      ? Math.min(100, Math.max(0, rawMin))
      : null
  const rawWeight = options?.lexicalWeight
  const lexicalWeight =
    typeof rawWeight === "number" && Number.isFinite(rawWeight)
      ? Math.min(1, Math.max(0, rawWeight))
      : DEFAULT_LEXICAL_WEIGHT
  return { topK, minScore, lexicalWeight, now: options?.now ?? new Date() }
}

/**
 * Ranks one pool. Pure given `options.now`: the same postings and profile
 * always produce the same order and the same explanations.
 */
export function rankJobPool(input: {
  postings: readonly RankingPosting[]
  profile: RankingProfile
  options?: RankingOptions
}): RankingResult {
  const { postings, profile } = input
  const { topK, minScore, lexicalWeight, now } = normalizeOptions(input.options)

  const queryTerms = profileQueryTerms(profile)
  const index = buildBm25Index(
    postings.map((posting) => ({ id: posting.id, text: documentText(posting) }))
  )
  const lexicalScores = new Map<string, number>()
  for (const posting of postings) {
    const score = bm25Score(index, posting.id, queryTerms)
    if (score !== null) lexicalScores.set(posting.id, score)
  }
  const lexicalRanking = rankDocuments(index, queryTerms)
  const lexicalRank = new Map<string, number>()
  lexicalRanking.forEach((entry, position) => lexicalRank.set(entry.id, position + 1))
  const bestLexical = lexicalRanking[0]?.score ?? 0

  const scored = postings.map((posting, inputIndex) => {
    const lexicalScore = lexicalScores.get(posting.id) ?? null
    const lexicalPercent =
      lexicalScore !== null && bestLexical > 0
        ? Math.round((lexicalScore / bestLexical) * 100)
        : 0
    const factors = evaluateFitFactors(posting, profile, now)
    const fit = scoreFitFactors(factors)
    const composite = Math.round(
      100 *
        (lexicalWeight * (lexicalPercent / 100) +
          (1 - lexicalWeight) * (fit.score / 100))
    )
    return {
      posting,
      inputIndex,
      lexicalScore,
      lexicalPercent,
      factors,
      fit,
      composite,
    }
  })

  scored.sort(
    (a, b) =>
      b.composite - a.composite ||
      b.fit.coverage - a.fit.coverage ||
      (b.lexicalScore ?? -1) - (a.lexicalScore ?? -1) ||
      a.inputIndex - b.inputIndex
  )

  const ranked: RankedEntry[] = scored.map((entry, position) => ({
    postingId: entry.posting.id,
    rank: position + 1,
    score: entry.composite,
    lexicalScore: entry.lexicalScore,
    lexicalRank: lexicalRank.get(entry.posting.id) ?? null,
    fitScore: entry.fit.score,
    coverage: Number(entry.fit.coverage.toFixed(2)),
    factors: entry.factors,
    explanation: explain(entry.factors, entry.lexicalScore, entry.lexicalPercent),
  }))

  const excluded: RankingExclusion[] = []
  const eligible = ranked.filter((entry) => {
    if (minScore !== null && entry.score < minScore) {
      excluded.push({ postingId: entry.postingId, reason: "below-threshold" })
      return false
    }
    return true
  })
  const visible = topK === null ? eligible : eligible.slice(0, topK)
  if (topK !== null) {
    for (const entry of eligible.slice(topK)) {
      excluded.push({ postingId: entry.postingId, reason: "outside-top-k" })
    }
  }

  return {
    snapshot: {
      rankedAt: now.toISOString(),
      corpusSize: postings.length,
      unscoredCount: postings.length - lexicalScores.size,
      averageDocumentLength: Number(index.averageDocumentLength.toFixed(2)),
      queryTerms,
      topK,
      minScore,
      lexicalWeight,
      fitWeight: Number((1 - lexicalWeight).toFixed(2)),
    },
    entries: visible,
    excluded,
  }
}
