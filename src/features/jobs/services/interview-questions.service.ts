/**
 * Scraped-question extraction. Deliberately dependency-free: this runs on the
 * create path of every clipped job, including the extension route, so it must
 * not drag the AI stack into that module graph. On-demand generation lives in
 * `interview-questions-ai.service.ts`.
 */

/** Anything shorter is a fragment ("Why?"), anything longer is a paragraph. */
const MIN_QUESTION_LENGTH = 12
const MAX_QUESTION_LENGTH = 300
/** A posting with more than this is almost certainly a false-positive storm. */
const MAX_QUESTIONS = 20

/** Leading list markers: "1.", "2)", "-", "*", "•", "–", "Q:". */
const LIST_MARKER = /^\s*(?:[-*•–—]|\d+[.)]|[a-z][.)]|q\s*[:.)]) */i

/**
 * Pulls the questions an employer already wrote into a job posting (screening
 * questions, "what we'd like to know", and so on) out of scraped description
 * text. Deliberately dumb and deterministic: it is called on the create path of
 * every clipped job, so it must never be slow, costly, or non-deterministic.
 */
export function extractEmployerQuestions(jobDescription: string): string[] {
  if (!jobDescription) return []

  const candidates = jobDescription
    // Split on newlines first, then on sentence boundaries, so a question that
    // shares a line with prose ("… apply now. What excites you about X?") is
    // still found on its own.
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[?.!])\s+/))

  const questions: string[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const cleaned = candidate.replace(LIST_MARKER, "").trim()

    if (!cleaned.endsWith("?")) continue
    if (cleaned.length < MIN_QUESTION_LENGTH) continue
    if (cleaned.length > MAX_QUESTION_LENGTH) continue
    // Rules out "…?", "???" and other punctuation-only leftovers.
    if (!/[a-z]/i.test(cleaned)) continue

    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    questions.push(cleaned)
    if (questions.length >= MAX_QUESTIONS) break
  }

  return questions
}
