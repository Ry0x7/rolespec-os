import { z } from "zod"
import { AI_USAGE_FEATURES, generateObjectTracked } from "@/shared/lib/ai-generate"
import { AI_STAGES } from "@/shared/lib/ai-stages"
import { fenceUntrusted, UNTRUSTED_CONTENT_RULES } from "@/shared/lib/prompts/untrusted"
import {
  assertPublicUrl,
  fetchPublicUrl,
} from "@/features/career-profile/services/web-presence.service"
import { firecrawlScrape, isFirecrawlConfigured } from "@/features/discovery/services/firecrawl.client"
import { isVerifiedCompanyResearch } from "../lib/company-research"

export { isVerifiedCompanyResearch }

export interface ResearchCitation {
  title: string
  url: string
  quote?: string
  /** True only after this exact URL was fetched successfully. */
  verified?: boolean
  /** ISO timestamp of the successful fetch. */
  fetchedAt?: string
  /** The posting itself, or an independent company source. */
  sourceType?: "POSTING" | "COMPANY"
}

export interface CompanyResearchResult {
  companyName: string
  industry: string | null
  headquarters: string | null
  companySize: string | null
  overview: string
  keyProducts: string[]
  statedMissionOrValues: string[]
  techStack: string[]
  interviewTips: string[]
  citations: ResearchCitation[]
  confidence: "HIGH" | "MEDIUM" | "LOW"
  confidenceExplanation: string
  researchedAt: string
  /** 2 means every stored citation was fetched before the result was saved. */
  validationVersion?: 2
}

export const companyResearchSchema = z.object({
  companyName: z.string(),
  industry: z.string().nullable(),
  headquarters: z.string().nullable(),
  companySize: z.string().nullable(),
  overview: z.string().min(1),
  keyProducts: z.array(z.string()),
  statedMissionOrValues: z.array(z.string()),
  techStack: z.array(z.string()),
  interviewTips: z.array(z.string()),
  citations: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      quote: z.string().optional(),
    })
  ),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  confidenceExplanation: z.string(),
})

const SYSTEM_PROMPT = `You are a meticulous corporate intelligence researcher assisting a job candidate. You synthesize factual company and role research strictly from verified evidence.

CRITICAL RULES:
- NEVER invent, hallucinate, or assume company details, metrics, revenue, products, or values.
- If information (such as headquarters, size, or funding) is not stated in a source you can cite, explicitly write null. Do not infer headquarters from the job location.
- Citations must be real, public URLs you saw in the provided material. Never invent a URL. Only include a quote when it is copied verbatim from that page.
- Confidence will be recalculated after sources are fetched. Do not inflate it.
- techStack: only tools, frameworks, languages explicitly requested in the posting.
- interviewTips: 2-4 factual, concrete pointers based directly on the company's stated requirements and culture.

${UNTRUSTED_CONTENT_RULES}

OUTPUT: Return ONLY valid JSON matching the schema.`

const MAX_CITATIONS = 4
const MAX_CITATION_QUOTE = 300
const MAX_SOURCE_TEXT = 200_000
const MAX_OVERVIEW_LENGTH = 600
const MAX_LIST_ITEMS = 8
const MAX_TECH_ITEMS = 20


function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""
    })
}

