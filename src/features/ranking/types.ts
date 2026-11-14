import type {
  ExperienceLevel,
  SalaryCurrency,
  SalaryPeriod,
  WorkType,
} from "@/generated/prisma/enums"

/**
 * Ranking vocabulary shared by the pure scorer, the discovery pipeline and the
 * `/api/ranking` route. Kept free of Prisma and network imports so the formula
 * and the factor rules stay unit-testable.
 *
 * Two invariants:
 *
 * - A missing fact is `UNKNOWN`, never a quiet pass. Unknown factors earn no
 *   points and are always listed in the explanation, so a thin posting cannot
 *   outrank a complete one by saying less.
 * - Ranking never deletes a row. Top-K and the score threshold only decide what
 *   is shown first; every excluded posting is reported with a reason.
 */

/** The seven factors every ranked posting is measured against. */
export type FitFactorId =
  | "SKILLS"
  | "EXPERIENCE"
  | "LOCATION"
  | "WORK_MODE"
  | "SALARY"
  | "AUTHORIZATION"
  | "FRESHNESS"

/** What one factor concluded. `UNKNOWN` means the data was not present. */
export type FitFactorState = "MATCH" | "PARTIAL" | "MISMATCH" | "UNKNOWN"

export interface FitFactor {
  id: FitFactorId
  /** Short human label, e.g. "Work authorization". */
  label: string
  state: FitFactorState
  /** Fixed importance in the composite. Sums to 100 across the seven. */
  weight: number
  /** One user-facing sentence explaining the state. */
  reason: string
  /** The posting phrases or profile values the conclusion read. */
  evidence: string[]
}

/** The subset of a Career Profile ranking needs. */
export interface RankingProfile {
  targetRoleTitles: string[]
  locations: string[]
  openToRelocation: boolean
  workModes: WorkType[]
  /** Null means the user has not answered — never treated as "no". */
  requiresSponsorship: boolean | null
  experienceLevel: ExperienceLevel | null
  salaryMin: number | null
  salaryMax: number | null
  salaryPeriod: SalaryPeriod | null
  salaryCurrency: SalaryCurrency | null
  capabilities: Array<{ name: string; confirmed: boolean }>
  /** Confirmed career evidence titles and details, used as query terms. */
  evidence: Array<{ title: string; details?: string | null; confirmed: boolean }>
}

/** One posting to rank. Dates are accepted as Date or ISO string. */
export interface RankingPosting {
  id: string
  title: string
  companyName: string
  description?: string | null
  location?: string | null
  workType?: WorkType | null
  salaryText?: string | null
  salary?: number | null
  salaryCurrency?: SalaryCurrency | null
  salaryPeriod?: SalaryPeriod | null
  postedAt?: Date | string | null
  requirementFlags?: string[]
  url?: string | null
}

export interface RankingOptions {
  /** How many entries to return. Omit for the whole pool. */
  topK?: number
  /** Entries below this 0-100 composite score are excluded from `entries`. */
  minScore?: number
  /** Weight of the lexical component, 0-1. The rest goes to fit factors. */
  lexicalWeight?: number
  /** Injectable clock so fixtures are reproducible. */
  now?: Date
}

/** A grounded model judgement about one shortlisted posting. */
export interface AiRerankJudgement {
  verdict: "FIT" | "PARTIAL" | "MISMATCH"
  /** 0-100 confidence that the posting text supports the verdict. */
  confidence: number
  reason: string
}

export interface RankedEntry {
  postingId: string
  /** 1-based position after sorting. */
  rank: number
  /** 0-100 composite: lexical evidence plus the seven deterministic factors. */
  score: number
  /** Raw Okapi BM25 score, or null when the posting has no usable text. */
  lexicalScore: number | null
  /** BM25 position in the pool, or null when the posting has no lexical score. */
  lexicalRank: number | null
  /** 0-100 weighted factor score. Unknown factors contribute nothing. */
  fitScore: number
  /** Share of factor weight backed by known data, 0-1. */
  coverage: number
  factors: FitFactor[]
  /** Plain sentences naming what helped, what hurt and what is unknown. */
  explanation: string[]
  /** Present only when the optional model rerank accepted a grounded verdict. */
  ai?: AiRerankJudgement
}

export interface RankingExclusion {
  postingId: string
  reason: "below-threshold" | "outside-top-k"
}

export interface RankingSnapshot {
  /** ISO timestamp of this computation. */
  rankedAt: string
  corpusSize: number
  /** Postings that had no indexable text and therefore no lexical score. */
  unscoredCount: number
  averageDocumentLength: number
  queryTerms: string[]
  topK: number | null
  minScore: number | null
  lexicalWeight: number
  fitWeight: number
}

export interface RankingResult {
  snapshot: RankingSnapshot
  entries: RankedEntry[]
  excluded: RankingExclusion[]
}
