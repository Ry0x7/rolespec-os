import { NextResponse } from "next/server"
import { z } from "zod"

import {
  JobType,
  SalaryCurrency,
  SalaryPeriod,
  WorkType,
} from "@/generated/prisma/enums"
import { Prisma } from "@/generated/prisma/client"
import { canonicalizeUrl } from "@/features/discovery/services/normalize.service"
import {
  toStoredQualification,
  type StoredQualification,
} from "@/features/discovery/services/qualification-snapshot.service"
import {
  assessOpportunityConfidence,
  type OpportunityConfidenceLevel,
} from "@/features/discovery/services/opportunity-confidence.service"
import {
  qualifyCandidate,
  toQualificationProfile,
  type Qualification,
  type QualificationPosting,
} from "@/features/discovery/services/qualify.service"
import { EXTENSION_JOBS_RATE_LIMIT } from "@/features/settings/constants/data"
import { extractEmployerQuestions } from "@/features/jobs/services/interview-questions.service"
import { extractJobRequirements } from "@/features/jobs/services/job-requirements.service"
import { assessJobRiskHeuristics } from "@/features/jobs/services/job-risk.service"
import {
  createJobApplicationWithJob,
  findExistingJob,
} from "@/features/jobs/services/job-record.service"
import { verifyApiToken } from "@/features/settings/services/api-token"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_MESSAGE,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

/**
 * `POST /api/extension/jobs` — the browser extension's one write endpoint.
 *
 * Authenticated with a personal API token (`Authorization: Bearer rspec_…`)
 * rather than the session cookie: the extension's fetch originates from
 * `chrome-extension://…`, which is a different origin and carries no cookie.
 * `/api/extension` is whitelisted in `src/proxy.ts` for the same reason.
 *
 * Jobs land as INTERESTED. `dateApplied` is not stamped here — that happens on
 * the transition to APPLIED, through the jobs server actions.
 */

const log = logger("extension-jobs")

/**
 * A date the *posting* published, not one the user typed: `datePosted` and
 * `validThrough` arrive from schema.org as either a bare calendar date or a full
 * timestamp, so both are accepted. A bare date is read as UTC midnight, matching
 * the app-wide convention that a calendar date is timezone-free.
 */
const postingDate = z
  .string()
  .trim()
  .max(40)
  .refine(
    (value) => !Number.isNaN(toPostingDate(value)?.getTime() ?? NaN),
    "Must be an ISO date or date-time"
  )
  .transform((value) => toPostingDate(value) as Date)

