/**
 * Deterministic eligibility-requirement extraction (work authorisation, location
 * restrictions, clearance). Deliberately dependency-free: this runs on the create
 * path of every tracked job, including the extension route, so it must not drag
 * the AI stack into that module graph, must be fast, and must never be a reason a
 * create fails.
 *
 * English and German, and intentionally conservative, same posture as
 * `job-risk.service.ts` — a false positive here tells a candidate they are
 * ineligible for a job they could have taken, which is the expensive mistake.
 *
 * Both language blocks always run against every posting. There is no language
 * detection and no gating: a detector that guesses wrong would silently switch
 * the extractor off, and the patterns are specific enough that running both
 * costs nothing but a few failed matches.
 */

export const JOB_REQUIREMENT_FLAGS = {
  US_ONLY: "US_ONLY",
  CITIZENSHIP_REQUIRED: "CITIZENSHIP_REQUIRED",
  RESIDENCY_REQUIRED: "RESIDENCY_REQUIRED",
  NO_SPONSORSHIP: "NO_SPONSORSHIP",
  SPONSORSHIP_AVAILABLE: "SPONSORSHIP_AVAILABLE",
  WORK_AUTH_REQUIRED: "WORK_AUTH_REQUIRED",
  SECURITY_CLEARANCE: "SECURITY_CLEARANCE",
  LOCATION_RESTRICTED: "LOCATION_RESTRICTED",
  ONSITE_REQUIRED: "ONSITE_REQUIRED",
} as const

export type JobRequirementFlag =
  (typeof JOB_REQUIREMENT_FLAGS)[keyof typeof JOB_REQUIREMENT_FLAGS]

export interface JobRequirementInput {
  jobDescription?: string | null
  location?: string | null
}

/** "the United States", "the US", "the U.S.", "USA" — one shape for every pattern below. */
const US = String.raw`(?:the\s+)?(?:u\.?\s?s\.?a?\.?|united\s+states(?:\s+of\s+america)?)`

/**
 * Words after which a lowercase "us" is the pronoun, not the country: "come work
 * with us based in London", "contact us only via email". The text is lowercased
 * before matching, so case cannot do this job — a fixed-alternation lookbehind
 * can, and it costs nothing when it does not fire.
 */
const PRONOUN_US = String.raw`(?<!\b(?:with|join|joins|joining|joined|contact|email|reach|tell|ask|let|send|give|gives|help|helps|follow|about|of|between|like)\s)`

/**
 * Negations that must never let a SPONSORSHIP_AVAILABLE pattern fire. Checked as
 * a lookbehind-free prefix guard because "we are unable to offer visa
 * sponsorship" contains "visa sponsorship" verbatim.
 */
const SPONSORSHIP_NEGATION =
  /\b(?:no|not|cannot|can\s?not|can't|unable|won'?t|will\s+not|do\s+not|don'?t|does\s+not|doesn'?t|without|unwilling|nor|kein|keine|keinen|keinerlei|nicht|ohne|weder)\b/

/**
 * English patterns per flag, in declaration order — the output order is the
 * order of `JOB_REQUIREMENT_FLAGS`, so callers get a stable, diffable list.
 *
 * `location` is appended to the searched text only for the flags where a bare
 * location string is meaningful on its own (US_ONLY, ONSITE_REQUIRED); a
 * "United States" location field is not by itself a citizenship demand.
 */
