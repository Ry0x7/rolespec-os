import { z } from "zod"

import type { Qualification } from "@/features/discovery/services/qualify.service"

/**
 * `Job.qualification` is a Json column written by the discovery save action and
 * the extension route, so nothing in the type system guarantees what came back
 * out of it. Every read goes through this parser, and anything that does not
 * match is treated as absent rather than rendered half-formed.
 */

const signalSchema = z.enum(["GOOD", "NEUTRAL", "CONCERN", "BLOCKER"])
const uncheckedSchema = z.enum(["work-mode", "location", "requirements"])

const stepSchema = z.object({
  signal: signalSchema,
  reasons: z.array(z.string()),
  unchecked: z.array(uncheckedSchema).optional(),
})

export const storedQualificationSchema = z.object({
  verdict: z.enum(["STRONG", "WORTH_A_LOOK", "WEAK", "BLOCKED"]),
  nextAction: z.string(),
  checkedAt: z.string(),
  worthIt: stepSchema,
  eligible: stepSchema,
  match: stepSchema.extend({
    matched: z.array(z.string()),
    confirmedCount: z.number(),
  }),
  risk: stepSchema.extend({
    level: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable(),
  }),
  // Optional: snapshots written before market fit existed are still valid
  // snapshots, and a missing field is "nobody checked", not a parse failure.
  marketFit: z
    .object({
      fit: z.enum(["IN_MARKET", "REGION", "OPEN", "RESTRICTED", "UNKNOWN"]),
      reason: z.string(),
      label: z.string(),
    })
    .optional(),
  // Optional for the same reason: snapshots written before the sponsorship
  // question was scoped simply do not carry it, and a reader that finds it
  // missing falls back to the posting's own requirement flags.
  sponsorshipRelevant: z.boolean().optional(),
})

/** What an older snapshot's missing market fit reads as: unchecked, not open. */
const MARKET_FIT_NOT_RECORDED = {
  fit: "UNKNOWN",
  reason: "Saved before market fit was recorded",
  label: "Location not recorded",
} as const

export interface ParsedQualification {
  /** Shaped for the discovery `QualificationSummary`, which renders it. */
  qualification: Qualification
  /** ISO-8601, when the snapshot was taken. */
  checkedAt: string
}

/**
 * The stored snapshot as the discovery `QualificationSummary` wants it, or null
 * when the column is empty or holds something this does not recognise.
 *
 * `requirementFlags` is empty on purpose: the detail page already renders the
 * posting's requirement badges from `Job.requirementFlags` in its header, and a
 * second copy inside this section would say the same thing twice.
 */
export function parseStoredQualification(value: unknown): ParsedQualification | null {
  const parsed = storedQualificationSchema.safeParse(value)
  if (!parsed.success) return null

  const {
    verdict,
    nextAction,
    checkedAt,
    worthIt,
    eligible,
    match,
    risk,
    marketFit,
    sponsorshipRelevant,
  } = parsed.data
  return {
    qualification: {
      verdict,
      nextAction,
      worthIt,
      eligible,
      match,
      risk,
      requirementFlags: [],
      marketFit: marketFit ?? MARKET_FIT_NOT_RECORDED,
      // Carried through rather than dropped: whether sponsorship is a live
      // question at all is part of the reasoning, and a reader that silently
      // loses it would re-raise a question the check already settled.
      ...(sponsorshipRelevant !== undefined && { sponsorshipRelevant }),
    },
    checkedAt,
  }
}
