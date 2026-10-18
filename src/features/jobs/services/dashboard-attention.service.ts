import { prisma } from "@/shared/lib/prisma"
import { addCalendarDays, calendarDayStart, calendarDaysBetween } from "@/shared/lib/dates"
import { ApplicationStatus, type JobSource } from "@/generated/prisma/enums"
import type { QualificationVerdict } from "@/features/discovery/services/qualify.service"
import {
  assessOpportunityConfidence,
  type OpportunityConfidenceLevel,
} from "@/features/discovery/services/opportunity-confidence.service"
import type { JobRiskLevel } from "./job-risk.service"

import { parseStoredQualification } from "../schemas/job-qualification.schema"
import { FOLLOW_UP_STATUSES } from "./follow-up.service"
import { STRONG_FIT_NEXT_STEP } from "./application-next-step.service"

export type OverdueFollowUp = {
  id: string
  companyName: string
  jobTitle: string
  /** Calendar date (UTC midnight), as `followUpAt` is stored. */
  followUpAt: Date
  /** Whole calendar days between the scheduled day and the user's today; 0 = due today. */
  daysOverdue: number
}

export type AwaitingOutcomeItem = {
  id: string
  companyName: string
  jobTitle: string
  /** When the interview was scheduled, as stored. Always before `todayStart`. */
  interviewDate: Date
  /** Whole calendar days between the interview and the user's today; at least 1. */
  daysSince: number
}

export type DecideQueueItem = {
  id: string
  companyName: string
  jobTitle: string
  /** Null when the posting carries no snapshot, or one this build cannot parse. */
  verdict: QualificationVerdict | null
  /** What to do with an already-saved job, from its verdict and risk level. */
  reason: string
  /**
   * Posting-side triage, computed at read time. Separate from `verdict`: that
   * says whether the job fits the user, this says whether the posting is worth
   * their time. Only the two fields the row renders are carried.
   */
  confidence: { level: OpportunityConfidenceLevel; summary: string }
}

export type DashboardAttention = {
  /** Live applications whose follow-up day has already come, soonest first. */
  overdueFollowUps: OverdueFollowUp[]
  /** Total overdue, so the section can offer "View all N" beyond the rows shown. */
  overdueTotal: number
  /**
   * Screening or interview stages whose interview day has already passed, so
   * the outcome is what the row is waiting on. Oldest interview first.
   */
  awaitingOutcome: AwaitingOutcomeItem[]
  /** The saved-but-undecided jobs most worth deciding on, best verdict first. */
  decideQueue: DecideQueueItem[]
  /** Every application still at `INTERESTED`, not just the ranked few. */
  interestedTotal: number
}

/** How many rows of each list the dashboard section shows. */
export const ATTENTION_ROW_LIMIT = 3

/**
 * The live interview stages. An interview date in the past on one of these
 * means the outcome has not been recorded yet; on an offer or a closed row the
 * outcome already is the status. Matches the check in `quickActionsFor`.
 */
const AWAITING_OUTCOME_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.SCREENING,
  ApplicationStatus.INTERVIEW,
]

/**
 * How many `INTERESTED` rows are pulled in to rank. Ranking needs the stored
 * snapshot, which SQL cannot order by, so the window is bounded rather than
 * unbounded: the top three of the fifty most recently saved jobs is the honest
 * scope of a dashboard prompt.
 */
const DECIDE_CANDIDATE_WINDOW = 50

/**
 * Best-verdict-first, mirroring the `VERDICT_RANK` the discovery candidate list
 * sorts by (`discovery.actions.ts`). That one is private to a `"use server"`
 * module, which may only export async functions, so it cannot be imported.
 */
const VERDICT_RANK: Record<QualificationVerdict, number> = {
  STRONG: 0,
  WORTH_A_LOOK: 1,
  WEAK: 2,
  BLOCKED: 3,
}

/** A posting with no readable snapshot sorts last, but is never dropped. */
const NO_VERDICT_RANK = Object.keys(VERDICT_RANK).length

/**
 * What to do next with a job that is already saved, one line per verdict.
 *
 * The snapshot's own `nextAction` is deliberately not used here: it was written
 * for the discovery list, where the decision is whether to save at all ("Save it
 * and tailor a resume…"), and reads wrong on a job the user already saved. The
 * wording follows the `VerdictBadge` labels and never claims more fit than the
 * verdict itself states.
 */
const DECIDE_REASON: Record<QualificationVerdict, string> = {
  // Shared with `describeNextStep`, so the tracker row, the job page and this
  // prompt say the same sentence about the same state.
  STRONG: STRONG_FIT_NEXT_STEP,
  WORTH_A_LOOK: "Worth a look — review the posting and decide",
  WEAK: "Weak fit — check whether it is still worth applying",
  BLOCKED: "Ruled out on your criteria — drop it unless the posting was wrong",
}

/** No readable snapshot means no assessment to report — say so, claim nothing. */
const NO_VERDICT_REASON = "Not assessed — open it and judge for yourself"