function toPostingDate(value: string): Date | null {
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const parsed = new Date(bare ? `${value}T00:00:00.000Z` : value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** A deadline is a day everywhere, so a timestamp is truncated to UTC midnight. */
const calendarDate = postingDate.transform(
  (value) =>
    new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
    )
)

/**
 * A subset of `createJobApplicationSchema`, with the same limits. Only the fields
 * an extension can actually scrape from a listing page; status is fixed server
 * side so a token cannot backdate an application into APPLIED.
 */
const extensionJobSchema = z.object({
  companyName: z.string().min(1, "Company name is required").max(200),
  jobTitle: z.string().min(1, "Job title is required").max(200),
  jobLink: z.string().url("Must be a valid URL").optional(),
  jobDescription: z.string().max(20000).optional(),
  location: z.string().max(200).optional(),
  salary: z.coerce.number().int().positive().optional(),
  salaryPeriod: z.nativeEnum(SalaryPeriod).optional(),
  salaryCurrency: z.nativeEnum(SalaryCurrency).optional(),
  jobType: z.nativeEnum(JobType).optional(),
  workType: z.nativeEnum(WorkType).optional(),
  postedAt: postingDate.optional(),
  deadline: calendarDate.optional(),
})

/**
 * The `qualification` block of the 201 body. A fixed wire contract the extension
 * is built against, so it is spelled out here rather than leaking the internal
 * `Qualification` type: levels are the internal step signals verbatim
 * (GOOD/NEUTRAL/CONCERN/BLOCKER, and LOW/MEDIUM/HIGH for risk).
 */
interface QualificationWire {
  verdict: string
  nextAction: string
  worthIt: { level: string; reasons: string[] }
  eligible: { level: string; reasons: string[] }
  match: { level: string; matchedCapabilities: string[]; confirmedCount: number }
  risk: { level: string; reasons: string[] }
}

/**
 * The `marketFit` block of the 201 body: where this posting is open, relative to
 * the market the user's Career Profile resolves to. Taken from the same single
 * qualification pass as the verdict — never recomputed, so the chip and the
 * stored snapshot can never disagree.
 */
interface MarketFitWire {
  fit: string
  label: string
  reason: string
}

/**
 * The `confidence` block of the 201 body: the read-time Opportunity Confidence.
 * Deliberately separate from the qualification — `Profile Match = does this fit
 * me?` / `Opportunity Confidence = is this posting worth my time?` — and, like
 * everywhere else in the app, computed at read time and never stored.
 */
interface ConfidenceWire {
  level: OpportunityConfidenceLevel
  summary: string
}

/**
 * The same deterministic pass discovery runs, applied to a clipped posting.
 *
 * Read narrowly rather than through `loadCareerProfile`: that helper creates the
 * profile row lazily, and a clip must not be the thing that creates one. No
 * profile row means no qualification — there is nothing to qualify against.
 *
 * Returns null on anything unexpected. Like risk and requirements, this is a
 * bonus on top of a saved clip and may never cost the user the save.
 *
 * Returns the internal `Qualification` rather than the wire shape because the
 * same single pass feeds two consumers: the 201 body the extension reads, and
 * the snapshot stored on the posting so `/jobs/[id]` can show the same answer.
 */
async function qualifyClip(
  userId: string,
  posting: QualificationPosting
): Promise<Qualification | null> {
  const profileRow = await prisma.careerProfile.findUnique({
    where: { userId },
    select: {
      locations: true,
      openToRelocation: true,
      workModes: true,
      requiresSponsorship: true,
      experienceLevel: true,
      targetRoles: { select: { title: true, active: true } },
      capabilities: { select: { name: true, confirmed: true } },
    },
  })
  if (!profileRow) return null

  return qualifyCandidate(posting, toQualificationProfile(profileRow))
}

/** Flattens a qualification into the fixed 201 wire contract above. */
function toQualificationWire(qualification: Qualification): QualificationWire {
  return {
    verdict: qualification.verdict,
    nextAction: qualification.nextAction,
    worthIt: {
      level: qualification.worthIt.signal,
      reasons: qualification.worthIt.reasons ?? [],
    },
    eligible: {
      level: qualification.eligible.signal,
      reasons: qualification.eligible.reasons ?? [],
    },
    match: {
      level: qualification.match.signal,
      matchedCapabilities: qualification.match.matched ?? [],
      confirmedCount: qualification.match.confirmedCount,
    },
    risk: {
      // `level` is null when the heuristics had nothing to score; the step's own
      // signal (NEUTRAL) says the same thing without inventing a risk band.
      level: qualification.risk.level ?? qualification.risk.signal,
      reasons: qualification.risk.reasons ?? [],
    },
  }
}

/**
 * CORS is granted to extension origins only. A page on the open web must not be
 * able to read a response from this endpoint, so `Access-Control-Allow-Origin` is
 * reflected only for `chrome-extension://` and `moz-extension://` — never `*`,
 * and never an arbitrary reflected origin.
 */
function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    // The allowed origin varies per request, so caches must not share a response.
    Vary: "Origin",
  }

  if (origin && (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://"))) {
    headers["Access-Control-Allow-Origin"] = origin
  }

  return headers
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  })
}

