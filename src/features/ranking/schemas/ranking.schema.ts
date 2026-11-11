import { z } from "zod"

/** One ranking request. Unknown keys are rejected so a typo cannot be ignored. */
export const rankingRequestSchema = z
  .object({
    /** Restrict the pool to these saved job ids. Omit to rank every saved job. */
    jobIds: z.array(z.string().min(1)).min(1).max(100).optional(),
    /** How many entries to return. Omit for the whole pool. */
    topK: z.number().int().min(1).max(100).optional(),
    /** 0-100 composite cutoff. Excluded rows are still reported by id. */
    minScore: z.number().min(0).max(100).optional(),
    /** Share of the composite that comes from BM25. Default 0.4. */
    lexicalWeight: z.number().min(0).max(1).optional(),
    /**
     * Opt-in LLM rerank of the top 20. Never required: a provider failure
     * returns the deterministic order with a warning.
     */
    rerank: z.boolean().optional(),
  })
  .strict()

export type RankingRequest = z.infer<typeof rankingRequestSchema>
