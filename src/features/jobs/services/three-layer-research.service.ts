import {
  analyzeCompanyResearchAI,
  extractDeterministicCompanyResearch,
  type CompanyResearchResult,
  type ResearchCitation,
} from "./company-research.service"
import {
  extractJobRequirements,
  type JobRequirementFlag,
} from "./job-requirements.service"

/**
 * Three-layer job research: what the role requires, what the company is, and
 * what its public material says about culture and how it works.
 *
 * The layers are intentionally separate because they have different evidence
 * standards:
 *
 * - Requirements are read from the posting itself, deterministically. Nothing
 *   is inferred from the candidate or the company.
 * - Company facts come from the existing company-research service, which only
 *   keeps values found verbatim in a fetched source and never treats the
 *   posting location as a headquarters.
 * - Culture is a claim about how a company works, so it is only VERIFIED when
 *   an independently fetched company page contains the phrase; a posting-only
 *   statement is STATED_IN_POSTING, and silence is UNKNOWN.
 *
 * Missing data never throws and never becomes a positive claim: the result is
 * returned with explicit uncertainty, and confidence falls to LOW when no
 * independent source backed the culture layer.
 */

export interface RequirementLayer {
  required: string[]
  preferred: string[]
  flags: JobRequirementFlag[]
  uncertainty: string[]
}

export interface CultureSignal {
  label: string
  value: string | null
  state: "VERIFIED" | "STATED_IN_POSTING" | "UNKNOWN"
  citations: ResearchCitation[]
}

export interface CultureLayer {
  signals: CultureSignal[]
  confidence: "HIGH" | "MEDIUM" | "LOW"
  explanation: string
  conflicts: string[]
}

export interface ThreeLayerResearch {
  requirements: RequirementLayer
  company: CompanyResearchResult
  culture: CultureLayer
  sourceSummary: { totalSources: number; independentSources: number; hosts: string[] }
  researchedAt: string
  cached: boolean
}

const MAX_REQUIREMENT_ITEMS = 12
const MAX_REQUIREMENT_LENGTH = 200
const CACHE_TTL_MS = 30 * 60 * 1000
const MAX_CACHE_ENTRIES = 100

interface CacheEntry {
  expiresAt: number
  result: ThreeLayerResearch
}

const cache = new Map<string, CacheEntry>()

/** Test and settings hook: drop every cached research result. */
export function clearThreeLayerResearchCache(): void {
  cache.clear()
}

const REQUIRED_HEADING =
  /^(?:requirements?|qualifications?|must[-\s]?haves?|what you(?:'|’)?ll need|who you are|basic qualifications|required)\s*:?\s*$/i
const PREFERRED_HEADING =
  /^(?:nice[-\s]?to[-\s]?haves?|preferred(?: qualifications)?|bonus(?: points)?|plus(?:es)?|desirable|good to have)\s*:?\s*$/i
const INLINE_REQUIRED =
  /^(?:requirements?|qualifications?|must[-\s]?haves?)\s*:\s*(.+)$/i
const INLINE_PREFERRED =
  /^(?:nice[-\s]?to[-\s]?haves?|preferred(?: qualifications)?|bonus(?: points)?)\s*:\s*(.+)$/i

function cleanBullet(line: string): string {
  return line
    .replace(/^[-*•·–—]\s*/, "")
    .replace(/^\d{1,2}[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,]$/, "")
}

function pushUnique(target: string[], value: string): void {
  if (target.length >= MAX_REQUIREMENT_ITEMS) return
  if (value.length < 3 || value.length > MAX_REQUIREMENT_LENGTH) return
  const key = value.toLowerCase()
  if (target.some((entry) => entry.toLowerCase() === key)) return
  target.push(value)
}

/** Must-have and nice-to-have lines, without inventing a list that is not there. */
function extractRequirementLists(description: string | null | undefined): {
  required: string[]
  preferred: string[]
  uncertainty: string[]
} {
  const required: string[] = []
  const preferred: string[] = []
  const text = description ?? ""
  if (!text.trim()) {
    return {
      required,
      preferred,
      uncertainty: [
        "The posting has no description, so its requirements and culture are unknown.",
      ],
    }
  }

  let mode: "REQUIRED" | "PREFERRED" | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    if (REQUIRED_HEADING.test(line)) {
      mode = "REQUIRED"
      continue
    }
    if (PREFERRED_HEADING.test(line)) {
      mode = "PREFERRED"
      continue
    }

    const inlineRequired = line.match(INLINE_REQUIRED)
    if (inlineRequired?.[1]) {
      mode = "REQUIRED"
      pushUnique(required, cleanBullet(inlineRequired[1]))
      continue
    }
    const inlinePreferred = line.match(INLINE_PREFERRED)
    if (inlinePreferred?.[1]) {
      mode = "PREFERRED"
      pushUnique(preferred, cleanBullet(inlinePreferred[1]))
      continue
    }

    if (!mode) continue
    const item = cleanBullet(line)
    if (item.length === 0) continue
    // A sentence of prose after a list is not another requirement. Bullets are
    // always kept; an unbulleted line only counts when it does not end a sentence.
    const isBullet = /^[-*•·–—]\s*/.test(line) || /^\d{1,2}[.)]\s*/.test(line)
    if (!isBullet && /[.!?]\s*$/.test(line)) continue
    pushUnique(mode === "REQUIRED" ? required : preferred, item)
  }

  const uncertainty: string[] = []
  if (required.length === 0) {
    uncertainty.push("The posting does not state a separate must-have list.")
  }
  if (preferred.length === 0) {
    uncertainty.push("The posting does not state preferred or bonus qualifications.")
  }
  return { required, preferred, uncertainty }
}

