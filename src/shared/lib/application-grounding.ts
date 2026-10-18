/**
 * Evidence grounding for generated application PROSE — cover letters and the
 * outreach/application/reply emails.
 *
 * `evidence-grounding.ts` handles the resume paths, where the ATS analyzer
 * already hands us a requirement list (`missingKeywords`). The prose generators
 * have no analyzer run: they receive raw employer-side text (a job description,
 * a recruiter's email, a scraped LinkedIn profile) and write in the candidate's
 * first person. The same failure mode applies — a technology the EMPLOYER asked
 * for becomes a technology the candidate claims — but the requirement list has
 * to be derived first. That is what this module adds.
 *
 * Two halves, mirroring the resume path:
 *   1. `groundEmployerRequirements()` derives requirement-shaped terms from the
 *      employer text, classifies them against the candidate's own text, and
 *      renders the SUPPORTED / NEEDS CONFIRMATION / DO NOT CLAIM prompt block.
 *   2. `checkGeneratedDraft()` post-checks the generated draft deterministically,
 *      because the prompt is guidance and the post-check is the control.
 *
 * WHERE THIS DIFFERS FROM THE RESUME PATH, DELIBERATELY: a resume suggestion is
 * applied with one click and mutates stored content, so an ungrounded one is
 * stripped or discarded. A cover letter or email is a single prose deliverable
 * the user reads, edits and copies by hand — silently deleting sentences from it
 * would hand back broken text. Here the post-check REPORTS: the caller returns
 * the offending terms and the surface names them to the user before they send.
 *
 * Dependency-free on purpose, like its sibling.
 */

import {
  findIntroducedKeywordContexts,
  groundKeywords,
  type GroundedKeywords,
  type KeywordEvidence,
  type KeywordOccurrence,
} from "./evidence-grounding"

// ---------------------------------------------------------------------------
// Requirement-term extraction
// ---------------------------------------------------------------------------

/** Employer text beyond this is not scanned; postings repeat themselves. */
const MAX_EMPLOYER_TEXT_LENGTH = 8000

/** Upper bound on extracted terms, so a keyword-stuffed posting cannot bloat a prompt. */
const MAX_TERMS = 40

