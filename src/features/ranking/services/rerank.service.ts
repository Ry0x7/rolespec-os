import { z } from "zod"

import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import { AI_STAGES } from "@/shared/lib/ai-stages"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"
import type { RankedEntry, RankingPosting } from "../types"

/**
 * Optional LLM rerank of the deterministic shortlist.
 *
 * The model may only reorder the top N entries and explain itself with a quote
 * from the posting. It cannot add a posting, remove one, change a factor state
 * or raise a score. Anything ungrounded is discarded, and a provider failure
 * returns the deterministic order untouched — ranking must never depend on an
 * AI call succeeding.
 */

const DEFAULT_TOP_N = 20
const MAX_TOP_N = 40
const DESCRIPTION_LIMIT = 1200
const MAX_REASON_LENGTH = 300

const rerankSchema = z.object({
  rankings: z
    .array(
      z.object({
        postingId: z.string().min(1),
        verdict: z.enum(["FIT", "PARTIAL", "MISMATCH"]),
        confidence: z.number().int().min(0).max(100),
        reason: z.string().min(1).max(MAX_REASON_LENGTH),
        evidenceQuote: z.string().max(MAX_REASON_LENGTH).optional(),
      })
    )
    .max(MAX_TOP_N),
})

type RerankVerdict = z.infer<typeof rerankSchema>["rankings"][number]["verdict"]

const VERDICT_RANK: Record<RerankVerdict, number> = {
  FIT: 0,
  PARTIAL: 1,
  MISMATCH: 2,
}

const SYSTEM_PROMPT = `You reorder a shortlist of job postings for one candidate.

TASK:
- For each posting, decide FIT, PARTIAL or MISMATCH against the candidate's stated roles and confirmed skills.
- Use only the posting text. Never assume a skill, a seniority, a salary or an eligibility the text does not state.
- Cite a short verbatim evidenceQuote from the posting for every judgement. Without a quote, the judgement is discarded.
- confidence is 0-100 for how strongly the posting text supports your verdict.
- Do not invent postings and do not omit any posting you were given.

RULES:
- A posting that does not mention the candidate's skills is MISMATCH, not an unknown.
- A posting that states eligibility you cannot satisfy is MISMATCH.
- Return one judgement per posting id. Reasons are one short user-facing sentence.

${UNTRUSTED_CONTENT_RULES}

OUTPUT: Return ONLY valid JSON matching the schema.`

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function groundedQuote(posting: RankingPosting, quote: string | undefined): boolean {
  if (!quote) return false
  const haystack = normalize(`${posting.title} ${posting.companyName} ${posting.description ?? ""}`)
  const needle = normalize(quote)
  return needle.length > 0 && haystack.includes(needle)
}

function shortlistPrompt(
  entries: readonly RankedEntry[],
  postings: ReadonlyMap<string, RankingPosting>
): string {
  const blocks = entries.map((entry) => {
    const posting = postings.get(entry.postingId)
    const title = posting?.title ?? "Untitled role"
    const company = posting?.companyName ?? "Unknown company"
    const description = (posting?.description ?? "").slice(0, DESCRIPTION_LIMIT)
    return [
      `Posting id: ${entry.postingId}`,
      `Title: ${title}`,
      `Company: ${company}`,
      fenceUntrusted("JOB_POSTING", description || "No description was captured."),
    ].join("\n")
  })
  return [
    "Candidate shortlist, deterministic order:",
    ...blocks,
    `Return one judgement for each of these ids: ${entries
      .map((entry) => entry.postingId)
      .join(", ")}.`,
  ].join("\n\n")
}

function failureMessage(error: unknown): string {
  if (error instanceof AiKeyRequiredError) return error.message
  if (error instanceof AiDailyLimitError) return error.message
  return "AI reranking was unavailable; showing the deterministic order."
}

/**
 * Reranks the first `topN` entries. The input array is never mutated, no entry
 * is ever added or removed, and entries after `topN` are returned as the same
 * objects in the same order.
 */