export async function POST(req: Request) {
  // The preflight headers have to be on the real response too — the browser
  // checks them again before handing the body to the extension.
  const cors = corsHeaders(req.headers.get("origin"))

  const authorization = req.headers.get("authorization") ?? ""
  const rawToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : ""

  const userId = rawToken ? await verifyApiToken(rawToken) : null
  if (!userId) {
    return NextResponse.json(
      { error: "Invalid or missing API token", code: "UNAUTHORIZED" },
      { status: 401, headers: cors }
    )
  }

  const jobsAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.EXTENSION_JOBS,
    userId,
    EXTENSION_JOBS_RATE_LIMIT
  )
  if (!jobsAllowed) {
    return NextResponse.json(
      { error: RATE_LIMIT_MESSAGE, code: "RATE_LIMITED" },
      { status: 429, headers: cors }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON", code: "VALIDATION" },
      { status: 400, headers: cors }
    )
  }

  const parsed = extensionJobSchema.safeParse(body)
  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    const message =
      Object.entries(flattened.fieldErrors)
        .map(([field, errors]) => `${field}: ${errors?.[0]}`)
        .join("; ") ||
      flattened.formErrors[0] ||
      "Invalid input"

    return NextResponse.json({ error: message, code: "VALIDATION" }, { status: 400, headers: cors })
  }

  // Best-effort, like the scraped questions below: a scam flag never costs the
  // extension a clip it otherwise saved.
  let risk: ReturnType<typeof assessJobRiskHeuristics> = null
  try {
    risk = assessJobRiskHeuristics({
      jobTitle: parsed.data.jobTitle,
      companyName: parsed.data.companyName,
      jobDescription: parsed.data.jobDescription,
      salary: parsed.data.salary,
      salaryPeriod: parsed.data.salaryPeriod,
      jobLink: parsed.data.jobLink,
      location: parsed.data.location,
    })
  } catch (err) {
    log.warn("Failed to assess job risk heuristics", { err, userId })
  }

  // Same best-effort contract: eligibility badges never cost the clip.
  let requirementFlags: string[] = []
  try {
    requirementFlags = extractJobRequirements({
      jobDescription: parsed.data.jobDescription,
      location: parsed.data.location,
    })
  } catch (err) {
    log.warn("Failed to extract job requirements", { err, userId })
  }

  // Re-clipping a tab the user already saved should land them on the job they
  // have, not on a second copy of it. Matched on the canonical URL so a link
  // that picked up campaign params on the way still recognises itself.
  const canonicalUrl = canonicalizeUrl(parsed.data.jobLink)
  if (parsed.data.jobLink) {
    try {
      const existing = await findExistingJob({
        userId,
        canonicalUrl,
        url: parsed.data.jobLink,
      })
      if (existing?.applicationId) {
        log.info("Extension clip matched an existing job", {
          userId,
          jobId: existing.applicationId,
        })
        return NextResponse.json(
          { id: existing.applicationId, duplicate: true },
          { status: 200, headers: cors }
        )
      }
    } catch (err) {
      // Only a fast path — the unique key on `Job` still decides the outcome,
      // and a lost race resolves onto the existing clip rather than failing.
      log.warn("Duplicate check failed for an extension clip", { err, userId })
    }
  }

  // Run before the create, not after it: the snapshot rides along in the
  // posting's own INSERT, so it has to exist by then. One pass still feeds both
  // consumers — the 201 wire block and the stored snapshot. Best-effort, same
  // contract as risk and requirements above: a missing profile or a failed pass
  // costs the badge and the stored reasoning, never the clip.
  let qualification: QualificationWire | null = null
  let marketFit: MarketFitWire | null = null
  let snapshot: StoredQualification | null = null
  try {
    const assessed = await qualifyClip(userId, {
      title: parsed.data.jobTitle,
      companyName: parsed.data.companyName,
      url: parsed.data.jobLink ?? "",
      ...(parsed.data.location && { location: parsed.data.location }),
      ...(parsed.data.workType && { workType: parsed.data.workType }),
      ...(parsed.data.jobDescription && { description: parsed.data.jobDescription }),
    })
    if (assessed) {
      qualification = toQualificationWire(assessed)
      marketFit = {
        fit: assessed.marketFit.fit,
        label: assessed.marketFit.label,
        reason: assessed.marketFit.reason,
      }
      snapshot = toStoredQualification(assessed)
    }
  } catch (err) {
    log.warn("Failed to qualify an extension clip", { err, userId })
  }

  // Read-time, never stored: the same assessment `/jobs` and the dashboard run,
  // computed here only so the panel can show it next to the verdict. Best-effort
  // like everything else on this response — a chip never costs the clip.
  let confidence: ConfidenceWire | null = null
  try {
    const assessedConfidence = assessOpportunityConfidence({
      provider: null,
      source: "EXTENSION",
      url: canonicalUrl ?? parsed.data.jobLink ?? null,
      postedAt: parsed.data.postedAt ?? null,
      createdAt: new Date(),
      companyName: parsed.data.companyName,
      description: parsed.data.jobDescription ?? null,
    })
    confidence = {
      level: assessedConfidence.level,
      summary: assessedConfidence.summary,
    }
  } catch (err) {
    log.warn("Failed to assess opportunity confidence for an extension clip", { err, userId })
  }

  try {
    const job = await createJobApplicationWithJob({
      ...parsed.data,
      userId,
      status: "INTERESTED",
      source: "EXTENSION" as const,
      ...(canonicalUrl && { canonicalUrl }),
      // Same snapshot the discovery save writes, so a clipped job answers "why
      // is this relevant?" on `/jobs/[id]` exactly like a discovered one. A
      // declared interface has no index signature, which is all
      // `InputJsonValue` is missing — the value itself is plain JSON.
      ...(snapshot && { qualification: snapshot as unknown as Prisma.InputJsonValue }),
      ...(risk && {
        riskLevel: risk.level,
        riskReasons: risk.reasons,
        riskSource: "HEURISTIC" as const,
        riskCheckedAt: new Date(),
      }),
      ...(requirementFlags.length > 0 && { requirementFlags }),
    })

    // Best-effort: questions the posting already asks are a bonus, never a
    // reason to fail (or retry) a clip that was saved successfully.
    if (parsed.data.jobDescription) {
      const questions = extractEmployerQuestions(parsed.data.jobDescription)
      if (questions.length > 0) {
        try {
          await prisma.interviewQuestion.createMany({
            data: questions.map((question) => ({
              jobApplicationId: job.id,
              question,
              source: "SCRAPED" as const,
            })),
          })
        } catch (err) {
          log.warn("Failed to store scraped interview questions", { err, jobId: job.id })
        }
      }
    }

    if (job.duplicate) {
      // The pre-check missed it, so a concurrent clip won the unique key. Same
      // answer as the pre-check path: the clip the user already has.
      log.info("Extension clip lost a race and resolved to an existing job", {
        userId,
        jobId: job.id,
      })
      return NextResponse.json({ id: job.id, duplicate: true }, { status: 200, headers: cors })
    }

    log.info("Created job application from extension", { userId, jobId: job.id })

    // `risk` and `requirements` are omitted entirely when nothing fired — the
    // extension reads them defensively, so an absent key means "nothing to show".
    return NextResponse.json(
      {
        id: job.id,
        ...(risk && { risk: { level: risk.level, reasons: risk.reasons } }),
        ...(requirementFlags.length > 0 && { requirements: requirementFlags }),
        ...(qualification && { qualification }),
        ...(marketFit && { marketFit }),
        ...(confidence && { confidence }),
      },
      { status: 201, headers: cors }
    )
  } catch (err) {
    // Not in the four documented statuses, but a database failure is not the
    // client's fault and must not be reported as a validation error — a 4xx would
    // make the extension discard a job it could have retried.
    log.error("Failed to create job application", { err, userId })
    return NextResponse.json(
      { error: "Could not save the job", code: "SERVER_ERROR" },
      { status: 500, headers: cors }
    )
  }
}
