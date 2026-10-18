/**
 * Deterministic keyword scoring for the ATS analyzer — MEASUREMENT ONLY.
 *
 * NOT WIRED INTO THE PRODUCT, and deliberately so. PP0.13 (`handoff.md`)
 * ran this against the real `analyzeResumeATS()` on eight live fixtures and the
 * model won decisively on long, boilerplate-heavy postings: this module showed
 * the user `Christmas`, `Twenty`, `Tuition`, `Free`, `Unlimited` and `Home` as
 * missing job requirements (each the first word of a benefits line), split
 * `Swan-Ganz` in two and truncated `ASC 606` to `ASC`. `ats-analyze.ts` is
 * unchanged. It lives beside `ats-keyword-determinism-check.ts` under
 * `scripts/` rather than in `src/` because it is the harness's other half, not
 * production surface — `npx tsx scripts/ats-keyword-determinism-check.ts --hard
 * --deterministic` reproduces the finding with zero AI calls.
 *
 * The ATS system prompt's KEYWORDS paragraph does not describe a judgement — it
 * describes a string algorithm: exact and near-exact token matching, no
 * semantic credit, heavy job-title weighting, hard skills over soft skills, and
 * "list every missing term using the job description's EXACT phrasing". A model
 * asked to run a string algorithm runs it approximately; this module runs it.
 *
 * Dependency-free like `ats-parse-check.ts`: pure text work over the same
 * serialized resume text the analyzer already builds, so it is unit-testable
 * without a database or a model.
 *
 * Two pieces are borrowed rather than rewritten:
 * - `extractRequirementTerms()` (`application-grounding.ts`) derives the
 *   employer's requirement list career-neutrally, and already drops generic
 *   soft skills, posting furniture, geography, benefits and degrees. That is
 *   where "hard skills count for much more than soft skills" is enforced: a
 *   soft skill is never extracted, so it carries zero weight.
 * - `classifyKeywordEvidence()` (`evidence-grounding.ts`) is the whole-token
 *   matcher — `c++`, `.net` and `node.js` survive it, and a fragment inside a
 *   longer term is `ambiguous`, never `supported`.
 */
import { extractRequirementTerms } from "@/shared/lib/application-grounding"
import { classifyKeywordEvidence } from "@/shared/lib/evidence-grounding"

/** How the resume matched one requirement term. */
export type KeywordMatchKind = "exact" | "near" | "partial" | "missing"

export interface KeywordMatch {
  /** The requirement in the job description's exact phrasing. */
  keyword: string
  kind: KeywordMatchKind
  /** The resume wording that matched, when it was not the term itself. */
  matchedAs?: string
}

export interface KeywordScoreResult {
  /**
   * False when there is nothing deterministic to score against — no job
   * description, or a job description no requirement term could be pulled from.
   * The caller must fall back rather than treat `keywordScore` as meaningful.
   */
  scored: boolean
  /** 0-100. Only meaningful when `scored`. */
  keywordScore: number
  /** Terms absent from the resume, in the job description's exact phrasing. */
  missingKeywords: string[]
  /** Terms present verbatim (whole-token, case-insensitive). */
  matchedKeywords: string[]
  /** Present only as a plural/hyphenation variant. Credited, not reported missing. */
  nearKeywords: string[]
  /** Some words of the phrase present, not the phrase. Credited partially AND reported missing. */
  partialKeywords: string[]
  /** Per-term detail, in extraction order. */
  details: KeywordMatch[]
  /** Fraction of requirement weight the resume covers, 0-1. */
  coverage: number
  /** Job-title agreement 0-1, or null when no title could be read from either side. */
  titleScore: number | null
  /** What the two titles were resolved to — surfaced for debugging, not for the user. */
  jobTitle: string | null
  resumeTitle: string | null
}

// ---------------------------------------------------------------------------
// Weighting
// ---------------------------------------------------------------------------

/**
 * "Weight the job-title match heavily" — a third of the keyword sub-score, so a
 * resume whose most recent role title matches the posting's starts 35 points up
 * on one that does not, and neither side can win on the title alone.
 */
export const KEYWORD_SCORE_WEIGHTS = {
  title: 0.35,
  coverage: 0.65,
} as const

/**
 * Credit per match kind. `near` is the prompt's "a plural or hyphenation
 * difference is only a near match"; `partial` is a multi-word requirement whose
 * words appear but not as the phrase ("Spring" and "Boot", never "Spring Boot").
 */
const MATCH_CREDIT: Record<KeywordMatchKind, number> = {
  exact: 1,
  near: 0.75,
  partial: 0.4,
  missing: 0,
}

/** Below this a variant is noise rather than a plural ("bls" -> "bl"). */
const MIN_VARIANT_LENGTH = 3