const EN_PATTERNS: Record<JobRequirementFlag, RegExp[]> = {
  US_ONLY: [
    // Hyphenated is unambiguous — the pronoun "us" is never hyphenated to the
    // next word — so it needs no pronoun guard.
    new RegExp(String.raw`\b${US}-(?:only|based|resident)`),
    // Spaced. "based on" is excluded because "a fit for us based on your resume"
    // is prose, not a location restriction.
    new RegExp(`${PRONOUN_US}\\b${US}[\\s-]*(?:only|based(?!\\s+on)|resident)`),
    new RegExp(String.raw`\bbased\s+in\s+${US}\b`),
    new RegExp(String.raw`\b(?:must\s+(?:be\s+)?)?(?:reside|residing|live|living|located)\s+(?:in|within)\s+${US}\b`),
    // "within / anywhere in the US" bounds the role itself.
    new RegExp(String.raw`\b(?:within|anywhere\s+in)\s+${US}\b`),
    // "across the US" only counts with restriction context: "our teams across
    // the US serve customers" says nothing about who may apply.
    new RegExp(String.raw`\b(?:must|reside|residing|live|living|located|based|remote)\b[^.\n]{0,30}?\bacross\s+${US}\b`),
    new RegExp(String.raw`\b${US}\s+residents?\s+only\b`),
    new RegExp(String.raw`\bdomestic\s+${US}\s+candidates\s+only\b`),
  ],
  CITIZENSHIP_REQUIRED: [
    // "US citizenship is required", "must be a US citizen", "US citizens only"
    new RegExp(String.raw`\b${US}\s+citizen(?:ship)?s?\b[^.\n]{0,40}\b(?:required|require|is\s+a\s+must|mandatory)\b`),
    new RegExp(String.raw`\bmust\s+be\s+(?:an?\s+)?${US}\s+citizens?\b`),
    new RegExp(String.raw`\b(?:${US}\s+)?citizens?\s+only\b`),
    new RegExp(String.raw`\bcitizenship\s+(?:is\s+)?(?:required|mandatory)\b`),
    new RegExp(String.raw`\brequires?\s+${US}\s+citizenship\b`),
  ],
  RESIDENCY_REQUIRED: [
    /\bpermanent\s+residen(?:t|cy|ts)\b/,
    /\bgreen\s?card\s+holders?\b/,
    /\bgreen\s?card\b[^.\n]{0,30}\brequired\b/,
    /\blawful\s+permanent\s+residen/,
  ],
  NO_SPONSORSHIP: [
    /\bno\s+(?:visa\s+|h-?1b\s+|immigration\s+)?sponsorship\b/,
    /\bsponsorship\s+is\s+not\s+(?:available|offered|provided)\b/,
    /\b(?:unable|not\s+able)\s+to\s+(?:offer|provide|sponsor)\b[^.\n]{0,40}\bsponsor/,
    /\b(?:cannot|can\s?not|can't|will\s+not|won'?t|do\s+not|don'?t|does\s+not|doesn'?t)\s+(?:currently\s+|be\s+able\s+to\s+)?sponsor\b/,
    /\bwithout\s+(?:the\s+need\s+for\s+)?(?:visa\s+)?sponsorship\b/,
    /\bnot\s+(?:require|requiring|need|needing)\s+(?:visa\s+)?sponsorship\b/,
    /\bno\s+(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|offered|provided)\b/,
  ],
  SPONSORSHIP_AVAILABLE: [
    /\b(?:visa\s+|h-?1b\s+)?sponsorship\s+(?:is\s+)?(?:available|offered|provided)\b/,
    /\b(?:we|the\s+company)\s+(?:do|does|can|will)?\s*sponsor\b/,
    /\b(?:offer|offers|offering|provide|provides|providing)\s+(?:visa\s+)?sponsorship\b/,
    /\bopen\s+to\s+(?:visa\s+)?sponsorship\b/,
    /\bwilling\s+to\s+sponsor\b/,
  ],
  WORK_AUTH_REQUIRED: [
    /\bauthori[sz]ed\s+to\s+work\b/,
    /\bwork\s+authori[sz]ation\b/,
    /\bright\s+to\s+work\s+in\b/,
    /\blegally\s+(?:able|eligible)\s+to\s+work\b/,
    /\beligible\s+to\s+work\s+in\b/,
  ],
  SECURITY_CLEARANCE: [
    /\bsecurity\s+clearance\b/,
    /\bts\s*\/\s*sci\b/,
    /\b(?:top\s+secret|secret|public\s+trust)\s+clearance\b/,
    /\bclearance\s+(?:is\s+)?(?:required|mandatory)\b/,
    /\bactive\s+clearance\b/,
  ],
  LOCATION_RESTRICTED: [
    /\bmust\s+be\s+(?:located|based)\s+in\b/,
    /\bmust\s+(?:reside|live)\s+in\b/,
    /\bcandidates?\s+(?:located|based|residing)\s+in\b[^.\n]{0,40}\bonly\b/,
    /\bonly\s+(?:considering|accepting|reviewing)\s+(?:candidates|applicants)\b/,
    /\bapplicants?\s+must\s+be\s+(?:located|based)\b/,
  ],
  ONSITE_REQUIRED: [
    /\bon[\s-]?site\s+(?:is\s+)?(?:required|only|mandatory)\b/,
    /\bfully\s+on[\s-]?site\b/,
    /\bin[\s-]?(?:the[\s-]?)?office\s+\d+\s*(?:\+\s*)?days?\b/,
    /\b\d+\s*(?:\+\s*)?days?\s+(?:per\s+week\s+)?in[\s-]?(?:the[\s-]?)?office\b/,
    /\bno\s+remote\b/,
    /\bthis\s+(?:is\s+)?not\s+a\s+remote\s+(?:role|position|job)\b/,
    /\bremote\s+work\s+is\s+not\s+(?:available|offered|an\s+option)\b/,
  ],
}