/** Turns a fetched HTML page into the text facts are checked against. */
export function htmlToReadableText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|h[1-6]|li|tr|td|th)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Firecrawl returns markdown; turn it into text the grounding checks can read. */
export function markdownToReadableText(markdown: string): string {
  return decodeEntities(
    markdown
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*[-*+][ \t]+/gm, "")
      .replace(/[*_~`>]/g, " ")
  )
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function pageTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return null
  const title = normalize(decodeEntities(match[1]))
  return title ? title.slice(0, 160) : null
}

function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function hostnameOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

/**
 * Job boards, aggregators and social profiles are useful links, but they are
 * not an independent company source. A HIGH-confidence research result needs a
 * source that is not the posting's own host and is not one of these tenants.
 */
const NON_COMPANY_SOURCE_HOSTS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
  "crunchbase.com",
  "wikipedia.org",
  "bloomberg.com",
  "forbes.com",
  "facebook.com",
  "x.com",
  "twitter.com",
]

function isIndependentCompanySource(url: string, postingUrl: string | null | undefined): boolean {
  const host = hostnameOf(url)
  const postingHost = postingUrl ? hostnameOf(postingUrl) : null
  if (!host) return false
  if (postingHost && (host === postingHost || host.endsWith(`.${postingHost}`) || postingHost.endsWith(`.${host}`))) {
    return false
  }
  return !NON_COMPANY_SOURCE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))
}

function mentions(value: string, corpus: string): boolean {
  const needle = normalize(value)
  return needle.length > 0 && corpus.includes(needle)
}

function isNumberBacked(value: string, corpus: string): boolean {
  const numbers = value.match(/\d[\d,.%+/-]*/g) ?? []
  return numbers.every((number) => corpus.includes(normalize(number)))
}

function filterGrounded(values: readonly string[] | null | undefined, corpus: string): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const raw of values ?? []) {
    const value = raw.trim()
    const key = normalize(value)
    if (!value || seen.has(key) || !mentions(value, corpus)) continue
    seen.add(key)
    kept.push(value)
    if (kept.length >= MAX_LIST_ITEMS) break
  }
  return kept
}

function normalizeTech(value: string): string {
  return value.replace(/\\\+/g, "+").replace(/\\\./g, ".")
}

function extractTechFromText(text: string): string[] {
  const commonTech = [
    "TypeScript", "JavaScript", "Python", "Go", "Rust", "Java", "C\\+\\+", "C#",
    "React", "Next\\.js", "Vue", "Angular", "Node\\.js", "PostgreSQL", "SQL",
    "MongoDB", "Redis", "Docker", "Kubernetes", "AWS", "Azure", "GCP", "GraphQL",
    "Tailwind", "REST", "Git", "Linux",
  ]
  const found: string[] = []
  for (const tech of commonTech) {
    const rx = new RegExp(`\\b${tech}\\b`, "i")
    if (rx.test(text)) found.push(normalizeTech(tech))
  }
  return found
}

function filterTech(values: readonly string[] | null | undefined, corpus: string): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const raw of values ?? []) {
    const value = raw.trim()
    const key = normalize(value)
    if (!value || seen.has(key)) continue
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (!new RegExp(`(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`, "i").test(corpus)) continue
    seen.add(key)
    kept.push(value)
    if (kept.length >= MAX_TECH_ITEMS) break
  }
  return kept
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = normalize(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function deterministicOverview(input: {
  companyName: string
  jobTitle: string
  location?: string | null
}): string {
  const location = input.location ? ` The posting lists the role in ${input.location}.` : ""
  return `${input.companyName} is hiring for a ${input.jobTitle}.${location} Only statements present in the posting are shown; company facts are marked as not disclosed unless a fetched source verifies them.`
}

interface VerifiedSource {
  citation: ResearchCitation
  text: string
  html: string
}

interface CandidateCitation {
  title: string
  url: string
  quote?: string
  sourceType: "POSTING" | "COMPANY"
}

async function fetchVerifiableSources(input: {
  companyName: string
  url?: string | null
  aiCitations: readonly { title: string; url: string; quote?: string }[]
  signal?: AbortSignal
}): Promise<VerifiedSource[]> {
  const candidates: CandidateCitation[] = []
  const seen = new Set<string>()

  function add(candidate: CandidateCitation): void {
    const canonical = canonicalUrl(candidate.url)
    if (!canonical || seen.has(canonical.replace(/\/$/, ""))) return
    seen.add(canonical.replace(/\/$/, ""))
    candidates.push({ ...candidate, url: canonical })
  }

  if (input.url) {
    add({
      title: `${input.companyName} posting`,
      url: input.url,
      sourceType: "POSTING",
    })
  }
  for (const citation of input.aiCitations) {
    add({
      title: citation.title,
      url: citation.url,
      quote: citation.quote,
      sourceType: isIndependentCompanySource(citation.url, input.url) ? "COMPANY" : "POSTING",
    })
  }

  const selected = candidates.slice(0, MAX_CITATIONS)
  const results = await Promise.allSettled(
    selected.map(async (candidate) => {
      let body: string
      let resolvedUrl = candidate.url
      let bodyIsMarkdown = false

      try {
        const response = await fetchPublicUrl(candidate.url, {
          headers: { accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8" },
          accept: (contentType) =>
            contentType.includes("text/html") ||
            contentType.includes("application/xhtml") ||
            contentType.includes("text/plain") ||
            contentType.includes("application/json"),
          ...(input.signal ? { signal: input.signal } : {}),
        })
        body = response.body
        resolvedUrl = response.url || candidate.url
      } catch (error) {
        if (input.signal?.aborted) throw error
        // A page that blocks our server (Cloudflare, JS-only shells, 403s) may
        // still be readable through Firecrawl. Validate the target first so a
        // private address is never handed to a third-party fetcher.
        if (!(await isFirecrawlConfigured())) throw error
        await assertPublicUrl(candidate.url)
        const scraped = await firecrawlScrape(candidate.url, input.signal, "markdown")
        if (!scraped) throw error
        body = scraped
        bodyIsMarkdown = true
      }

      const html = bodyIsMarkdown ? "" : body
      const text = (bodyIsMarkdown
        ? markdownToReadableText(body)
        : htmlToReadableText(body)
      ).slice(0, MAX_SOURCE_TEXT)
      const corpus = normalize(text)
      const companyMentioned = mentions(input.companyName, corpus)
      if (candidate.sourceType === "COMPANY" && !companyMentioned) {
        throw new Error("Source does not mention the company")
      }

      const quote = candidate.quote?.trim()
      const normalizedQuote = quote ? normalize(quote) : ""
      const verifiedQuote =
        normalizedQuote.length > 0 && corpus.includes(normalizedQuote)
          ? quote!.slice(0, MAX_CITATION_QUOTE)
          : undefined

      const title =
        (candidate.title?.trim() || pageTitle(html) || new URL(candidate.url).hostname).slice(0, 200)

      const citation: ResearchCitation = {
        title,
        url: resolvedUrl,
        ...(verifiedQuote ? { quote: verifiedQuote } : {}),
        verified: true,
        fetchedAt: new Date().toISOString(),
        sourceType: candidate.sourceType,
      }
      return { citation, text, html } satisfies VerifiedSource
    })
  )

  return results
    .filter((result): result is PromiseFulfilledResult<VerifiedSource> => result.status === "fulfilled")
    .map((result) => result.value)
}

function companyFacts(
  object: z.infer<typeof companyResearchSchema> | null,
  companyCorpus: string
): {
  headquarters: string | null
  industry: string | null
  companySize: string | null
  keyProducts: string[]
  statedMissionOrValues: string[]
} {
  if (!object) {
    return {
      headquarters: null,
      industry: null,
      companySize: null,
      keyProducts: [],
      statedMissionOrValues: [],
    }
  }
  return {
    // A value only survives when its exact normalized phrase occurs in fetched
    // company text. The posting location is never used as a proxy for HQ.
    headquarters:
      object.headquarters && mentions(object.headquarters, companyCorpus)
        ? object.headquarters.trim()
        : null,
    industry:
      object.industry && mentions(object.industry, companyCorpus)
        ? object.industry.trim()
        : null,
    companySize:
      object.companySize && mentions(object.companySize, companyCorpus)
        ? object.companySize.trim()
        : null,
    keyProducts: filterGrounded(object.keyProducts, companyCorpus),
    statedMissionOrValues: filterGrounded(object.statedMissionOrValues, companyCorpus),
  }
}

export function extractDeterministicCompanyResearch(input: {
  companyName: string
  jobTitle: string
  url?: string | null
  location?: string | null
  description?: string | null
  verifiedCitations?: ResearchCitation[]
}): CompanyResearchResult {
  const { companyName, jobTitle, description, verifiedCitations = [] } = input
  const desc = description ?? ""
  const citations = verifiedCitations.filter((citation) => citation.verified === true)
  const techStack = dedupe(extractTechFromText(`${jobTitle} ${desc}`)).slice(0, MAX_TECH_ITEMS)

  return {
    companyName,
    // No verified source exists in this path, so company facts stay unknown.
    industry: null,
    headquarters: null,
    companySize: null,
    overview: deterministicOverview(input),
    keyProducts: [],
    statedMissionOrValues: [],
    techStack,
    interviewTips: [
      `Review the posting's required qualifications for ${jobTitle} carefully.`,
      techStack.length > 0
        ? `Be ready to discuss hands-on work with ${techStack.slice(0, 3).join(", ")}.`
        : "Be ready to give concrete examples that match the posting's stated requirements.",
    ],
    citations,
    confidence: citations.length > 0 ? "MEDIUM" : "LOW",
    confidenceExplanation:
      citations.length > 0
        ? `Fetched and verified ${citations.length} source${citations.length === 1 ? "" : "s"}. Company facts are not shown because no fetched source grounded them.`
        : "No source could be fetched and verified; research is limited to the posting text provided by the user.",
    researchedAt: new Date().toISOString(),
    validationVersion: 2,
  }
}

export async function analyzeCompanyResearchAI(input: {
  userId: string
  companyName: string
  jobTitle: string
  url?: string | null
  location?: string | null
  description?: string | null
  signal?: AbortSignal
}): Promise<CompanyResearchResult> {
  const { userId, companyName, jobTitle, url, location, description, signal } = input

  const prompt = [
    `Company: ${companyName}`,
    `Role: ${jobTitle}`,
    location ? `Posting location (NOT company headquarters): ${location}` : null,
    url ? `Posting URL: ${url}` : null,
    description ? `Job Posting Content:\n${fenceUntrusted("JOB_DESCRIPTION", description.slice(0, 5000))}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")

  let object: z.infer<typeof companyResearchSchema> | null = null
  try {
    const generated = await generateObjectTracked({
      schema: companyResearchSchema,
      system: SYSTEM_PROMPT,
      prompt,
      tracking: {
        feature: AI_USAGE_FEATURES.JOB_MATCH,
        stage: AI_STAGES.RESEARCH,
        surface: "app",
        userId,
      },
      ...(signal ? { abortSignal: signal } : {}),
    })
    object = generated.object
  } catch (error) {
    // A cancelled step must stop here; swallowing the abort would let the
    // deterministic fallback and source fetches continue after the deadline.
    if (signal?.aborted) throw error
    // The deterministic path still fetches and verifies the posting URL.
    object = null
  }

  signal?.throwIfAborted()
  const sources = await fetchVerifiableSources({
    companyName,
    url,
    aiCitations: object?.citations ?? [],
    ...(signal ? { signal } : {}),
  })
  signal?.throwIfAborted()

  if (!object) {
    return extractDeterministicCompanyResearch({
      ...input,
      verifiedCitations: sources.map((source) => source.citation),
    })
  }

  const companySources = sources.filter(
    (source) => source.citation.sourceType === "COMPANY"
  )
  // Only fetched *company* page text may ground a company fact. The posting
  // and the raw posting location are deliberately excluded: a job in San
  // Francisco is not evidence that the company is headquartered there, even
  // when the posting page repeats the city.
  const companyCorpus = normalize(companySources.map((source) => source.text).join("\n"))
  const allCorpus = normalize(
    `${description ?? ""}\n${sources.map((source) => source.text).join("\n")}`
  )

  const facts = companyFacts(object, companyCorpus)
  const groundedTech = dedupe([
    ...filterTech(object.techStack, allCorpus),
    ...extractTechFromText(`${jobTitle} ${description ?? ""}`),
  ]).slice(0, MAX_TECH_ITEMS)

  const hasGroundedCompanyFact = Boolean(
    facts.headquarters ||
      facts.industry ||
      facts.companySize ||
      facts.keyProducts.length > 0 ||
      facts.statedMissionOrValues.length > 0
  )
  const confidence: CompanyResearchResult["confidence"] =
    companySources.length > 0 && hasGroundedCompanyFact
      ? "HIGH"
      : sources.length > 0
        ? "MEDIUM"
        : "LOW"

  const overviewCandidate = object.overview.trim().slice(0, MAX_OVERVIEW_LENGTH)
  const overviewIsGrounded =
    sources.length > 0 &&
    overviewCandidate.length > 0 &&
    isNumberBacked(overviewCandidate, allCorpus) &&
    (!/headquarters|headquartered|based in/i.test(overviewCandidate) ||
      Boolean(facts.headquarters))

  return {
    companyName,
    ...facts,
    overview: overviewIsGrounded ? overviewCandidate : deterministicOverview(input),
    techStack: groundedTech,
    interviewTips: (object.interviewTips ?? [])
      .map((tip) => tip.trim())
      .filter((tip) => tip.length > 0 && isNumberBacked(tip, allCorpus))
      .slice(0, 4),
    citations: sources.map((source) => source.citation),
    confidence,
    confidenceExplanation:
      confidence === "HIGH"
        ? `Verified ${companySources.length} independent company source${companySources.length === 1 ? "" : "s"} and grounded the company facts shown here.`
        : confidence === "MEDIUM"
          ? "Only the posting URL could be fetched and verified; no independent company source backed these facts."
          : "No citation could be fetched and verified. Unknown company facts are shown as not disclosed.",
    researchedAt: new Date().toISOString(),
    validationVersion: 2,
  }
}