// ---------------------------------------------------------------------------
// Near-match variants
// ---------------------------------------------------------------------------

function pluralVariants(word: string): string[] {
  // An all-caps token is an acronym, not a noun: "BLS" must never be tried as
  // "BL", and "OSHA" as "OSHAS" is meaningless.
  if (word === word.toUpperCase() && /[A-Z]/.test(word)) return []

  const lower = word.toLowerCase()
  const out: string[] = []

  if (lower.endsWith("ies") && lower.length > 4) out.push(`${word.slice(0, -3)}y`)
  else if (lower.endsWith("ses") || lower.endsWith("xes") || lower.endsWith("ches")) {
    out.push(word.slice(0, -2))
  } else if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 3) {
    out.push(word.slice(0, -1))
  } else {
    out.push(`${word}s`)
    if (lower.endsWith("y") && lower.length > 2) out.push(`${word.slice(0, -1)}ies`)
    if (/(s|x|ch|sh)$/.test(lower)) out.push(`${word}es`)
  }

  return out.filter((variant) => variant.length >= MIN_VARIANT_LENGTH)
}

/**
 * Spellings a real ATS's stemmer would fold together but a whole-token match
 * will not: hyphen/space differences and a plural on the final word.
 */
function nearVariants(term: string): string[] {
  const seeds = new Set<string>([term])
  if (term.includes("-")) seeds.add(term.replace(/-/g, " ").replace(/\s+/g, " ").trim())
  if (/\s/.test(term)) seeds.add(term.replace(/\s+/g, "-"))

  const out = new Set<string>()
  for (const seed of seeds) {
    if (seed !== term) out.add(seed)
    const match = seed.match(/^(.*?)([A-Za-z]+)$/)
    if (!match) continue
    const [, head, last] = match
    for (const variant of pluralVariants(last)) out.add(`${head}${variant}`)
  }
  out.delete(term)
  return [...out]
}

// ---------------------------------------------------------------------------
// Job title
// ---------------------------------------------------------------------------

/**
 * Words that carry no identity in a job title. Seniority words are deliberately
 * NOT here: "Senior Nurse" and "Nurse" are different postings to a recruiter.
 */
const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "at", "in", "to", "with", "on",
  "i", "ii", "iii", "iv", "jr", "sr",
  "unit", "department", "dept", "team", "division", "group",
  "full", "part", "time", "fulltime", "parttime", "contract", "temporary",
  "remote", "hybrid", "onsite", "shift", "night", "day", "days", "nights",
  "level", "new", "grad", "position", "role", "job", "opening", "hiring",
  "wanted", "needed", "we", "are", "is",
])

/** Everything after a title's separator is the employer, the location or the unit. */
const TITLE_TRAILER = /\s+(?:[—–|]|-\s|@\s|at\s)\s*.*$/

function cleanTitle(raw: string): string {
  return raw
    .replace(/^#+\s*/, "")
    .replace(/\([^)]*\)\s*$/, "")
    .replace(TITLE_TRAILER, "")
    .replace(/[,:;].*$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length > 1 && !TITLE_STOPWORDS.has(token))
}

const EXPERIENCE_HEADING = /^##\s*(?:professional\s+|work\s+|relevant\s+)?experience\s*$/i
const SUMMARY_HEADING = /^##\s*(?:professional\s+|career\s+)?(?:summary|profile|objective)\s*$/i
const ANY_HEADING = /^##\s+/

/** Entry headers look like `Senior Backend Engineer at Northwind (2022 - Present)`. */
function readTitleCandidates(
  resumeText: string
): { title: string; weight: number }[] {
  const lines = resumeText.split(/\r?\n/)
  const experience: string[] = []
  let summary: string | null = null

  let mode: "experience" | "summary" | null = null
  for (const line of lines) {
    if (ANY_HEADING.test(line)) {
      mode = EXPERIENCE_HEADING.test(line)
        ? "experience"
        : SUMMARY_HEADING.test(line)
          ? "summary"
          : null
      continue
    }
    const trimmed = line.trim()
    if (!trimmed) continue

    if (mode === "experience") {
      // Bullets are achievements, not titles; a bare `(dates)` line is neither.
      if (/^[-*•]/.test(trimmed)) continue
      const cleaned = cleanTitle(trimmed)
      if (cleaned) experience.push(cleaned)
    } else if (mode === "summary" && summary === null) {
      // The headline is the opening clause, not the whole paragraph.
      summary = trimmed.split(/(?<=[.!?])\s/)[0].slice(0, 160)
    }
  }

  const candidates: { title: string; weight: number }[] = []
  // Reverse-chronological is the resume convention the serializer preserves, so
  // the first entry is the most recent role.
  if (experience[0]) candidates.push({ title: experience[0], weight: 1 })
  if (summary) candidates.push({ title: summary, weight: 1 })
  for (const older of experience.slice(1)) candidates.push({ title: older, weight: 0.6 })
  return candidates
}

