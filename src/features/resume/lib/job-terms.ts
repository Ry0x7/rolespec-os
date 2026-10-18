/**
 * Deterministic term extraction from a job posting's text.
 *
 * The tailoring pipeline has no ATS analysis to hand it a missing-keyword list,
 * so the barred-claim list is derived from the posting itself: every
 * significant term the posting uses is checked against the candidate's own
 * text by `groundKeywords()`, and anything the resume cannot back becomes a
 * DO-NOT-CLAIM instruction plus a deterministic post-check.
 *
 * Dependency-free pure text work, like `evidence-grounding.ts`, so it is
 * unit-testable without a database or a model.
 */

/**
 * Same token alphabet as `evidence-grounding.ts`: `+`/`#` keep `c++`/`c#`
 * whole; `.` keeps `node.js` in one piece and is trimmed at the edges.
 */
const TOKEN_PATTERN = /[a-z0-9+#][a-z0-9+#.]*/g

/**
 * Ordinary posting prose that carries no claimable meaning on its own. This is
 * deliberately small: over-barring only makes the tailor more conservative
 * (a term wrongly barred keeps a rewrite closer to the original), so unknown
 * words stay IN the list rather than out of it.
 */
const COMMON_WORDS = new Set([
  "a", "an", "and", "or", "of", "the", "in", "on", "for", "to", "with",
  "using", "you", "your", "our", "we", "us", "they", "their", "who", "what",
  "will", "are", "is", "be", "have", "has", "had", "this", "that", "these",
  "those", "as", "at", "by", "from", "into", "about", "than", "then", "but",
  "not", "all", "any", "can", "may", "must", "should", "would", "per", "via",
  "able", "etc", "more", "most", "other", "such", "well", "work", "working",
  "team", "teams", "role", "job", "candidate", "candidates", "position",
  "company", "experience", "experiences", "knowledge", "skills", "skill",
  "strong", "years", "year", "plus", "preferred", "required", "requirements",
  "requirement", "responsibilities", "responsibility", "qualifications",
  "qualification", "benefits", "salary", "apply", "application", "join",
  "looking", "ideal", "including", "include", "includes", "across", "within",
  "between", "help", "day", "new", "high", "great", "good", "best",
])

/** Below this length a bare token is noise — unless `+`/`#` marks it a tech name. */
const MIN_TERM_LENGTH = 3

/** Hard ceiling so a pathological posting cannot balloon the grounding pass. */
const MAX_TERMS = 200

/**
 * The significant terms of a job posting, lowercased, deduped, in order of
 * first appearance. Everything returned is a candidate claim to be grounded
 * against the resume — NOT a list of keywords to work in.
 */
export function extractJobTerms(text: string): string[] {
  const seen = new Set<string>()
  const terms: string[] = []

  const matches = text.toLowerCase().match(TOKEN_PATTERN) ?? []
  for (const raw of matches) {
    const token = raw.replace(/^\.+|\.+$/g, "")
    if (!token) continue
    if (token.length < MIN_TERM_LENGTH && !/[+#]/.test(token)) continue
    if (COMMON_WORDS.has(token)) continue
    if (/^\d+$/.test(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    terms.push(token)
    if (terms.length >= MAX_TERMS) break
  }

  return terms
}