interface CultureCandidate {
  value: string
  pattern: RegExp
  /** Phrases a company page must contain verbatim before the state is VERIFIED. */
  phrases: string[]
}

interface CultureDefinition {
  label: string
  candidates: CultureCandidate[]
  /** When true, two different values in one posting are a conflict. */
  exclusive?: boolean
}

const CULTURE_DEFINITIONS: CultureDefinition[] = [
  {
    label: "Remote policy",
    exclusive: true,
    candidates: [
      {
        value: "Fully remote",
        pattern: /\b(?:fully|100\s*%)\s+remote\b|\bremote[-\s]?first\b|\bwork\s+from\s+anywhere\b/i,
        phrases: ["fully remote", "100% remote", "remote-first", "work from anywhere"],
      },
      {
        value: "Hybrid",
        pattern: /\bhybrid\b|\b\d+\s*days?\s+(?:per\s+week\s+)?(?:in|at)\s+(?:the\s+)?office\b/i,
        phrases: ["hybrid"],
      },
      {
        value: "On-site",
        pattern: /\bon[-\s]?site\b|\bin[-\s]?office\b|\boffice[-\s]based\b/i,
        phrases: ["on-site", "onsite", "in-office", "office-based"],
      },
    ],
  },
  {
    label: "Async work",
    candidates: [
      {
        value: "Async-first",
        pattern: /\basync(?:hronous)?[-\s]?(?:first|by default)?\b/i,
        phrases: ["async-first", "async first", "asynchronous"],
      },
    ],
  },
  {
    label: "Schedule flexibility",
    candidates: [
      {
        value: "Flexible hours",
        pattern: /\bflexible\s+(?:hours|schedule|working hours)\b|\bflexitime\b/i,
        phrases: ["flexible hours", "flexible schedule", "flexitime"],
      },
    ],
  },
  {
    label: "Work week",
    candidates: [
      {
        value: "Four-day week",
        pattern: /\b(?:four|4)[-\s]day\s+work\s?week\b|\bcompressed\s+work\s?week\b/i,
        phrases: ["four-day week", "4-day week", "compressed work week"],
      },
    ],
  },
  {
    label: "Stated values",
    candidates: [
      {
        value: "Work-life balance",
        pattern: /\bwork[-\s]?life\s+balance\b/i,
        phrases: ["work-life balance", "work life balance"],
      },
      {
        value: "Learning budget",
        pattern: /\blearning\s+(?:budget|stipend|allowance)\b|\bprofessional\s+development\s+budget\b/i,
        phrases: ["learning budget", "learning stipend", "professional development budget"],
      },
      {
        value: "Transparent pay",
        pattern: /\b(?:transparent|published|public)\s+(?:pay|salary)\b|\bsalary\s+transparency\b/i,
        phrases: ["transparent pay", "salary transparency", "published salary"],
      },
    ],
  },
]

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function postingCitation(
  companyName: string,
  url: string | null | undefined
): ResearchCitation[] {
  if (!url) return []
  return [
    {
      title: `${companyName} posting`,
      url,
      sourceType: "POSTING",
    },
  ]
}

/** A verified independent company citation that quotes the phrase, if one exists. */
function independentQuote(
  citations: readonly ResearchCitation[],
  phrases: readonly string[],
  postingHost: string | null
): ResearchCitation | null {
  for (const citation of citations) {
    if (citation.sourceType !== "COMPANY" || citation.verified !== true) continue
    const host = hostOf(citation.url)
    if (!host || host === postingHost) continue
    const quote = normalize(citation.quote ?? "")
    if (!quote) continue
    if (phrases.some((phrase) => quote.includes(normalize(phrase)))) return citation
  }
  return null
}