/**
 * A HIGH scam-signal risk outranks the verdict line, the way `decideNextAction`
 * in `qualify.service` puts "Verify the company independently…" ahead of the
 * fit wording. A verdict line alone would read as neutral encouragement on a
 * posting the risk step flagged.
 */
const HIGH_RISK_REASON =
  "High scam-signal risk — verify the company independently before spending time on it"

/** Decision-phase line for a saved job, for any verdict or none. */
export function decideReason(
  verdict: QualificationVerdict | null,
  riskLevel: JobRiskLevel | null = null,
): string {
  if (riskLevel === "HIGH") return HIGH_RISK_REASON
  return verdict ? DECIDE_REASON[verdict] : NO_VERDICT_REASON
}

export type DecideCandidate = {
  id: string
  companyName: string
  jobTitle: string
  createdAt: Date
  /** Straight off the `Job.qualification` Json column — shape unverified. */
  qualification: unknown
  /** Confidence inputs, straight off the `Job` row. All optional by design. */
  sourceProvider?: string | null
  source?: JobSource | null
  url?: string | null
  postedAt?: Date | null
  discoveredAt?: Date | null
  /**
   * Length of the posting body, when the caller loaded it. Left undefined and
   * the completeness signal is omitted rather than scored as a short posting.
   */
  descriptionLength?: number
}

/**
 * Within one verdict band, a posting the signals say little for sorts below one
 * they do. Deliberately only two buckets: confidence never outranks fit, and a
 * LOW row is demoted, never dropped.
 */
const LOW_CONFIDENCE_RANK = 1
const OTHER_CONFIDENCE_RANK = 0

/**
 * Ranks saved-but-undecided jobs for the dashboard's "Decide next" prompt:
 * strongest verdict first, newest first within a verdict.
 *
 * Pure, and separate from the query, so the ordering rule is testable. The
 * snapshot goes through the same defensive parser the detail page uses —
 * anything unparseable is treated as no verdict rather than crashing the
 * dashboard.
 */
export function rankDecideQueue(
  candidates: DecideCandidate[],
  limit: number = ATTENTION_ROW_LIMIT,
): DecideQueueItem[] {
  const scored = candidates.map((candidate) => {
    const parsed = parseStoredQualification(candidate.qualification)
    const verdict = parsed?.qualification.verdict ?? null
    const confidence = assessOpportunityConfidence({
      provider: candidate.sourceProvider,
      source: candidate.source,
      url: candidate.url,
      postedAt: candidate.postedAt,
      discoveredAt: candidate.discoveredAt,
      createdAt: candidate.createdAt,
      companyName: candidate.companyName,
      descriptionLength: candidate.descriptionLength,
    })
    return {
      item: {
        id: candidate.id,
        companyName: candidate.companyName,
        jobTitle: candidate.jobTitle,
        verdict,
        reason: decideReason(verdict, parsed?.qualification.risk.level ?? null),
        confidence: { level: confidence.level, summary: confidence.summary },
      } satisfies DecideQueueItem,
      rank: parsed ? VERDICT_RANK[parsed.qualification.verdict] : NO_VERDICT_RANK,
      confidenceRank:
        confidence.level === "LOW" ? LOW_CONFIDENCE_RANK : OTHER_CONFIDENCE_RANK,
      createdAt: candidate.createdAt.getTime(),
    }
  })

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.confidenceRank - b.confidenceRank ||
      b.createdAt - a.createdAt,
  )
  return scored.slice(0, limit).map((row) => row.item)
}

/**
 * The decisions the dashboard has to surface, scoped to a single user:
 * follow-ups that have gone overdue, interviews whose outcome is still
 * unrecorded, and saved jobs still awaiting a verdict-led decision.
 *
 * `todayStart` frames "how overdue" and "how long ago" on the user's own
 * calendar day, the same way `getJobsDashboardStats` frames its window. A
 * follow-up is due through the end of that day, matching `followUpDue` there.
 *
 * `tzOffsetMinutes` is the user's offset (`getTimezoneOffset()` minutes, from
 * `getUserTzOffsetMinutes`). `interviewDate` is a real instant, so it is compared
 * against the instant the user's day began, not the UTC-midnight label.
 */
