import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockGenerateObject } = vi.hoisted(() => ({
  mockGenerateObject: vi.fn(),
}))

vi.mock("@/shared/lib/ai-generate", () => ({
  AI_USAGE_FEATURES: { RANKING_RERANK: "jobs.ranking_rerank" },
  generateObjectTracked: mockGenerateObject,
}))

import { AiKeyRequiredError } from "@/shared/lib/ai-provider"
import type { RankedEntry, RankingPosting } from "../../types"
import { rerankShortlist } from "../rerank.service"

function entry(id: string, rank: number): RankedEntry {
  return {
    postingId: id,
    rank,
    score: 100 - rank,
    lexicalScore: 2,
    lexicalRank: rank,
    fitScore: 60,
    coverage: 0.7,
    factors: [],
    explanation: [`deterministic line for ${id}`],
  }
}

function posting(id: string, title: string, description: string): RankingPosting {
  return { id, title, companyName: "Acme", description }
}

const POSTINGS = new Map<string, RankingPosting>([
  ["a", posting("a", "Frontend Engineer", "Build React interfaces for our design system.")],
  ["b", posting("b", "Data Engineer", "Build Python data pipelines and warehouse models.")],
  ["c", posting("c", "Platform Engineer", "Operate Kubernetes clusters.")],
])

function judgement(
  postingId: string,
  verdict: "FIT" | "PARTIAL" | "MISMATCH",
  confidence: number,
  evidenceQuote: string
) {
  return {
    postingId,
    verdict,
    confidence,
    reason: `Reason for ${postingId}`,
    evidenceQuote,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("rerankShortlist", () => {
  it("falls back to the deterministic order when the provider has no key", async () => {
    mockGenerateObject.mockRejectedValue(new AiKeyRequiredError("Add your API key first."))
    const entries = [entry("a", 1), entry("b", 2)]

    const result = await rerankShortlist({
      userId: "user-1",
      entries,
      postings: POSTINGS,
    })

    expect(result.reranked).toBe(false)
    expect(result.entries).toEqual(entries)
    expect(result.warnings).toEqual(["Add your API key first."])
  })

  it("ignores a posting id that was not in the shortlist", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { rankings: [judgement("ghost", "FIT", 99, "anything")] },
      usage: undefined,
    })
    const entries = [entry("a", 1), entry("b", 2)]

    const result = await rerankShortlist({ userId: "user-1", entries, postings: POSTINGS })

    expect(result.reranked).toBe(false)
    expect(result.entries.map((row) => row.postingId)).toEqual(["a", "b"])
    expect(result.warnings.join(" ")).toContain("not in the shortlist")
  })

  it("ignores a judgement whose quote is not in the posting", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { rankings: [judgement("a", "FIT", 95, "a quote that is nowhere in the posting")] },
      usage: undefined,
    })

    const result = await rerankShortlist({
      userId: "user-1",
      entries: [entry("a", 1), entry("b", 2)],
      postings: POSTINGS,
    })

    expect(result.reranked).toBe(false)
    expect(result.entries[0]!.postingId).toBe("a")
    expect(result.warnings.join(" ")).toContain("not grounded")
  })

  it("moves a grounded FIT above the previous leader", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        rankings: [
          judgement("a", "MISMATCH", 80, "React interfaces"),
          judgement("b", "FIT", 90, "Python data pipelines"),
        ],
      },
      usage: undefined,
    })

    const result = await rerankShortlist({
      userId: "user-1",
      entries: [entry("a", 1), entry("b", 2)],
      postings: POSTINGS,
    })

    expect(result.reranked).toBe(true)
    expect(result.entries.map((row) => row.postingId)).toEqual(["b", "a"])
    expect(result.entries[0]!.rank).toBe(1)
    expect(result.entries[0]!.explanation).toContain(
      "AI rerank (FIT, 90%): Reason for b"
    )
    expect(result.entries[0]!.explanation).toContain("deterministic line for b")
    expect(result.entries[0]!.ai).toEqual({
      verdict: "FIT",
      confidence: 90,
      reason: "Reason for b",
    })
  })

  it("leaves entries beyond the top N untouched and in order", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        rankings: [
          judgement("a", "MISMATCH", 80, "React interfaces"),
          judgement("b", "FIT", 90, "Python data pipelines"),
        ],
      },
      usage: undefined,
    })
    const third = entry("c", 3)

    const result = await rerankShortlist({
      userId: "user-1",
      entries: [entry("a", 1), entry("b", 2), third],
      postings: POSTINGS,
      topN: 2,
    })

    expect(result.entries.map((row) => row.postingId)).toEqual(["b", "a", "c"])
    expect(result.entries[2]).toBe(third)
  })

  it("never loses or duplicates an input entry", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { rankings: [judgement("b", "PARTIAL", 40, "Python")] },
      usage: undefined,
    })

    const result = await rerankShortlist({
      userId: "user-1",
      entries: [entry("a", 1), entry("b", 2), entry("c", 3)],
      postings: POSTINGS,
    })

    expect(result.entries).toHaveLength(3)
    expect(new Set(result.entries.map((row) => row.postingId))).toEqual(
      new Set(["a", "b", "c"])
    )
  })

  it("refuses a partial rerank when the model omits a shortlisted posting", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { rankings: [judgement("b", "FIT", 90, "Python data pipelines")] },
      usage: undefined,
    })
    const entries = [entry("a", 1), entry("b", 2)]

    const result = await rerankShortlist({
      userId: "user-1",
      entries,
      postings: POSTINGS,
    })

    expect(result.reranked).toBe(false)
    expect(result.entries).toEqual(entries)
    expect(result.warnings.join(" ")).toContain("omitted 1 shortlisted posting")
  })
})
