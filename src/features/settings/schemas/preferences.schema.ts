import { z } from "zod"

import { DEFAULT_ATS_COMPANY_WATCHLIST } from "@/config/discovery"
import {
  MAX_WORKDAY_BOARD_URL_LENGTH,
  parseWorkdayBoardUrl,
} from "@/features/discovery/constants/workday-board"
import {
  DAILY_JOB_GOAL_MAX,
  DAILY_JOB_GOAL_MIN,
  DEFAULT_DAILY_JOB_GOAL,
} from "@/features/jobs/constants/goals"
import {
  DEFAULT_OPPORTUNITY_SETTINGS,
  PRESET_WEIGHTS,
  type OpportunityWeights,
} from "@/features/opportunity/types"
import { SUPPORTED_CURRENCIES } from "@/shared/lib/money/currencies"

export const MAX_AI_INSTRUCTIONS_LENGTH = 1000

/** A board slug is a URL path segment, so anything outside this set cannot be one. */
export const ATS_SLUG_PATTERN = /^[a-z0-9][a-z0-9-_]*$/

export const MAX_ATS_SLUG_LENGTH = 100

/** Ceiling per ATS: one board is one outbound request on every discovery run. */
export const MAX_ATS_SLUGS = 50

const atsSlugList = z
  .array(
    z
      .string()
      .transform((slug) => slug.trim().toLowerCase())
      .pipe(
        z
          .string()
          .max(MAX_ATS_SLUG_LENGTH, `A board slug cannot be longer than ${MAX_ATS_SLUG_LENGTH} characters`)
          .regex(ATS_SLUG_PATTERN, "A board slug can only contain letters, numbers, hyphens and underscores")
      )
  )
  .transform((slugs) => [...new Set(slugs)])
  .refine((slugs) => slugs.length <= MAX_ATS_SLUGS, `You can watch at most ${MAX_ATS_SLUGS} companies per source`)

/**
 * Watched Workday career sites.
 *
 * Workday is the one ATS here that a slug cannot name: a site is a tenant, a
 * data-centre subdomain and a site id, so the entry is the board URL the user
 * copies out of their address bar. `parseWorkdayBoardUrl` both validates it and
 * strips it back to `https://{tenant}.{wd}.myworkdayjobs.com/{site}`, so a
 * pasted posting URL and a pasted board URL store as the same entry.
 */
const workdayBoardList = z
  .array(
    z
      .string()
      .max(
        MAX_WORKDAY_BOARD_URL_LENGTH,
        `A Workday board URL cannot be longer than ${MAX_WORKDAY_BOARD_URL_LENGTH} characters`
      )
      .transform((value, ctx) => {
        const board = parseWorkdayBoardUrl(value)
        if (!board) {
          ctx.addIssue({
            code: "custom",
            message:
              "A Workday board URL looks like https://company.wd3.myworkdayjobs.com/Careers",
          })
          return z.NEVER
        }
        return board.boardUrl
      })
  )
  .transform((urls) => [...new Set(urls)])
  .refine(
    (urls) => urls.length <= MAX_ATS_SLUGS,
    `You can watch at most ${MAX_ATS_SLUGS} companies per source`
  )

/**
 * The companies whose ATS boards discovery scans, as the user has set them.
 *
 * `ashby` defaults to an empty list rather than being required: it was added
 * after users had already saved a watchlist, and a stored `{ greenhouse, lever }`
 * object must keep parsing instead of falling back to the whole default set and
 * silently undoing the user's edits. `bamboohr`, `freshteam` and `workday`
 * arrived later still and default the same way, for the same reason — an
 * existing watchlist gains an empty section, never a set of boards the user
 * never chose.
 */
export const atsWatchlistSchema = z.object({
  greenhouse: atsSlugList,
  lever: atsSlugList,
  ashby: atsSlugList.default([]),
  bamboohr: atsSlugList.default([]),
  freshteam: atsSlugList.default([]),
  workday: workdayBoardList.default([]),
})

export type AtsWatchlist = z.infer<typeof atsWatchlistSchema>

/**
 * What a caller may *send*. Every source added after the first two defaults to
 * an empty list, so a caller that predates one may legitimately omit it — the
 * parse, not the type, is what fills it in.
 */
export type AtsWatchlistInput = z.input<typeof atsWatchlistSchema>

/** A fresh copy every time: callers must never be able to edit the shared default. */
export function defaultAtsWatchlist(): AtsWatchlist {
  return {
    greenhouse: [...DEFAULT_ATS_COMPANY_WATCHLIST.greenhouse],
    lever: [...DEFAULT_ATS_COMPANY_WATCHLIST.lever],
    ashby: [...DEFAULT_ATS_COMPANY_WATCHLIST.ashby],
    bamboohr: [...DEFAULT_ATS_COMPANY_WATCHLIST.bamboohr],
    freshteam: [...DEFAULT_ATS_COMPANY_WATCHLIST.freshteam],
    workday: [...DEFAULT_ATS_COMPANY_WATCHLIST.workday],
  }
}