export async function getDashboardAttention(
  userId: string,
  todayStart: Date = calendarDayStart(new Date()),
  tzOffsetMinutes = 0,
): Promise<DashboardAttention> {
  // `followUpAt` is a calendar date, so one dated today is due all day.
  const dueBefore = addCalendarDays(todayStart, 1)
  // The instant the user's today began: UTC+8 (-480) → 16:00Z the day before.
  const userDayStartInstant = new Date(todayStart.getTime() + tzOffsetMinutes * 60_000)

  const [overdueRows, overdueTotal, awaitingRows, decideRows, interestedTotal] = await Promise.all([
    prisma.jobApplication.findMany({
      where: {
        userId,
        status: { in: FOLLOW_UP_STATUSES },
        followUpAt: { lt: dueBefore },
      },
      orderBy: { followUpAt: "asc" },
      take: ATTENTION_ROW_LIMIT,
      select: {
        id: true,
        followUpAt: true,
        job: { select: { companyName: true, title: true } },
      },
    }),
    prisma.jobApplication.count({
      where: {
        userId,
        status: { in: FOLLOW_UP_STATUSES },
        followUpAt: { lt: dueBefore },
      },
    }),
    prisma.jobApplication.findMany({
      where: {
        userId,
        status: { in: AWAITING_OUTCOME_STATUSES },
        // Before the start of the user's today: an interview later today has
        // not happened yet, so there is no outcome to log.
        interviewDate: { lt: userDayStartInstant },
      },
      orderBy: { interviewDate: "asc" },
      take: ATTENTION_ROW_LIMIT,
      select: {
        id: true,
        interviewDate: true,
        job: { select: { companyName: true, title: true } },
      },
    }),
    prisma.jobApplication.findMany({
      where: { userId, status: ApplicationStatus.INTERESTED },
      orderBy: { createdAt: "desc" },
      take: DECIDE_CANDIDATE_WINDOW,
      select: {
        id: true,
        createdAt: true,
        job: {
          select: {
            companyName: true,
            title: true,
            qualification: true,
            // Opportunity-confidence inputs. `description` is deliberately not
            // selected: it is the heaviest column on the row and the dashboard
            // only needs the level.
            sourceProvider: true,
            source: true,
            url: true,
            postedAt: true,
            discoveredAt: true,
          },
        },
      },
    }),
    prisma.jobApplication.count({
      where: { userId, status: ApplicationStatus.INTERESTED },
    }),
  ])

  const overdueFollowUps: OverdueFollowUp[] = overdueRows.flatMap((row) =>
    // The `lt` filter guarantees a date, but the column is nullable, so the
    // type narrowing has to be explicit.
    row.followUpAt
      ? [
          {
            id: row.id,
            companyName: row.job.companyName,
            jobTitle: row.job.title,
            followUpAt: row.followUpAt,
            daysOverdue: calendarDaysBetween(row.followUpAt, todayStart),
          },
        ]
      : [],
  )

  const awaitingOutcome: AwaitingOutcomeItem[] = awaitingRows.flatMap((row) =>
    // Same explicit narrowing as above: the `lt` filter guarantees a date.
    row.interviewDate
      ? [
          {
            id: row.id,
            companyName: row.job.companyName,
            jobTitle: row.job.title,
            interviewDate: row.interviewDate,
            // Count on the user's calendar: the interview's local day vs today.
            daysSince: calendarDaysBetween(
              calendarDayStart(row.interviewDate, tzOffsetMinutes),
              todayStart,
            ),
          },
        ]
      : [],
  )

  const decideCandidates: DecideCandidate[] = decideRows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    companyName: row.job.companyName,
    jobTitle: row.job.title,
    qualification: row.job.qualification,
    sourceProvider: row.job.sourceProvider,
    source: row.job.source,
    url: row.job.url,
    postedAt: row.job.postedAt,
    discoveredAt: row.job.discoveredAt,
  }))

  return {
    overdueFollowUps,
    overdueTotal,
    awaitingOutcome,
    decideQueue: await withPostingLengths(userId, decideCandidates),
    interestedTotal,
  }
}

/**
 * Ranks the queue, then re-ranks the survivors with their posting length.
 *
 * The window query deliberately leaves `description` out — it is the heaviest
 * column on the row and the window is fifty rows wide. But omitting the length
 * also omits the completeness signal, which made the same job read MEDIUM here
 * and HIGH on its own page. Only the verdict bands that can reach the top
 * `ATTENTION_ROW_LIMIT` survive the first pass, so loading the body for just
 * those is a bounded second read, and the level the dashboard shows is then the
 * level the job page shows.
 */
async function withPostingLengths(
  userId: string,
  candidates: DecideCandidate[],
): Promise<DecideQueueItem[]> {
  const firstPass = rankDecideQueue(candidates, candidates.length)
  if (firstPass.length === 0) return firstPass

  // The length can move a row across the LOW line in either direction, so a
  // top-N cut taken without it can drop a row that belongs in the final top N.
  // Confidence never reorders across verdicts, though, so every row in the
  // verdict bands down to the one the Nth row sits in is enough to be exact.
  const bandOf = (row: DecideQueueItem) =>
    row.verdict ? VERDICT_RANK[row.verdict] : NO_VERDICT_RANK
  const cutoffBand = bandOf(
    firstPass[Math.min(ATTENTION_ROW_LIMIT, firstPass.length) - 1],
  )
  const shortlistIds = new Set(
    firstPass.filter((row) => bandOf(row) <= cutoffBand).map((row) => row.id),
  )
  const bodies = await prisma.jobApplication.findMany({
    where: { id: { in: [...shortlistIds] }, userId },
    select: { id: true, job: { select: { description: true } } },
  })
  // Undefined for a job with no body at all, so the signal is omitted rather
  // than counted against a posting nobody ever pasted a description into.
  const lengthById = new Map(
    bodies.map((row) => [row.id, row.job.description?.length] as const),
  )

  return rankDecideQueue(
    candidates
      .filter((candidate) => shortlistIds.has(candidate.id))
      .map((candidate) => ({
        ...candidate,
        descriptionLength: lengthById.get(candidate.id),
      })),
  )
}