/**
 * German patterns per flag, same posture and same shape as `EN_PATTERNS`.
 *
 * The text is lowercased but not transliterated, so umlauts and `ß` survive
 * into the haystack: every pattern that needs one spells both forms (`ß|ss`,
 * `ü|ue`, `ä|ae`), because feeds carry both. `\b` is ASCII-only in JavaScript,
 * so no pattern puts a word boundary next to an umlaut.
 *
 * Conservative in the same direction as the English block: a bare "vor Ort" or
 * a bare "Deutschland" is a workplace description, not a restriction, and must
 * not fire. US_ONLY and SECURITY_CLEARANCE have no German block — a German
 * posting restricting to the US states it in English, and German clearance
 * wording ("Sicherheitsüberprüfung") is out of scope here.
 */
const DE_PATTERNS: Record<JobRequirementFlag, RegExp[]> = {
  US_ONLY: [],
  CITIZENSHIP_REQUIRED: [
    /\bdeutsche[rns]?\s+staatsb(?:ü|ue)rgerschaft\b/,
    /\bdeutsche[rns]?\s+staatsangeh(?:ö|oe)rigkeit\b/,
    /\bstaatsb(?:ü|ue)rgerschaft\b[^.\n]{0,40}\b(?:erforderlich|vorausgesetzt|notwendig|zwingend)\b/,
    /\bstaatsangeh(?:ö|oe)rigkeit\b[^.\n]{0,40}\b(?:erforderlich|vorausgesetzt|notwendig|zwingend)\b/,
    // "EU-Bürger" alone is descriptive; only a restriction or a requirement counts.
    /\b(?:nur|ausschlie(?:ß|ss)lich)\s+(?:f(?:ü|ue)r\s+)?eu[\s-]?b(?:ü|ue)rger/,
    /\beu[\s-]?b(?:ü|ue)rgerschaft\b[^.\n]{0,40}\b(?:erforderlich|vorausgesetzt|notwendig)\b/,
  ],
  RESIDENCY_REQUIRED: [
    /\bniederlassungserlaubnis\b/,
    /\bdaueraufenthalt/,
    /\bunbefristete[rn]?\s+aufenthaltstitel\b/,
  ],
  NO_SPONSORSHIP: [
    /\bkein(?:e|en|erlei)?\s+(?:visa[\s-]?|visum[\s-]?)?sponsoring\b/,
    /\bkein(?:e|en|erlei)?\s+unterst(?:ü|ue)tzung\b[^.\n]{0,30}\b(?:visa|visum|arbeitserlaubnis)/,
    /\bohne\s+(?:visa[\s-]?|visum[\s-]?)?sponsoring\b/,
    /\b(?:visa|visum)[\s-]?sponsoring\b[^.\n]{0,40}\bnicht\s+(?:m(?:ö|oe)glich|angeboten|verf(?:ü|ue)gbar|vorgesehen)\b/,
    /\b(?:visa|visum|arbeitserlaubnis)\b[^.\n]{0,40}\bnicht\s+gesponsert\b/,
  ],
  SPONSORSHIP_AVAILABLE: [
    /\b(?:visa|visum)[\s-]?sponsoring\s+(?:ist\s+)?(?:m(?:ö|oe)glich|verf(?:ü|ue)gbar|vorhanden|gegeben)\b/,
    /\bwir\s+(?:bieten|unterst(?:ü|ue)tzen|(?:ü|ue)bernehmen)\b[^.\n]{0,40}\b(?:visa|visum)/,
    /\bunterst(?:ü|ue)tzung\s+(?:bei\s+(?:der|dem)\s+)?(?:visa|visum)/,
    /\bwir\s+sponsern\b/,
  ],
  WORK_AUTH_REQUIRED: [
    /\barbeitserlaubnis\b/,
    /\barbeitsgenehmigung\b/,
    /\baufenthaltserlaubnis\b/,
    /\baufenthaltstitel\b/,
    /\bberechtigung\b[^.\n]{0,20}\bzu\s+arbeiten\b/,
  ],
  SECURITY_CLEARANCE: [],
  LOCATION_RESTRICTED: [
    /\bwohnsitz\s+(?:in|im)\b/,
    /\bwohnhaft\s+(?:in|im)\b/,
    /\bans(?:ä|ae)ssig\s+(?:in|im)\b/,
    /\b(?:muss|musst|m(?:ü|ue)ssen)\s+(?:in|im)\b[^.\n]{0,30}\b(?:wohnen|leben|ans(?:ä|ae)ssig)\b/,
  ],
  ONSITE_REQUIRED: [
    // "teilweise vor Ort" and a bare "vor Ort" are deliberately not matched.
    /\b(?:ausschlie(?:ß|ss)lich|nur|vollst(?:ä|ae)ndig|durchgehend)\s+vor\s+ort\b/,
    /\b100\s*(?:%|prozent)\s+vor\s+ort\b/,
    /\bvor\s+ort\s+(?:ist\s+)?(?:erforderlich|pflicht|zwingend|vorausgesetzt)\b/,
    /\bpr(?:ä|ae)senzpflicht\b/,
    /\bkein(?:e|erlei)?\s+(?:home\s?office|homeoffice|remote(?:arbeit)?|mobiles\s+arbeiten)\b/,
    /\b(?:home\s?office|homeoffice|remote(?:arbeit)?)\b[^.\n]{0,20}\bnicht\s+(?:m(?:ö|oe)glich|vorgesehen|angeboten)\b/,
  ],
}