function resolveJobTitle(
  jobDescription: string,
  targetRole?: string | null
): string | null {
  const fromRole = targetRole ? cleanTitle(targetRole) : ""
  if (fromRole) return fromRole
  const firstLine = jobDescription.split(/\r?\n/).find((line) => line.trim().length > 0)
  const cleaned = firstLine ? cleanTitle(firstLine) : ""
  return cleaned || null
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function classifyTerm(term: string, resumeText: string): KeywordMatch {
  const verdict = classifyKeywordEvidence(term, resumeText).verdict
  if (verdict === "supported") return { keyword: term, kind: "exact" }

  for (const variant of nearVariants(term)) {
    if (classifyKeywordEvidence(variant, resumeText).verdict === "supported") {
      return { keyword: term, kind: "near", matchedAs: variant }
    }
  }

  // `ambiguous` from the shared classifier means some evidence but not the
  // phrase — partial credit, and still reported missing, because the phrase the
  // posting used is genuinely not in the resume.
  if (verdict === "ambiguous") return { keyword: term, kind: "partial" }

  return { keyword: term, kind: "missing" }
}

function scoreTitle(
  jobTitle: string | null,
  candidates: { title: string; weight: number }[]
): { score: number | null; matchedTitle: string | null } {
  if (!jobTitle) return { score: null, matchedTitle: null }
  const wanted = titleTokens(jobTitle)
  if (wanted.length === 0) return { score: null, matchedTitle: null }
  if (candidates.length === 0) return { score: null, matchedTitle: null }

  let best = 0
  let bestTitle: string | null = null
  for (const candidate of candidates) {
    const hits = wanted.filter((token) => {
      return classifyKeywordEvidence(token, candidate.title).verdict === "supported"
    }).length
    const score = (hits / wanted.length) * candidate.weight
    if (score > best) {
      best = score
      bestTitle = candidate.title
    }
  }
  return { score: best, matchedTitle: bestTitle ?? candidates[0].title }
}

const EMPTY: Omit<KeywordScoreResult, "keywordScore" | "scored"> = {
  missingKeywords: [],
  matchedKeywords: [],
  nearKeywords: [],
  partialKeywords: [],
  details: [],
  coverage: 0,
  titleScore: null,
  jobTitle: null,
  resumeTitle: null,
}

/**
 * Score the resume's keyword coverage of a posting, deterministically.
 *
 * Returns `scored: false` when there is no job description, or when no
 * requirement term could be extracted from the one supplied. There is no honest
 * deterministic answer in that case: "score against the target role's standard
 * terminology" needs to know what a Registered Nurse posting normally asks for,
 * which is world knowledge, not string work. The caller keeps the model's
 * number rather than this module inventing one.
 */
export function scoreKeywords(
  resumeText: string,
  jobDescription: string | null | undefined,
  targetRole?: string | null
): KeywordScoreResult {
  if (!jobDescription?.trim() || !resumeText.trim()) {
    return { ...EMPTY, scored: false, keywordScore: 0 }
  }

  const terms = extractRequirementTerms(jobDescription)
  const jobTitle = resolveJobTitle(jobDescription, targetRole)
  const candidates = readTitleCandidates(resumeText)
  const { score: titleScore, matchedTitle } = scoreTitle(jobTitle, candidates)

  if (terms.length === 0) {
    return { ...EMPTY, scored: false, keywordScore: 0, jobTitle, titleScore, resumeTitle: matchedTitle }
  }

  const details = terms.map((term) => classifyTerm(term, resumeText))
  const credit = details.reduce((sum, detail) => sum + MATCH_CREDIT[detail.kind], 0)
  const coverage = credit / details.length

  const keywordScore =
    titleScore === null
      ? Math.round(coverage * 100)
      : Math.round(
          (titleScore * KEYWORD_SCORE_WEIGHTS.title +
            coverage * KEYWORD_SCORE_WEIGHTS.coverage) *
            100
        )

  const of = (kind: KeywordMatchKind) =>
    details.filter((detail) => detail.kind === kind).map((detail) => detail.keyword)

  return {
    scored: true,
    keywordScore: Math.min(100, Math.max(0, keywordScore)),
    // A near match is credited and NOT reported: telling a candidate who wrote
    // "journal entry" to add "journal entries" is noise, not a finding.
    missingKeywords: details
      .filter((detail) => detail.kind === "missing" || detail.kind === "partial")
      .map((detail) => detail.keyword),
    matchedKeywords: of("exact"),
    nearKeywords: of("near"),
    partialKeywords: of("partial"),
    details,
    coverage,
    titleScore,
    jobTitle,
    resumeTitle: matchedTitle,
  }
}