/** A maximal run of characters that can make up a technology token. */
const TOKEN_PATTERN = /[A-Za-z0-9+#./-]+/g

/** Acronyms and initialisms: JPQL, JMS, AWS, SQL, S3, ETL. */
const ACRONYM = /^[A-Z][A-Z0-9]{1,7}$/

/** Internal capital: JavaScript, PostgreSQL, GraphQL, MongoDB, iOS. */
const INTERNAL_CAPITAL = /^[A-Za-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/

/** Punctuated technology names: Node.js, C++, C#, ASP.NET, .NET. */
const PUNCTUATED_TECH = /^\.?[A-Za-z][A-Za-z0-9]*(?:[.+#][A-Za-z0-9+#]*)+$/

/** Plain proper-noun shape: Java, Kafka, Docker, Terraform, Excel, Spanish. */
const CAPITALIZED = /^[A-Z][a-z][A-Za-z0-9]*$/

/**
 * A line that is enumerating what the employer wants. Bullets and numbered
 * items carry most real requirements; the cue phrases catch the ones written as
 * prose ("experience with Kafka", "proficient in Excel").
 */
const LIST_ITEM = /^\s*(?:[-*•·–—]|\(?\d{1,2}[.)])\s+/
const REQUIREMENT_CUE =
  /\b(?:experience (?:with|in|using)|proficien(?:t|cy)|familiar(?:ity)? with|knowledge of|skilled in|expertise in|hands[- ]on|comfortable with|working knowledge|must have|nice to have|you'll use|we use|our stack|tech stack|requirements|responsibilities|qualifications|skills)\b/i

/**
 * Terms that pass the shape test but say nothing about capability — geography,
 * HR vocabulary, benefits, degrees, time zones, filler. Extracting one would
 * make the post-check warn about a word that was never a claim.
 */
const NON_SKILL_TERMS = new Set([
  // Geography and org units
  "us", "usa", "uk", "eu", "eea", "emea", "apac", "latam", "na",
  "ny", "nyc", "sf", "la", "dc", "hq", "it",
  // Titles and functions
  "hr", "ceo", "cto", "coo", "cfo", "cio", "cmo", "vp", "svp", "evp",
  "pm", "hm", "ta", "sme", "ic",
  // Benefits, compliance, comp
  "pto", "401k", "hsa", "fsa", "ppo", "hmo", "eeo", "ada", "dei",
  "lgbtq", "lgbtqia", "ote", "rsu", "rsus", "ipo", "ebitda", "kpi", "kpis",
  // Degrees
  "phd", "bs", "ba", "ms", "mba", "msc", "bsc", "gpa",
  // Time and filler
  "am", "pm", "est", "pst", "cst", "mst", "utc", "gmt", "cet",
  "q1", "q2", "q3", "q4", "ok", "tbd", "tba", "asap", "fyi", "faq",
  "eg", "ie", "etc", "covid", "yoe", "wfh",
  // Benefits and time nouns — real words in a posting, never a capability.
  "day", "days", "week", "weeks", "month", "months", "hour", "hours",
  "annual", "annually", "budget", "holiday", "holidays", "leave", "insurance",
  "stipend", "allowance", "coverage", "retirement", "pension", "equity",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  // Ordinary English that happens to be capitalised in a posting
  "we", "you", "your", "our", "the", "this", "that", "these", "those",
  "and", "for", "with", "from", "all", "any", "each", "every", "both",
  "will", "would", "can", "could", "should", "must", "may", "have", "has",
  "are", "not", "who", "what", "when", "where", "why", "how", "which",
  "while", "about", "after", "before", "during", "between", "through",
  "more", "most", "other", "some", "such", "only", "than", "then", "there",
  "here", "just", "now", "please", "thank", "thanks", "note", "also", "plus",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  // Job-posting furniture
  "role", "roles", "job", "jobs", "position", "title", "company", "team",
  "teams", "location", "remote", "hybrid", "onsite", "office", "salary",
  "benefits", "requirements", "responsibilities", "qualifications", "skills",
  "experience", "apply", "description", "overview", "summary", "duties",
  "preferred", "required", "nice", "bonus", "years", "year", "full", "part",
  "time", "senior", "junior", "lead", "principal", "staff", "manager",
  "director", "engineer", "developer", "analyst", "designer", "specialist",
  "coordinator", "assistant", "associate", "consultant", "intern",
  "strong", "excellent", "good", "great", "ability", "knowledge",
  "understanding", "familiarity", "proficiency", "proficient", "expertise",
  "working", "hands", "deep", "solid", "proven", "track", "record",
  "candidate", "candidates", "applicant", "applicants", "opportunity",
  // Generic soft skills. Everyone can claim these and nobody can be caught out
  // by one, so barring them buys nothing and costs the candidate real sentences.
  "communication", "communications", "collaboration", "collaborative",
  "teamwork", "interpersonal", "organizational", "organisational",
  "analytical", "leadership", "attention", "detail", "details", "multitasking",
  "written", "verbal", "ambiguity", "adaptability", "flexibility", "initiative",
  "autonomy", "ownership", "curiosity", "empathy", "judgement", "judgment",
  "mindset", "motivation", "reliability", "punctuality", "professionalism",
])

/**
 * Words that are capitalised only because they open a bullet or a sentence.
 * They pass the plain-capitalized shape test but describe the work, not a
 * capability, and extracting one poisons BOTH halves of the feature: "Operate"
 * under DO NOT CLAIM forbids the model from saying the candidate operates the
 * services their resume says they operate, and "Own" in a warning names a word
 * the user never claimed as a skill.
 *
 * Applied only in a forced-capital position, so a genuine mid-line use — "Design
 * Systems experience", "experience with Splunk" — still qualifies, and an
 * acronym or internal-capital name at the head of a bullet is untouched.
 */
const LINE_INITIAL_NON_SKILL = new Set([
  // Imperative verbs that open a responsibilities bullet
  "architect", "assist", "build", "champion", "collaborate", "communicate",
  "conduct", "configure", "contribute", "coordinate", "create", "define",
  "deliver", "deploy", "design", "develop", "diagnose", "document", "drive",
  "encourage", "engage", "ensure", "establish", "evaluate", "evolve",
  "execute", "expand", "facilitate", "foster", "gather", "generate", "grow",
  "guide", "handle", "help", "identify", "implement", "improve", "influence",
  "instrument", "integrate", "investigate", "iterate", "join", "keep", "launch",
  "learn", "leverage", "maintain", "make", "manage", "measure", "mentor",
  "migrate", "modernize", "monitor", "navigate", "operate", "optimize", "own",
  "participate", "partner", "perform", "plan", "prepare", "prioritize",
  "produce", "provide", "refactor", "report", "research", "resolve", "review",
  "scale", "shape", "ship", "solve", "support", "sustain", "take", "test",
  "track", "translate", "troubleshoot", "understand", "use", "validate",
  "write",
  // Adjectives and nouns that open a requirements bullet
  "advanced", "basic", "comfortable", "competitive", "curious", "demonstrated",
  "detail", "eager", "effective", "exceptional", "extensive", "fluent", "high",
  "ideal", "independent", "intermediate", "motivated", "must", "outstanding",
  "passion", "passionate", "practical", "prior", "production", "professional",
  "real", "relevant", "self", "significant", "substantial", "successful",
  "superb", "willing", "willingness",
  // Surfaced by the career-coverage run: qualifiers that open a requirements
  // bullet ("Current BLS and ACLS certification", "Skilled in butchery").
  "active", "adept", "certified", "competent", "current", "familiar",
  "knowledgeable", "licensed", "minimum", "recent", "skilled", "trained",
  "valid", "versed",
])

// ---------------------------------------------------------------------------
// Career-neutral requirement phrases
// ---------------------------------------------------------------------------

/**
 * Every shape above needs a capital letter, which is a bet that a requirement
 * looks like `Kafka`, `PostgreSQL` or `JMS`. That bet only pays out in
 * software. A nurse's posting asks for `venipuncture` and `wound care`, an
 * accountant's for `accounts payable` and `month-end close`, a cook's for
 * `butchery` and `a la carte service` — lowercase, and mostly more than one
 * word. Measured on five postings, the token scan caught 7/8 requirements on a
 * software posting and 1–2 out of 8–10 on every other career: DO NOT CLAIM came
 * out nearly empty, so the feature silently stopped protecting those users.
 *
 * This pass anchors on the STRUCTURE of a requirement sentence instead of on
 * capitalisation — a cue names the requirement that follows it ("proficiency in
 * X"), or a category noun trails the thing it qualifies ("X certification").
 * That grammar is career-neutral, which is exactly the property a capital
 * letter never had.
 *
 * Why the looser bar is affordable here: extraction only PROPOSES terms, and
 * `groundKeywords()` then classifies each one against the candidate's own
 * resume. A stray phrase the resume DOES contain lands in SUPPORTED and changes
 * nothing the user sees. Only a phrase that is both spurious and absent from
 * the resume can reach DO NOT CLAIM — the `Operate` failure PP0.3 fixed
 * positionally — so the filters below are aimed squarely at that case.
 */

/** "proficiency in X", "experience with X", "certified in X". */
const PHRASE_CUE_LEAD =
  /\b(?:experience[ds]?|proficien(?:t|cy)|skilled|skills?|expertise|competen(?:t|cy|ce)|fluen(?:t|cy)|train(?:ed|ing)|certified|certifications?|licen[sc]ed|versed|adept|comfortable|familiar(?:ity)?|knowledge|understanding|background|exposure|specialis(?:ing|ed)|specializ(?:ing|ed))\s+(?:with|in|using|of|at|on)\s+/gi

/** "X experience", "X skills", "X certification" — the requirement precedes the noun. */
const PHRASE_CUE_TRAIL =
  /\b(?:experience|skills?|certifications?|certificate|background|expertise|knowledge|proficiency|training)\b/i

/** "5+ years of X", "2 years on X". */
const YEARS_OF = /\b\d{1,2}\+?\s*(?:years?|yrs?)\s+(?:of|in|on|as|with)?\s*/gi

/** Splits one captured span into the separate requirements it lists. */
const PHRASE_SPLIT = /,|;|\/|&|\band\b|\bor\b/i

/** Longest phrase worth carrying; past this it is a sentence fragment. */
const MAX_PHRASE_WORDS = 4
const MAX_PHRASE_LENGTH = 40

/** Leading words that qualify a requirement without being part of it. */
const PHRASE_LEADING_FILLER = new Set([
  "a", "an", "the", "and", "or", "both", "either", "all", "any", "some",
  "at", "least", "minimum", "min", "up", "over", "about", "including",
  "include", "includes", "such", "as", "with", "in", "of", "on", "for", "to",
  "using", "our", "your", "their", "its",
  "strong", "solid", "deep", "advanced", "basic", "excellent", "good", "great",
  "working", "prior", "proven", "demonstrated", "extensive", "significant",
  "relevant", "current", "valid", "active", "recent", "hands-on", "hands",
  "high", "highly", "very", "well", "real", "true", "ideally", "preferably",
  "must", "have", "has", "is", "are", "be", "been", "plus", "bonus",
  "experience", "experienced", "years", "year", "yrs", "practical",
  "professional", "substantial", "successful", "exceptional",
])

/** Trailing words naming the requirement's category rather than the requirement. */
const PHRASE_TRAILING_FILLER = new Set([
  "a", "an", "the", "is", "plus", "bonus", "preferred", "required", "desirable",
  "desired", "ideal", "etc", "experience", "experiences", "skill", "skills",
  "knowledge", "certification", "certifications", "certificate", "certified",
  "background", "expertise", "proficiency", "training", "ability", "abilities",
  "setting", "settings", "environment", "environments", "role", "roles",
])

/**
 * Structural words that only ever join clauses. A cleaned requirement phrase
 * containing one is a sentence fragment ("HMO from day one"), not a capability.
 * `of`, `in` and `with` are deliberately ABSENT — real requirements contain
 * them ("point of sale", "return to work").
 */
const PHRASE_CONNECTOR = new Set([
  "from", "per", "by", "via", "into", "onto", "within", "across", "after",
  "before", "during", "between", "through", "under", "than", "then", "while",
  "when", "where", "that", "which", "who", "whom", "whose", "but", "if",
  "because", "since", "until", "upon", "against", "among", "along", "around",
  "behind", "beyond", "toward", "towards", "near", "next", "like", "unlike",
])

/**
 * Pronouns, auxiliaries and question words. A span carrying one is a sentence
 * ("Do you have JPQL experience?" in a recruiter's email), never a capability —
 * and left alone it would bar the phrase "Do you have JPQL" while hiding the
 * real requirement, `JPQL`, inside it.
 */
const PHRASE_SENTENCE_WORD = new Set([
  "do", "does", "did", "doing", "done", "you", "your", "we", "our", "us",
  "they", "their", "them", "i", "my", "me", "he", "she", "it", "its",
  "have", "has", "had", "will", "would", "can", "could", "should", "must",
  "may", "might", "are", "is", "was", "were", "be", "been", "being",
  "any", "much", "many", "how", "what", "when", "where", "why", "which",
  "who", "there", "here", "this", "that", "these", "those",
  "get", "got", "make", "made", "take", "need", "needs", "want", "wants",
  "looking", "seeking", "please", "tell",
])

/** A word that can belong to a requirement phrase. */
const PHRASE_WORD = /^[A-Za-z][A-Za-z0-9'’+#.-]*$/

function normalizeTerm(value: string): string {
  return value.toLowerCase().trim()
}

/** Strip punctuation that is sentence structure rather than part of the name. */
function trimTokenEdges(token: string): string {
  // A leading `.` is kept (`.NET`); a trailing one never is.
  return token.replace(/[-/.]+$/, "").replace(/^[-/]+/, "")
}

/**
 * Whether a token is requirement-shaped.
 *
 * Acronyms, internal-capital names and punctuated technology names are
 * high-signal enough to qualify anywhere in the text. A plain `Capitalized`
 * word is not — most of them are sentence starters, cities and people — so it
 * only qualifies inside a line that is actually enumerating requirements.
 */
function looksLikeRequirement(
  token: string,
  inRequirementLine: boolean,
  forcedCapital: boolean
): boolean {
  if (token.length < 2 || token.length > 24) return false
  if (!/[A-Za-z]/.test(token)) return false
  if (ACRONYM.test(token) || INTERNAL_CAPITAL.test(token) || PUNCTUATED_TECH.test(token)) {
    return true
  }
  if (!inRequirementLine || token.length < 3 || !CAPITALIZED.test(token)) return false
  // At the head of a bullet or a sentence the capital is positional, so the
  // word carries none of the signal the plain-capitalized rule relies on.
  return !(forcedCapital && LINE_INITIAL_NON_SKILL.has(normalizeTerm(token)))
}

function splitWords(value: string): string[] {
  return value.split(/\s+/).filter(Boolean)
}

/**
 * Trim the qualifiers off one listed requirement and decide whether what is
 * left is a capability someone could claim. Returns null when it is not.
 */
function cleanPhrase(raw: string): string | null {
  const trimmed = raw
    .replace(/^[^A-Za-z0-9.]+/, "")
    .replace(/[^A-Za-z0-9+#]+$/, "")
  if (!trimmed) return null

  // A cue can survive inside a span the split did not cut ("Production
  // experience with JMS"). What follows the last cue is the requirement.
  PHRASE_CUE_LEAD.lastIndex = 0
  let afterCue = trimmed
  let cueMatch: RegExpExecArray | null
  while ((cueMatch = PHRASE_CUE_LEAD.exec(trimmed)) !== null) {
    afterCue = trimmed.slice(cueMatch.index + cueMatch[0].length)
    if (cueMatch.index === PHRASE_CUE_LEAD.lastIndex) PHRASE_CUE_LEAD.lastIndex++
  }

  let words = splitWords(afterCue)

  // Leading qualifiers ("strong", "3+", "prior", "Do you have").
  while (words.length > 0) {
    const first = normalizeTerm(words[0])
    // An article is kept when the word behind it is too short to head the
    // phrase, so "a la carte service" survives intact while "a hospital
    // setting" loses its article. ("la" is in the geography stoplist.)
    if (
      (first === "a" || first === "an" || first === "the") &&
      words.length > 1 &&
      words[1].length <= 2
    ) {
      break
    }
    if (/^\d+\+?$/.test(first)) {
      words = words.slice(1)
      continue
    }
    if (
      !PHRASE_LEADING_FILLER.has(first) &&
      !LINE_INITIAL_NON_SKILL.has(first) &&
      !PHRASE_SENTENCE_WORD.has(first) &&
      !NON_SKILL_TERMS.has(first)
    ) {
      break
    }
    words = words.slice(1)
  }

  while (
    words.length > 0 &&
    PHRASE_TRAILING_FILLER.has(normalizeTerm(words[words.length - 1]))
  ) {
    words = words.slice(0, -1)
  }

  if (words.length === 0 || words.length > MAX_PHRASE_WORDS) return null
  if (!words.every((word) => PHRASE_WORD.test(word))) return null
  if (
    words.some((word) => {
      const normalized = normalizeTerm(word)
      return PHRASE_CONNECTOR.has(normalized) || PHRASE_SENTENCE_WORD.has(normalized)
    })
  ) {
    return null
  }

  const phrase = words.join(" ")
  if (phrase.length > MAX_PHRASE_LENGTH) return null

  const key = normalizeTerm(phrase)
  if (NON_SKILL_TERMS.has(key)) return null
  if (words.length === 1 && (key.length < 3 || LINE_INITIAL_NON_SKILL.has(key))) {
    return null
  }

  // Filler and posting furniture alone is not a requirement ("days PTO").
  const meaningful = words.some((word) => {
    const normalized = normalizeTerm(word)
    return (
      !NON_SKILL_TERMS.has(normalized) &&
      !PHRASE_LEADING_FILLER.has(normalized) &&
      !PHRASE_TRAILING_FILLER.has(normalized)
    )
  })
  return meaningful ? phrase : null
}

/** Cut a captured span at the first hard clause boundary. */
function untilClauseEnd(value: string): string {
  const stop = value.search(/[.:!?](?:\s|$)/)
  return stop === -1 ? value : value.slice(0, stop)
}

/**
 * The requirement phrases one line lists, found by sentence structure rather
 * than by capitalisation. Only called for lines that already read as
 * requirements, so the same gate as the token scan applies.
 */
function extractPhrasesFromLine(line: string): string[] {
  const body = line.replace(LIST_ITEM, " ")
  const spans: string[] = []

  for (const pattern of [PHRASE_CUE_LEAD, YEARS_OF]) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(body)) !== null) {
      spans.push(untilClauseEnd(body.slice(match.index + match[0].length)))
      if (match.index === pattern.lastIndex) pattern.lastIndex++
    }
  }

  // "X experience", "X certification": here the requirement sits BEFORE the noun.
  const trail = body.match(PHRASE_CUE_TRAIL)
  if (trail?.index) spans.push(body.slice(0, trail.index))

  const phrases: string[] = []
  for (const span of spans) {
    for (const part of span.split(PHRASE_SPLIT)) {
      const cleaned = cleanPhrase(part)
      if (cleaned) phrases.push(cleaned)
    }
  }
  return phrases
}

/**
 * Pull requirement-shaped terms out of employer-side text.
 *
 * Conservative on purpose. A lowercase `kubernetes` in a sloppily written
 * posting is missed, and so is a `Terraform` buried in a prose paragraph with
 * no requirement cue. That is the right direction to fail: a missed term costs
 * one warning, a spurious one costs the user's trust in every warning.
 *
 * `exclude` should carry the company name, the role title and any contact name:
 * those legitimately appear in the draft and are not claims about the candidate.
 */
export function extractRequirementTerms(
  employerText: string,
  exclude: readonly string[] = []
): string[] {
  if (!employerText) return []

  const excluded = new Set<string>()
  for (const value of exclude) {
    for (const token of value.matchAll(TOKEN_PATTERN)) {
      for (const part of trimTokenEdges(token[0]).split(/[/-]/)) {
        const cleaned = trimTokenEdges(part)
        if (cleaned) excluded.add(normalizeTerm(cleaned))
      }
    }
  }

  const seen = new Set<string>()
  const terms: string[] = []
  const lines = employerText.slice(0, MAX_EMPLOYER_TEXT_LENGTH).split(/\r?\n/)

  const phraseWords = new Set<string>()

  const addTerm = (term: string): void => {
    const key = normalizeTerm(term)
    if (!key || NON_SKILL_TERMS.has(key) || excluded.has(key) || seen.has(key)) return
    seen.add(key)
    terms.push(term)
  }

  for (const line of lines) {
    const isListItem = LIST_ITEM.test(line)
    const inRequirementLine = isListItem || REQUIREMENT_CUE.test(line)
    // Text since the previous word, carrying that word's own trailing
    // punctuation — `Node.js.` keeps its full stop inside the match itself.
    let boundary = ""
    let previousEnd = 0
    let sawWord = false

    for (const match of line.matchAll(TOKEN_PATTERN)) {
      const start = match.index ?? 0
      boundary += line.slice(previousEnd, start)
      previousEnd = start + match[0].length
      const forcedCapital = !sawWord || /[.;:!?]["')\]]?\s+$/.test(boundary)
      const isWord = /[A-Za-z]/.test(match[0])
      if (isWord) {
        sawWord = true
        boundary = match[0]
      } else {
        boundary += match[0]
      }

      // `CI/CD` is two initialisms sharing a separator, and `JMS-backed` hides a
      // real one behind a hyphen; each part is tested on its own.
      for (const part of match[0].split(/[/-]/)) {
        const token = trimTokenEdges(part)
        if (!looksLikeRequirement(token, inRequirementLine, forcedCapital)) continue

        addTerm(token)
      }
    }

    if (!inRequirementLine) continue

    for (const phrase of extractPhrasesFromLine(line)) {
      const words = splitWords(phrase).map(normalizeTerm)
      // Naming the employer or the role is not a claim, in a phrase either.
      if (words.every((word) => excluded.has(word))) continue
      addTerm(phrase)
      if (words.length > 1) {
        for (const word of words) phraseWords.add(word)
      }
    }
  }

  // A multi-word phrase says more than the words it is made of: with "Spring
  // Boot" extracted there is no reason to also bar "Spring" and "Boot", and
  // barring the parts would warn about words the draft only used inside the
  // whole. The phrase wins; its constituents drop out.
  const merged = terms.filter((term) => {
    const key = normalizeTerm(term)
    return !(splitWords(term).length === 1 && phraseWords.has(key))
  })

  return merged.slice(0, MAX_TERMS)
}

// ---------------------------------------------------------------------------
// Prompt block
// ---------------------------------------------------------------------------

function bulletList(values: readonly string[]): string {
  return values.map((value) => `- ${value}`).join("\n")
}

/**
 * The three-way requirement partition, phrased for prose generation.
 *
 * The resume paths carry their own wording (`enhance-ats.ts`,
 * `optimize-resume.ts`) because they are instructing a rewrite of existing
 * fields. This variant is shared by every prose generator, where the extra rule
 * that matters is the one about REFERRING to the employer's stack without
 * claiming it — an email that says "I saw your team uses Kafka" is fine; one
 * that says "I've worked with Kafka" is not.
 */
export function formatRequirementBlock(grounded: GroundedKeywords): string {
  const blocks: string[] = []

  if (grounded.supported.length > 0) {
    blocks.push(
      `SUPPORTED (your own resume backs these — draw on them where they genuinely fit):\n${bulletList(
        grounded.supported
      )}`
    )
  }
  if (grounded.ambiguous.length > 0) {
    blocks.push(
      `NEEDS CONFIRMATION (only partial evidence). You may use the related evidence the resume actually contains, but you must NOT assert the requirement itself as your experience:\n${bulletList(
        grounded.ambiguous
      )}`
    )
  }
  if (grounded.unsupported.length > 0) {
    blocks.push(
      `DO NOT CLAIM (nothing in the resume supports these). You must NOT present any of them as your experience, familiarity or skill, however central they are to the role. Writing one is a false statement on a job application. Leave the gap visible instead:\n${bulletList(
        grounded.unsupported
      )}`
    )
  }

  if (blocks.length === 0) return ""

  // Name only the headings that are actually above, so the rule never points at
  // a section the model cannot see.
  const barredHeadings = [
    grounded.ambiguous.length > 0 ? "NEEDS CONFIRMATION" : null,
    grounded.unsupported.length > 0 ? "DO NOT CLAIM" : null,
  ].filter(Boolean)

  return [
    "REQUIREMENT GROUNDING — a requirement in the employer's text is evidence about the EMPLOYER, never about you. These have already been checked against your resume:",
    "",
    blocks.join("\n\n"),
    ...(barredHeadings.length > 0
      ? [
          "",
          `You may refer to something under ${barredHeadings.join(
            " or "
          )} as the employer's — "the posting mentions X", "your team works in X" — but never as something you have done, used, learned or know.`,
        ]
      : []),
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Caller entry points
// ---------------------------------------------------------------------------

export interface EmployerRequirementGrounding {
  /** Full per-term classification, in the order the terms were found. */
  grounded: GroundedKeywords
  /** Ready-to-embed prompt section. Empty string when nothing was extracted. */
  promptBlock: string
  /**
   * Every term the draft may not claim — ambiguous and unsupported alike. This
   * is what `checkGeneratedDraft()` post-checks against.
   */
  barred: string[]
}

/**
 * Derive, classify and render the employer's requirements in one pass.
 *
 * `evidenceText` must be the candidate's own text (their serialized resume). A
 * wider evidence base can only move a term towards `supported`, so widening it
 * is always safe; narrowing it would manufacture warnings.
 */
export function groundEmployerRequirements(input: {
  /** Job description, notes, scraped profile — whatever the prompt will see. */
  employerText: string
  /** The candidate's own text. */
  evidenceText: string
  /** Company name, role title, contact name: present in the draft, not claims. */
  exclude?: readonly string[]
}): EmployerRequirementGrounding {
  const terms = extractRequirementTerms(input.employerText, input.exclude ?? [])
  const grounded = groundKeywords(terms, input.evidenceText)

  return {
    grounded,
    promptBlock: formatRequirementBlock(grounded),
    barred: [...grounded.ambiguous, ...grounded.unsupported],
  }
}

// ---------------------------------------------------------------------------
// Gap cues: telling an admitted gap from a claim
// ---------------------------------------------------------------------------

/**
 * Phrasing that marks the sentence around a barred term as an ADMITTED GAP
 * rather than a claim — "the Kafka parts of your stack are new to me".
 *
 * Deliberately short and unambiguous. A cue that fires wrongly downgrades a real
 * false claim to the quiet tier, which is the expensive failure; a cue that is
 * missing only costs one avoidable warning. When in doubt, leave it out.
 */
const GAP_CUE_SOURCES = [
  "new to me",
  "haven't used",
  "have not used",
  "haven't worked with",
  "have not worked with",
  "no experience",
  "not familiar",
  "don't have experience",
  "do not have experience",
  "still learning",
  "learning",
  "yet to",
  "not yet",
  "would be new",
  "no hands-on",
  "picking up",
  "ramp up on",
  "unfamiliar",
]

const GAP_CUES = GAP_CUE_SOURCES.map(
  (cue) => new RegExp(`\\b${cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")
)

/**
 * A negator sitting immediately in front of a cue INVERTS it: "none of those
 * are new to me" and "Kafka is not new to me" are boasts wearing the words of
 * an admission. The set is short and the reach is short — the negator has to be
 * within two words of the cue — because the only safe direction to be wrong in
 * is loud: rejecting a cue makes the term `claimed`, which is the default.
 *
 * Cues that CONTAIN their own negator ("have not used", "not yet") are not
 * affected: the scan looks only at the text BEFORE the matched cue.
 *
 * CONTRACTIONS ARE SPELLED OUT because a contracted auxiliary contains no
 * "not" — "aren't" is a-r-e-n-'-t — so a list of spelled-out negators alone was
 * blind to every one of them, and "Kafka isn't new to me" went quiet while
 * "Kafka is not new to me" went loud. Same boast, same words, opposite tier.
 * The sentence reaches here with its apostrophes already folded to the straight
 * one by `sentenceNamesGap`, so only that form needs listing.
 *
 * The reach stays at two words. Widening it is a separate decision and has not
 * been made: "none of Kafka or Kubernetes is new to me" is four words out and
 * is still, wrongly, quiet.
 */
const NEGATED_CUE =
  /\b(?:none of|not|never|hardly|far from|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|haven't|hasn't|hadn't|won't|can't|couldn't|wouldn't|shouldn't|ain't)(?:\s+[a-z'-]+){0,2}\s+$/

/**
 * Compounds where "learning" is a subject, not an admission — "machine learning
 * pipelines" must not read as "I am learning". Removed before the cue scan.
 */
const NON_GAP_LEARNING =
  /\b(?:machine|deep|e|online|blended|reinforcement|transfer|supervised|unsupervised|self|active|social)[\s-]?learning\b|\blearning (?:management|platform|curve|path|objectives?)\b/g

/**
 * True when a sentence admits a gap. Operates on the normalized (lowercased)
 * sentence the matcher reported, after folding curly apostrophes so a model's
 * "haven't" matches whichever apostrophe it typed.
 *
 * A cue only counts where it is not negated, and EVERY occurrence of it is
 * checked: one un-negated cue is an admission, but "none of those are new to
 * me" must not read as one. Both callers — the same-sentence path and the
 * carry — go through here, so the guard covers both.
 */
function sentenceNamesGap(sentence: string): boolean {
  const text = sentence
    .replace(/[‘’ʼ]/g, "'")
    .replace(NON_GAP_LEARNING, " ")
  return GAP_CUES.some((cue) => {
    cue.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = cue.exec(text)) !== null) {
      if (!NEGATED_CUE.test(text.slice(0, match.index))) return true
      if (match.index === cue.lastIndex) cue.lastIndex++
    }
    return false
  })
}

// ---------------------------------------------------------------------------
// Contrastive gap phrasing: "X rather than Y"
// ---------------------------------------------------------------------------

/**
 * A contrast admits a gap by naming what it is NOT. "My deployments have run
 * through Docker and GitLab rather than Kubernetes" owns the Kubernetes gap
 * without using one word from `GAP_CUE_SOURCES`, and a real cover letter wrote
 * three of these in a single sentence — under the heading "I want to be
 * straight about the gaps" — and collected two amber warnings for it.
 *
 * WHY THIS CANNOT BE ANOTHER ENTRY IN `GAP_CUE_SOURCES`, which is the whole
 * point of this section: those cues are SENTENCE-scoped, and a contrast is
 * DIRECTIONAL. In "X rather than Y", Y is the gap and X is a CLAIM. Add
 * "rather than" to the cue list and "I used Kafka rather than RabbitMQ" goes
 * quiet — the exact inversion this module exists to prevent, on the exact tier
 * where being wrong is expensive.
 *
 * So coverage here is POSITIONAL: only the text lying after the marker counts,
 * and a term in front of one is untouched by it.
 *
 * Three markers, deliberately. The cue list is short for a reason and this is
 * the same reason: a marker that fires wrongly downgrades a real claim.
 */
const CONTRASTIVE_MARKER = /\b(?:rather than|instead of|as opposed to)\b/g

/**
 * Where a marker's reach STOPS. One sentence can carry several contrasts, and
 * the clause after the first one is a fresh statement:
 *
 *   "I used Kafka rather than RabbitMQ, and Terraform rather than CloudFormation."
 *
 * Terraform sits AFTER the first marker and is still a boast. So "anything
 * after a marker" is wrong; the span has to close at the clause boundary, at
 * the next marker, or at the end of the sentence — whichever comes first.
 *
 * The list is deliberately over-eager. Every coordinating conjunction counts as
 * a boundary, including the `and` of an ordinary list ("rather than Kubernetes
 * and Terraform" leaves Terraform LOUD), because telling a list `and` from a
 * clause `and` needs the sentence parsing this whole module refuses to depend
 * on. That costs an avoidable warning; the alternative costs a silenced claim,
 * and only one of those two is recoverable by the person reading the draft.
 *
 * A bare hyphen is NOT a boundary — it lives inside words ("hands-on"). Only
 * the spaced dashes a writer uses as punctuation are.
 */
const CONTRASTIVE_SPAN_END =
  /[,;:—–]|\b(?:and|or|but|nor|yet|so|while|whereas|although|though|because)\b/g

/** Token characters, matching the whole-token rule in `evidence-grounding`. */
const TERM_CHAR = /[a-z0-9+#]/

/** Every whole-token position of `needle` in an already-normalized `haystack`. */
function wholeTokenRanges(haystack: string, needle: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  if (!needle) return ranges
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(haystack)) !== null) {
    const start = match.index
    const end = start + match[0].length
    const before = start > 0 ? haystack[start - 1] : ""
    const after = end < haystack.length ? haystack[end] : ""
    if (!TERM_CHAR.test(before) && !TERM_CHAR.test(after)) ranges.push([start, end])
    if (match.index === pattern.lastIndex) pattern.lastIndex++
  }
  return ranges
}

/** The half-open ranges each contrastive marker in a sentence speaks for. */
function contrastiveSpans(sentence: string): Array<{ start: number; end: number }> {
  CONTRASTIVE_MARKER.lastIndex = 0
  const markerStarts: number[] = []
  const spanStarts: number[] = []
  let match: RegExpExecArray | null
  while ((match = CONTRASTIVE_MARKER.exec(sentence)) !== null) {
    markerStarts.push(match.index)
    spanStarts.push(match.index + match[0].length)
    if (match.index === CONTRASTIVE_MARKER.lastIndex) CONTRASTIVE_MARKER.lastIndex++
  }

  return spanStarts.map((start, index) => {
    let end = sentence.length
    const nextMarker = markerStarts[index + 1]
    if (nextMarker !== undefined) end = Math.min(end, nextMarker)
    CONTRASTIVE_SPAN_END.lastIndex = start
    const boundary = CONTRASTIVE_SPAN_END.exec(sentence)
    if (boundary !== null) end = Math.min(end, boundary.index)
    return { start, end }
  })
}

/**
 * True when a contrast in this sentence disowns this term.
 *
 * EVERY position of the term in the sentence has to sit inside a span, on the
 * same principle as the every-occurrence rule one level up: "I ran Kafka before
 * we moved to Pulsar rather than Kafka" mentions it once as a boast, and one
 * boast is enough.
 *
 * Same-sentence only. This never joins the cross-sentence carry in
 * `occurrenceNamesGap` — a position cannot transfer across a sentence boundary,
 * and licensing that would be a separate decision nobody has made.
 */
function contrastiveMarkerCovers(sentence: string, keyword: string): boolean {
  const needle = keyword.toLowerCase().replace(/\s+/g, " ").trim()
  if (!needle) return false
  const spans = contrastiveSpans(sentence)
  if (spans.length === 0) return false
  const ranges = wholeTokenRanges(sentence, needle)
  if (ranges.length === 0) return false
  return ranges.every(([start, end]) =>
    spans.some((span) => start >= span.start && end <= span.end)
  )
}

/**
 * Words that point BACK at whatever the previous sentence just listed. Without
 * one, a following gap sentence is talking about something else and says
 * nothing about the terms before it.
 *
 * Plural referents only, for the same reason the singular "it" is absent: "that"
 * in English is overwhelmingly a complementizer ("I am confident that I can ramp
 * up"), a determiner ("That work taught me plenty") or discourse glue ("That
 * said, I am still learning") — none of which point at the previous sentence's
 * terms. Paired with cues as loose as "learning", it let stock filler silence a
 * boast standing right in front of it.
 */
const ANAPHORIC_REFERENT = /\b(?:those|them|these)\b/

/**
 * True when one occurrence of a term is covered by an admission.
 *
 * Two shapes count. The first is the original: the cue sits in the same
 * sentence as the term ("Kafka is new to me"). The second is what long prose
 * actually writes, and what a real cover letter did — name the requirements in
 * one sentence and own the gap in the NEXT one, pointing back:
 *
 *   "… runs on JMS and Kafka, and your team operates on Kubernetes and
 *    Terraform. I haven't worked with those yet."
 *
 * That carry is allowed only when the following sentence REFERS BACK and adds
 * no barred term of its own — a sentence like "I haven't worked with those, but
 * Kubernetes is a daily tool for me" is making its own claim, and is not
 * allowed to speak for the sentence before it.
 *
 * The widening is one-directional on purpose. A cue in the PRECEDING sentence
 * still covers nothing: "I have not used JMS. Kafka is where my throughput work
 * lives." is two independent statements, and the second one is a claim.
 *
 * A third shape sits between the two: a CONTRAST that disowns the term by
 * position rather than by phrasing ("… rather than Kubernetes"). It needs the
 * term itself, not just the sentence, because the contrast points one way —
 * see `contrastiveMarkerCovers`. It is checked only against the term's OWN
 * sentence, never against the neighbour.
 */
function occurrenceNamesGap(occurrence: KeywordOccurrence, keyword: string): boolean {
  if (sentenceNamesGap(occurrence.sentence)) return true
  if (contrastiveMarkerCovers(occurrence.sentence, keyword)) return true

  const next = occurrence.nextSentence
  if (next === null) return false
  if (occurrence.keywordsAddedByNextSentence.length > 0) return false
  if (!ANAPHORIC_REFERENT.test(next)) return false
  return sentenceNamesGap(next)
}

/** What a surface shows the user about a draft it just generated. */
export interface GenerationGrounding {
  /**
   * Barred requirements the draft mentions with NO gap cue anywhere around them
   * — the ones that may read as the candidate's own experience. This is the
   * loud tier, and the default: anything the check is not sure about lands here.
   */
  claimed: KeywordEvidence[]
  /**
   * Barred requirements every occurrence of which sits in a sentence that names
   * them as something the candidate has NOT done. Still reported, quietly, so
   * the user can confirm the admission was intended.
   *
   * Optional on purpose: a grounding record persisted before this split exists
   * holds only `claimed`, and must keep rendering exactly as it did — everything
   * under the loud heading.
   */
  namedAsGap?: KeywordEvidence[]
}

/**
 * Deterministic post-check, shaped for the UI. Returns `null` when the draft is
 * clean, so a caller can drop it into a response without inventing an empty
 * object for the common case.
 *
 * Note the honest limit: this finds MENTIONS, not assertions. A draft that says
 * "your team works in Kafka" trips the same wire as one that says "I've used
 * Kafka". The surfaces word their warning accordingly ("the draft mentions
 * these — make sure they don't read as your experience") rather than accusing
 * the model of lying, because separating the two reliably would need exactly
 * the semantic judgement this layer exists to avoid depending on.
 *
 * One distinction it does draw, because a real draft made it unavoidable: a
 * mention every occurrence of which sits inside gap phrasing ("the Kafka, JMS
 * and Kubernetes parts of your stack are new to me") is honest, and warning
 * about it in the same red as a fabricated claim teaches the user to ignore the
 * warning. Those terms go to `namedAsGap` and are still shown, quietly. The
 * split fails toward `claimed` at every step: no gap cue, no sentence context,
 * or one claiming occurrence among many, and the term is loud again.
 *
 * The cue may also sit in the sentence IMMEDIATELY AFTER the term, under the
 * two conditions in `occurrenceNamesGap` — long prose lists the requirements
 * first and admits the gap second. Nothing wider: a cue two sentences later, or
 * one in the sentence BEFORE, still covers nothing.
 *
 * A gap can also be admitted by CONTRAST — "my deployments have run through
 * Docker and GitLab rather than Kubernetes" — which carries no cue word at all.
 * That shape is positional and same-sentence only; `contrastiveMarkerCovers`
 * explains why it cannot be a cue, and why its reach stops at a clause boundary.
 */
export function checkGeneratedDraft(input: {
  grounding: EmployerRequirementGrounding
  evidenceText: string
  /** Every generated field the user will read — subject and body, joined. */
  generated: string
}): GenerationGrounding | null {
  const introduced = findIntroducedKeywordContexts(
    input.evidenceText,
    input.generated,
    input.grounding.barred
  )
  if (introduced.length === 0) return null

  const byKeyword = new Map(
    input.grounding.grounded.details.map((detail) => [detail.keyword, detail])
  )

  const claimed: KeywordEvidence[] = []
  const namedAsGap: KeywordEvidence[] = []

  for (const context of introduced) {
    const detail = byKeyword.get(context.keyword) ?? {
      keyword: context.keyword,
      verdict: "unsupported" as const,
      reason: "Nothing in your resume supports this.",
    }
    // Every occurrence has to be covered. One sentence that uses the term
    // without owning up to the gap is enough to make the whole term a claim,
    // and no sentence context at all means the check could not read it — both
    // stay loud.
    const admitted =
      context.occurrences.length > 0 &&
      context.occurrences.every((occurrence) =>
        occurrenceNamesGap(occurrence, context.keyword)
      )
    if (admitted) namedAsGap.push(detail)
    else claimed.push(detail)
  }

  // `namedAsGap` is omitted when empty so the persisted and over-the-wire shape
  // of the common case is byte-for-byte what it was before the split.
  return namedAsGap.length > 0 ? { claimed, namedAsGap } : { claimed }
}
