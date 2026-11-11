/**
 * Okapi BM25, implemented once and kept pure.
 *
 * The existing discovery tie-break counted keyword mentions only: no term
 * frequency saturation, no inverse document frequency and no length
 * normalization, so a posting that repeated "react" ten times beat one that
 * described the work. This is the actual formula with the standard constants:
 *
 *   idf(t) = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
 *   score  = Σ idf(t) · (tf · (k1 + 1)) / (tf + k1 · (1 - b + b · dl / avgdl))
 *
 * `k1 = 1.2` saturates repeated terms; `b = 0.75` normalizes for document
 * length. A document with no usable text gets `null`, not `0`: "we could not
 * read this posting" is not the same claim as "this posting matched nothing".
 */

export const BM25_K1 = 1.2
export const BM25_B = 0.75

export interface Bm25Document {
  id: string
  /** Posting text. Null, empty or punctuation-only text is not indexed. */
  text: string | null | undefined
}

interface IndexedDocument {
  length: number
  termFrequencies: Map<string, number>
}

export interface Bm25Index {
  documentCount: number
  averageDocumentLength: number
  documentFrequencies: ReadonlyMap<string, number>
  /** Only documents with at least one token appear here. */
  documents: ReadonlyMap<string, IndexedDocument>
}

/**
 * Folds case, diacritics and punctuation into comparable terms.
 *
 * Dots and `+#` are kept inside a term so `node.js`, `c++` and `c#` stay
 * distinguishable, while a trailing sentence period is dropped. Very short
 * tokens are kept: `R`, `Go` and `C` are real technologies.
 */
export function tokenize(text: string): string[] {
  if (!text) return []
  const folded = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
  const matches = folded.match(/[a-z0-9][a-z0-9+#.]*/g) ?? []
  return matches.map((term) => term.replace(/\.+$/, "")).filter(Boolean)
}

function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

/** Builds the corpus statistics once per ranking run. */
export function buildBm25Index(documents: readonly Bm25Document[]): Bm25Index {
  const indexed = new Map<string, IndexedDocument>()
  const documentFrequencies = new Map<string, number>()
  let totalLength = 0

  for (const document of documents) {
    const tokens = tokenize(document.text ?? "")
    if (tokens.length === 0) continue
    const frequencies = termFrequencies(tokens)
    indexed.set(document.id, { length: tokens.length, termFrequencies: frequencies })
    totalLength += tokens.length
    for (const term of frequencies.keys()) {
      documentFrequencies.set(term, (documentFrequencies.get(term) ?? 0) + 1)
    }
  }

  const documentCount = indexed.size
  return {
    documentCount,
    averageDocumentLength: documentCount > 0 ? totalLength / documentCount : 0,
    documentFrequencies,
    documents: indexed,
  }
}

export function inverseDocumentFrequency(
  documentFrequency: number,
  documentCount: number
): number {
  if (documentCount <= 0) return 0
  return Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5))
}

/**
 * Scores one document against the query. Query terms are deduplicated: a term
 * repeated in the query is one question, not two.
 *
 * Returns `null` when the document is absent or had no tokens, so callers can
 * keep "unread" separate from "scored zero".
 */
export function bm25Score(
  index: Bm25Index,
  documentId: string,
  query: readonly string[]
): number | null {
  const document = index.documents.get(documentId)
  if (!document || index.averageDocumentLength === 0) return null

  const terms = [...new Set(query)]
  let score = 0
  for (const term of terms) {
    const frequency = document.termFrequencies.get(term)
    if (!frequency) continue
    const documentFrequency = index.documentFrequencies.get(term) ?? 0
    const idf = inverseDocumentFrequency(documentFrequency, index.documentCount)
    const denominator =
      frequency +
      BM25_K1 *
        (1 - BM25_B + (BM25_B * document.length) / index.averageDocumentLength)
    score += (idf * (frequency * (BM25_K1 + 1))) / denominator
  }
  return score
}

/** Every indexed document, highest score first, ties broken by id. */
export function rankDocuments(
  index: Bm25Index,
  query: readonly string[]
): Array<{ id: string; score: number }> {
  const scored: Array<{ id: string; score: number }> = []
  for (const id of index.documents.keys()) {
    const score = bm25Score(index, id, query)
    if (score === null) continue
    scored.push({ id, score })
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return scored
}
