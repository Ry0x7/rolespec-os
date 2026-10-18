/**
 * Deterministic prose-to-bullet splitting for resume assembly.
 *
 * Career Profile evidence stores `details` as free text: sometimes an already
 * formatted list, sometimes a prose paragraph. Resume experience/project items
 * store `bullets: string[]`, so the text has to be broken up before it lands in
 * an item. This is plain text handling only — nothing here rewrites, summarizes,
 * or infers content.
 */

/** Leading list markers: `•`, `-`, `*`, `–`, `1.`, `1)`. */
const LEADING_MARKER = /^(?:[•‣▪◦]+\s*|[-*–—]\s+|\d+[.)]\s+)/

/** Sentence-terminal punctuation plus optional closing quote/bracket and space. */
const SENTENCE_BOUNDARY = /[.!?]+["'”’)\]]*\s+/g

/** Trailing word before a period that should not end a sentence. */
const ABBREVIATIONS = new Set([
  "approx",
  "co",
  "dept",
  "dr",
  "e.g",
  "etc",
  "i.e",
  "inc",
  "jr",
  "ltd",
  "mr",
  "mrs",
  "ms",
  "no",
  "prof",
  "sr",
  "st",
  "vs",
])

function stripMarker(line: string): string {
  return line.replace(LEADING_MARKER, "").trim()
}

/**
 * Splits a single line into sentences, keeping terminal punctuation attached so
 * the result matches the punctuation style of existing resume bullets.
 */
function splitSentences(line: string): string[] {
  const sentences: string[] = []
  let start = 0

  SENTENCE_BOUNDARY.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SENTENCE_BOUNDARY.exec(line)) !== null) {
    const end = match.index + match[0].length
    const rest = line.slice(end)
    if (!rest) break

    // Skip abbreviations ("e.g. ") and single-letter initials ("J. Smith").
    const previousWord = /([A-Za-z][A-Za-z.]*)$/.exec(line.slice(start, match.index))?.[1] ?? ""
    if (previousWord.length === 1 || ABBREVIATIONS.has(previousWord.toLowerCase())) continue

    // Only break where the next sentence plausibly starts.
    if (!/^["'“‘([]?[A-Z0-9]/.test(rest)) continue

    const sentence = line.slice(start, end).trim()
    if (sentence) sentences.push(sentence)
    start = end
  }

  const tail = line.slice(start).trim()
  if (tail) sentences.push(tail)

  return sentences
}

/**
 * Breaks free text into resume bullets: newlines first (with list markers
 * stripped), then sentence boundaries within each remaining chunk.
 *
 * Returns `[]` for blank input, and never returns `[]` for non-blank input —
 * unsplittable text falls back to a single trimmed bullet.
 */
export function splitIntoBullets(text: string | null | undefined): string[] {
  const trimmed = text?.trim()
  if (!trimmed) return []

  const bullets = trimmed
    .split(/\r?\n/)
    .map(stripMarker)
    .filter(Boolean)
    .flatMap(splitSentences)
    .map((bullet) => bullet.trim())
    .filter(Boolean)

  return bullets.length > 0 ? bullets : [trimmed]
}