/**
 * The currency job salaries are *displayed* in. Separate from
 * `JobApplication.salaryCurrency`, which is the currency a salary was entered
 * in — this only picks the counter-currency for the "≈ equivalent" line.
 *
 * Any ISO 4217 code RoleSpec can store is selectable, because the equivalent is
 * only offered when a real rate exists.
 */
export const PREFERRED_CURRENCIES = SUPPORTED_CURRENCIES

export type PreferredCurrency = (typeof PREFERRED_CURRENCIES)[number]

/**
 * Opportunity Value settings.
 *
 * Weights are optional: `null` means "use the preset", and a partial weight set
 * is completed from the preset rather than from zero. A weight of 0 is honoured
 * — it is how a user turns a dimension off.
 */
export const opportunityWeightsSchema = z.object({
  compensation: z.number().min(0).max(100),
  effectiveHourly: z.number().min(0).max(100),
  workload: z.number().min(0).max(100),
  friction: z.number().min(0).max(100),
  eligibility: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  fit: z.number().min(0).max(100),
  risk: z.number().min(0).max(100),
})

export const opportunitySettingsSchema = z.object({
  preset: z.enum(["BALANCED", "PAY_OVER_LOAD"]).default(DEFAULT_OPPORTUNITY_SETTINGS.preset),
  weights: opportunityWeightsSchema.nullable().default(null),
  /** Annual floor, as a decimal string in `minimumPayCurrency`. */
  minimumAnnualPay: z
    .string()
    .trim()
    .regex(/^\d{1,12}(?:\.\d{1,2})?$/, "Enter a yearly amount, for example 900000")
    .nullable()
    .default(null),
  minimumPayCurrency: z.enum(SUPPORTED_CURRENCIES).nullable().default(null),
  minimumPayStrict: z.boolean().default(false),
  workloadPreference: z.enum(["LIGHTER", "BALANCED", "INTENSE"]).default("BALANCED"),
  /** ALLOW keeps unstated pay, FLAG warns, REJECT removes it from a filtered run. */
  unknownPay: z.enum(["ALLOW", "FLAG", "REJECT"]).default("FLAG"),
})

export type OpportunitySettingsInput = z.input<typeof opportunitySettingsSchema>

/** Weights the UI shows for a preset, so the form starts from real numbers. */
export function presetWeights(preset: keyof typeof PRESET_WEIGHTS): OpportunityWeights {
  return { ...PRESET_WEIGHTS[preset] }
}

export const preferencesSchema = z.object({
  /** Applications the dashboard counts toward each day. */
  dailyApplicationGoal: z
    .number()
    .int("Use a whole number of applications")
    .min(
      DAILY_JOB_GOAL_MIN,
      `Set a daily goal between ${DAILY_JOB_GOAL_MIN} and ${DAILY_JOB_GOAL_MAX}`
    )
    .max(
      DAILY_JOB_GOAL_MAX,
      `Set a daily goal between ${DAILY_JOB_GOAL_MIN} and ${DAILY_JOB_GOAL_MAX}`
    )
    .default(DEFAULT_DAILY_JOB_GOAL),
  defaultAiInstructions: z.string().max(MAX_AI_INSTRUCTIONS_LENGTH),
  emailNotifications: z.boolean(),
  preferredCurrency: z.enum(PREFERRED_CURRENCIES),
  atsWatchlist: atsWatchlistSchema.default(defaultAtsWatchlist),
  opportunityValue: opportunitySettingsSchema.default(DEFAULT_OPPORTUNITY_SETTINGS),
})

export type UserPreferences = z.infer<typeof preferencesSchema>

/** What a caller may send: `atsWatchlist` is owned elsewhere, so it is optional. */
export type UpdatePreferencesInput = z.input<typeof preferencesSchema>

export const DEFAULT_PREFERENCES: UserPreferences = {
  dailyApplicationGoal: DEFAULT_DAILY_JOB_GOAL,
  defaultAiInstructions: "",
  emailNotifications: true,
  // A display default only — it is never used to interpret a stored salary, and
  // the settings form always shows the value the user actually chose. Existing
  // rows keep the PHP they already had.
  preferredCurrency: "PHP",
  atsWatchlist: defaultAtsWatchlist(),
  opportunityValue: { ...DEFAULT_OPPORTUNITY_SETTINGS },
}

/** Safely reads the `preferences` Json column into a fully-populated object. */
export function parsePreferences(value: unknown): UserPreferences {
  const parsed = preferencesSchema.partial().safeParse(value)
  if (!parsed.success) return { ...DEFAULT_PREFERENCES, atsWatchlist: defaultAtsWatchlist() }
  return {
    ...DEFAULT_PREFERENCES,
    ...parsed.data,
    atsWatchlist: parsed.data.atsWatchlist ?? defaultAtsWatchlist(),
  }
}