export async function rerankShortlist(input: {
  userId: string
  entries: readonly RankedEntry[]
  postings: ReadonlyMap<string, RankingPosting>
  topN?: number
}): Promise<{ reranked: boolean; entries: RankedEntry[]; warnings: string[] }> {
  const deterministic = [...input.entries]
  if (deterministic.length === 0) {
    return { reranked: false, entries: deterministic, warnings: [] }
  }

  const requested = input.topN ?? DEFAULT_TOP_N
  const topN = Math.min(MAX_TOP_N, Math.max(1, Math.floor(requested)))
  const shortlist = deterministic.slice(0, topN)
  const warnings: string[] = []

  let judgements: z.infer<typeof rerankSchema>["rankings"]
  try {
    const { object } = await generateObjectTracked({
      schema: rerankSchema,
      system: SYSTEM_PROMPT,
      prompt: shortlistPrompt(shortlist, input.postings),
      temperature: 0,
      tracking: {
        feature: AI_USAGE_FEATURES.RANKING_RERANK,
        stage: AI_STAGES.RANK,
        surface: "app",
        userId: input.userId,
      },
    })
    judgements = object.rankings
  } catch (error) {
    return { reranked: false, entries: deterministic, warnings: [failureMessage(error)] }
  }

  const shortlistIds = new Set(shortlist.map((entry) => entry.postingId))
  const applied = new Map<
    string,
    { verdict: RerankVerdict; confidence: number; reason: string }
  >()

  for (const judgement of judgements) {
    if (!shortlistIds.has(judgement.postingId)) {
      warnings.push("The model returned a posting that was not in the shortlist; ignored.")
      continue
    }
    const posting = input.postings.get(judgement.postingId)
    if (!posting || !groundedQuote(posting, judgement.evidenceQuote)) {
      warnings.push(
        `The model's explanation for ${judgement.postingId} was not grounded in the posting text; ignored.`
      )
      continue
    }
    applied.set(judgement.postingId, {
      verdict: judgement.verdict,
      confidence: judgement.confidence,
      reason: judgement.reason.trim(),
    })
  }

  if (applied.size === 0) {
    return {
      reranked: false,
      entries: deterministic,
      warnings: [...warnings, "The model returned no grounded rankings; showing the deterministic order."],
    }
  }

  // Partial coverage is not a rerank. Reordering only the judged entries would
  // silently promote an unjudged posting or hide one below a weaker role; the
  // prompt requires one verdict per id, so an omitted id means the output is
  // incomplete and the deterministic order must stand.
  const omitted = shortlist.filter((entry) => !applied.has(entry.postingId))
  if (omitted.length > 0) {
    return {
      reranked: false,
      entries: deterministic,
      warnings: [
        ...warnings,
        `The model omitted ${omitted.length} shortlisted posting${omitted.length === 1 ? "" : "s"}; showing the deterministic order.`,
      ],
    }
  }

  const reordered = shortlist
    .map((entry, position) => {
      const judgement = applied.get(entry.postingId)
      if (!judgement) return { entry, position, judgement: null }
      return { entry, position, judgement }
    })
    .sort((a, b) => {
      const rankA = a.judgement ? VERDICT_RANK[a.judgement.verdict] : 3
      const rankB = b.judgement ? VERDICT_RANK[b.judgement.verdict] : 3
      if (rankA !== rankB) return rankA - rankB
      const confidenceA = a.judgement?.confidence ?? -1
      const confidenceB = b.judgement?.confidence ?? -1
      if (confidenceA !== confidenceB) return confidenceB - confidenceA
      return a.position - b.position
    })
    .map(({ entry, judgement }, position) => {
      if (!judgement) return { ...entry, rank: position + 1 }
      return {
        ...entry,
        rank: position + 1,
        explanation: [
          ...entry.explanation,
          `AI rerank (${judgement.verdict}, ${judgement.confidence}%): ${judgement.reason}`,
        ],
      }
    })

  return {
    reranked: true,
    entries: [...reordered, ...deterministic.slice(topN)],
    warnings,
  }
}