function buildCultureLayer(input: {
  companyName: string
  description: string | null | undefined
  url: string | null | undefined
  citations: readonly ResearchCitation[]
  failure: string | null
}): { culture: CultureLayer; sourceSummary: ThreeLayerResearch["sourceSummary"] } {
  const description = input.description ?? ""
  const postingHost = hostOf(input.url)
  const hosts = [
    ...new Set(
      input.citations
        .map((citation) => hostOf(citation.url))
        .filter((host): host is string => Boolean(host))
    ),
  ]
  const independentHosts = hosts.filter((host) => host !== postingHost)
  const confidence: CultureLayer["confidence"] =
    independentHosts.length >= 2 ? "HIGH" : independentHosts.length === 1 ? "MEDIUM" : "LOW"

  const signals: CultureSignal[] = []
  const conflicts: string[] = []

  for (const definition of CULTURE_DEFINITIONS) {
    const matched = definition.candidates.filter((candidate) =>
      description ? candidate.pattern.test(description) : false
    )

    if (definition.exclusive && matched.length > 1) {
      conflicts.push(
        `The posting states conflicting ${definition.label.toLowerCase()} values (${matched
          .map((candidate) => candidate.value)
          .join(" and ")}); neither is treated as fact.`
      )
      signals.push({
        label: definition.label,
        value: null,
        state: "UNKNOWN",
        citations: [],
      })
      continue
    }

    const candidate = matched[0]
    if (!candidate) {
      // The posting said nothing; an independent company page may still settle it.
      const verified = definition.candidates
        .map((entry) => ({
          entry,
          citation: independentQuote(input.citations, entry.phrases, postingHost),
        }))
        .find((result) => result.citation)
      signals.push(
        verified
          ? {
              label: definition.label,
              value: verified.entry.value,
              state: "VERIFIED",
              citations: [verified.citation!],
            }
          : { label: definition.label, value: null, state: "UNKNOWN", citations: [] }
      )
      continue
    }

    const independent = independentQuote(input.citations, candidate.phrases, postingHost)
    signals.push(
      independent
        ? {
            label: definition.label,
            value: candidate.value,
            state: "VERIFIED",
            citations: [independent],
          }
        : {
            label: definition.label,
            value: candidate.value,
            state: "STATED_IN_POSTING",
            citations: postingCitation(input.companyName, input.url),
          }
    )
  }

  const parts = [
    independentHosts.length > 0
      ? `${independentHosts.length} independent company source${independentHosts.length === 1 ? "" : "s"} verified part of the culture layer.`
      : "No independent company source could be fetched; culture claims are limited to the posting.",
    "Values absent from both are UNKNOWN, not assumed.",
  ]
  if (input.failure) {
    parts.push(`Company research was unavailable (${input.failure}); the company layer is limited.`)
  }

  return {
    culture: {
      signals,
      confidence,
      explanation: parts.join(" "),
      conflicts,
    },
    sourceSummary: {
      totalSources: input.citations.length,
      independentSources: independentHosts.length,
      hosts,
    },
  }
}

function cacheKey(input: {
  companyName: string
  jobTitle: string
  url?: string | null
  useAi?: boolean
}): string {
  return [
    input.companyName.trim().toLowerCase(),
    input.jobTitle.trim().toLowerCase(),
    input.url ?? "",
    input.useAi === false ? "deterministic" : "ai",
  ].join("|")
}

/**
 * Runs all three layers, caching by company/role/url for 30 minutes. A missing
 * description or a failed company lookup degrades to the layers that could be
 * built instead of throwing.
 */
export async function researchJob(input: {
  userId: string
  companyName: string
  jobTitle: string
  url?: string | null
  location?: string | null
  description?: string | null
  useAi?: boolean
  now?: Date
}): Promise<ThreeLayerResearch> {
  const now = input.now ?? new Date()
  const key = cacheKey(input)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now.getTime()) {
    return { ...cached.result, cached: true }
  }
  if (cached) cache.delete(key)

  const requirementsList = extractRequirementLists(input.description)
  const flags = extractJobRequirements({
    jobDescription: input.description,
    location: input.location,
  })

  let company: CompanyResearchResult
  let failure: string | null = null
  try {
    company =
      input.useAi === false
        ? extractDeterministicCompanyResearch({
            companyName: input.companyName,
            jobTitle: input.jobTitle,
            url: input.url,
            location: input.location,
            description: input.description,
          })
        : await analyzeCompanyResearchAI({
            userId: input.userId,
            companyName: input.companyName,
            jobTitle: input.jobTitle,
            url: input.url,
            location: input.location,
            description: input.description,
          })
  } catch (error) {
    failure = error instanceof Error ? error.message : "company lookup failed"
    company = extractDeterministicCompanyResearch({
      companyName: input.companyName,
      jobTitle: input.jobTitle,
      url: input.url,
      location: input.location,
      description: input.description,
    })
  }

  const { culture, sourceSummary } = buildCultureLayer({
    companyName: input.companyName,
    description: input.description,
    url: input.url,
    citations: company.citations,
    failure,
  })

  const result: ThreeLayerResearch = {
    requirements: {
      required: requirementsList.required,
      preferred: requirementsList.preferred,
      flags,
      uncertainty: [
        ...requirementsList.uncertainty,
        ...(failure
          ? ["Company research failed, so company facts and independent culture verification are unavailable."]
          : []),
      ],
    },
    company,
    culture,
    sourceSummary,
    researchedAt: now.toISOString(),
    cached: false,
  }

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, {
    expiresAt: now.getTime() + CACHE_TTL_MS,
    result,
  })

  return result
}