/**
 * The two language blocks merged per flag. Both always run — see the header.
 */
const DESCRIPTION_PATTERNS = Object.fromEntries(
  Object.values(JOB_REQUIREMENT_FLAGS).map((flag) => [
    flag,
    [...EN_PATTERNS[flag], ...DE_PATTERNS[flag]],
  ])
) as Record<JobRequirementFlag, RegExp[]>

/** Flags where the `location` field alone is a legitimate signal. */
const LOCATION_AWARE_FLAGS: JobRequirementFlag[] = [
  JOB_REQUIREMENT_FLAGS.US_ONLY,
  JOB_REQUIREMENT_FLAGS.ONSITE_REQUIRED,
]

/**
 * Extracts the eligibility requirements stated in a posting.
 *
 * Deterministic and order-stable: flags come back in the declaration order of
 * `JOB_REQUIREMENT_FLAGS`, deduped. Returns an empty array when nothing matches,
 * so callers can skip writing the column for the common unrestricted posting.
 */
export function extractJobRequirements(input: JobRequirementInput): JobRequirementFlag[] {
  const description = normalize(input.jobDescription)
  const location = normalize(input.location)
  if (!description && !location) return []

  const flags: JobRequirementFlag[] = []

  for (const flag of Object.values(JOB_REQUIREMENT_FLAGS)) {
    // Negated sponsorship wording contains the positive phrase verbatim
    // ("we are unable to offer visa sponsorship"), so the positive flag is
    // suppressed the moment the negative one fires.
    if (
      flag === JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE &&
      flags.includes(JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP)
    ) {
      continue
    }

    const haystack = LOCATION_AWARE_FLAGS.includes(flag)
      ? `${description}\n${location}`
      : description

    const matched = DESCRIPTION_PATTERNS[flag].some((re) => {
      const match = re.exec(haystack)
      if (!match) return false
      // Sentence-level negation guard: only the positive sponsorship flag needs
      // it, and only within the clause the match sits in.
      if (flag === JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE) {
        return !SPONSORSHIP_NEGATION.test(clauseAround(haystack, match.index))
      }
      return true
    })

    if (matched) flags.push(flag)
  }

  return flags
}

/** Lowercased, whitespace-collapsed text; empty string when there is nothing to scan. */
function normalize(value: string | null | undefined): string {
  if (!value) return ""
  return value.toLowerCase().replace(/[ \t]+/g, " ")
}

/**
 * The clause containing `index`, bounded by sentence punctuation and newlines.
 * Used so "we sponsor visas" in one sentence is not cancelled by a "no" three
 * paragraphs away.
 */
function clauseAround(text: string, index: number): string {
  const start = Math.max(
    text.lastIndexOf(".", index),
    text.lastIndexOf("\n", index),
    text.lastIndexOf(";", index),
    -1
  )
  const endCandidates = [
    text.indexOf(".", index),
    text.indexOf("\n", index),
    text.indexOf(";", index),
  ].filter((i) => i !== -1)
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : text.length
  return text.slice(start + 1, end)
}
