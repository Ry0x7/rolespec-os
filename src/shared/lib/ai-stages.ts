/**
 * Stable stage names for per-stage AI routing. They match the workflow step
 * names that make model calls, so a user can say "research with provider A,
 * tailor with provider B" without inventing a second vocabulary.
 *
 * A stage is optional at every call site: when no override exists the user's
 * normal provider/model (or the deployment default) is used unchanged.
 */
export const AI_STAGES = {
  PROFILE: "PROFILE",
  DISCOVER: "DISCOVER",
  RANK: "RANK",
  RESEARCH: "RESEARCH",
  TAILOR: "TAILOR",
  ATS: "ATS",
  OUTREACH: "OUTREACH",
} as const

export type AiStage = (typeof AI_STAGES)[keyof typeof AI_STAGES]

export const AI_STAGE_VALUES = Object.values(AI_STAGES) as AiStage[]

export function isAiStage(value: string): value is AiStage {
  return (AI_STAGE_VALUES as string[]).includes(value)
}
