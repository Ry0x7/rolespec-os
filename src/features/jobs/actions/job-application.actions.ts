"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import {
  ApplicationStatus,
  InterviewQuestionSource,
  JobRiskSource,
} from "@/generated/prisma/enums"
import { Prisma } from "@/generated/prisma/client"
import {
  BULK_DELETE_MAX_IDS,
  createJobApplicationWithJob,
  deleteJobApplicationsWithJobs,
  deleteJobApplicationWithJob,
  findExistingJob,
  findSimilarJob,
  isCanonicalUrlConflict,
  updateJobApplicationWithJob,
  type ExistingJobMatch,
} from "@/features/jobs/services/job-record.service"
import { canonicalizeUrl } from "@/features/discovery/services/normalize.service"
import { auth } from "@/features/auth/config"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import {
  addCalendarDays,
  calendarDayStart,
  parseCalendarDate,
} from "@/shared/lib/dates"
import { extractEmployerQuestions } from "../services/interview-questions.service"
import { extractJobRequirements } from "../services/job-requirements.service"
import { assessJobRiskHeuristics } from "../services/job-risk.service"
import { FOLLOW_UP_STATUSES } from "../services/follow-up.service"
import { isTerminalStatus } from "../services/outcome.service"
import { createJobApplicationSchema, updateJobApplicationSchema } from "../schemas/job-application.schema"

const log = logger("job-application-actions")

/**
 * The day the user is having, as a calendar date (UTC midnight of their local
 * Y-M-D). Client callers pass their own `YYYY-MM-DD`; anything absent or forged
 * falls back to the server's UTC day rather than failing the action, because a
 * date being a day off is never worth refusing to record the application.
 */
function resolveClientToday(clientToday?: string): Date {
  return parseCalendarDate(clientToday) ?? calendarDayStart(new Date())
}

/** The posting a duplicate notice points at, in the tracker's own vocabulary. */
export interface ExistingApplicationRef {
  jobId: string
  /** Null only for a posting whose application has since been deleted. */
  applicationId: string | null
  companyName: string
  title: string
}

/**
 * A create refused because the user already tracks this posting.
 *
 * Shaped as the action's existing `{ error }` failure so every current caller
 * keeps working unchanged; `code` and `existing` are what a caller that wants to
 * render the richer notice reads. `DUPLICATE` is decided by the posting URL and
 * cannot be overruled — the `(userId, canonicalUrl)` key would reject the write
 * anyway. `POSSIBLE_DUPLICATE` is a name match only, so `force` skips it.
 */
export interface DuplicateJobApplicationResult {
  error: string
  code: "DUPLICATE" | "POSSIBLE_DUPLICATE"
  existing: ExistingApplicationRef
}

const DUPLICATE_MESSAGE = "You already track this posting."
const POSSIBLE_DUPLICATE_MESSAGE =
  "You may already track this application at the same company."

function duplicateResult(
  code: DuplicateJobApplicationResult["code"],
  existing: ExistingApplicationRef
): DuplicateJobApplicationResult {
  return {
    error: code === "DUPLICATE" ? DUPLICATE_MESSAGE : POSSIBLE_DUPLICATE_MESSAGE,
    code,
    existing,
  }
}

/** Names a posting the caller only knows the id of, for the notice. */
async function describeJob(
  userId: string,
  jobId: string
): Promise<{ companyName: string; title: string } | null> {
  return prisma.job.findFirst({
    where: { id: jobId, userId },
    select: { companyName: true, title: true },
  })
}

/** Turns a matched posting into the notice, or null when it cannot be named. */
async function describeMatch(
  userId: string,
  match: ExistingJobMatch
): Promise<DuplicateJobApplicationResult | null> {
  const named = await describeJob(userId, match.jobId)
  if (!named) return null
  return duplicateResult("DUPLICATE", { ...match, ...named })
}

/**
 * Names the posting a `(userId, canonicalUrl)` violation collided with, so a
 * refused edit can say which application already holds that link. Null when the
 * colliding row cannot be found or named.
 */
async function describeCanonicalConflict(
  userId: string,
  canonicalUrl: string
): Promise<DuplicateJobApplicationResult | null> {
  if (!canonicalUrl) return null

  const existing = await findExistingJob({ userId, canonicalUrl })
  if (!existing) return null

  return describeMatch(userId, existing)
}

/**
 * The edit path's own duplicate check, run before the write for the same reason
 * the create path runs one: the unique key only fires when the two links
 * normalize to the same string, and a link that merely *matches an existing
 * posting's raw url* would otherwise be written happily.
 *
 * The posting being edited is not a duplicate of itself, so only a match on a
 * different `Job` counts. Best-effort: a failed lookup leaves the P2002 catch
 * as the backstop rather than costing the user their edit.
 */
async function findEditDuplicate(input: {
  userId: string
  jobId: string
  jobLink: string | null
  canonicalUrl: string
}): Promise<DuplicateJobApplicationResult | null> {
  if (!input.canonicalUrl && !input.jobLink) return null

  try {
    const match = await findExistingJob({
      userId: input.userId,
      canonicalUrl: input.canonicalUrl || null,
      url: input.jobLink,
    })
    if (!match || match.jobId === input.jobId) return null
    return await describeMatch(input.userId, match)
  } catch (err) {
    log.warn("Duplicate check failed before an edit", { err })
    return null
  }
}

/**
 * The manual path's own duplicate check, run before the write rather than left
 * to the unique key: a user adding a job by hand should be told they already
 * have it, not handed a second row or a constraint error.
 *
 * Best-effort throughout, the same contract discovery uses — a failed lookup
 * costs the warning only, never the create, because `(userId, canonicalUrl)`
 * still decides the URL case at write time.
 */
async function findManualDuplicate(input: {
  userId: string
  canonicalUrl: string
  jobLink: string | null
  companyName: string
  jobTitle: string
  force: boolean
}): Promise<DuplicateJobApplicationResult | null> {
  if (input.canonicalUrl || input.jobLink) {
    try {
      const existing = await findExistingJob({
        userId: input.userId,
        canonicalUrl: input.canonicalUrl || null,
        url: input.jobLink,
      })
      // A posting whose application is gone is not something to send the user
      // to: the create below resolves onto it and reuses the row instead.
      if (existing?.applicationId) {
        const named = await describeJob(input.userId, existing.jobId)
        return duplicateResult("DUPLICATE", {
          ...existing,
          companyName: named?.companyName ?? input.companyName,
          title: named?.title ?? input.jobTitle,
        })
      }
    } catch (err) {
      log.warn("Duplicate check failed before a manual create", { err })
    }
  }

  if (input.force) return null

  try {
    const similar = await findSimilarJob({
      userId: input.userId,
      companyName: input.companyName,
      title: input.jobTitle,
    })
    if (similar) return duplicateResult("POSSIBLE_DUPLICATE", similar)
  } catch (err) {
    log.warn("Similar-posting check failed before a manual create", { err })
  }

  return null
}

export async function createJobApplication(
  formData: FormData,
  /** Set once the user has seen a `POSSIBLE_DUPLICATE` notice and meant it. */
  options?: { force?: boolean }
) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const raw = Object.fromEntries(formData)
  const parsed = createJobApplicationSchema.safeParse(raw)
  if (!parsed.success) return { error: "Invalid input", details: parsed.error.flatten() }

  const {
    dateApplied,
    deadline,
    interviewDate,
    followUpAt,
    jobLink,
    salary,
    salaryPeriod,
    salaryCurrency,
    clientToday,
    ...rest
  } = parsed.data

  // The same normalization discovery and the extension store, so a job added by
  // hand and the same job clipped later land on one `(userId, canonicalUrl)`
  // row instead of two. Empty for a missing or non-http(s) link, which leaves
  // the posting exactly as it was written before: `canonicalUrl` null.
  const canonicalUrl = canonicalizeUrl(jobLink)

  const duplicate = await findManualDuplicate({
    userId: session.user.id,
    canonicalUrl,
    jobLink: jobLink || null,
    companyName: rest.companyName,
    jobTitle: rest.jobTitle,
    force: options?.force ?? false,
  })
  if (duplicate) return duplicate

  // Best-effort, same convention as the scraped questions below: a scam flag is
  // a bonus on top of the create, never a reason to fail one.
  let risk: ReturnType<typeof assessJobRiskHeuristics> = null
  try {
    risk = assessJobRiskHeuristics({
      jobTitle: rest.jobTitle,
      companyName: rest.companyName,
      jobDescription: rest.jobDescription,
      salary: salary ?? null,
      salaryPeriod: salaryPeriod ?? null,
      jobLink: jobLink || null,
      contact: rest.contact,
      location: rest.location,
    })
  } catch (err) {
    log.warn("Failed to assess job risk heuristics", { err })
  }

  // Same best-effort contract: eligibility badges are a bonus on the create.
  let requirementFlags: string[] = []
  try {
    requirementFlags = extractJobRequirements({
      jobDescription: rest.jobDescription,
      location: rest.location,
    })
  } catch (err) {
    log.warn("Failed to extract job requirements", { err })
  }

  try {
    const application = await createJobApplicationWithJob({
      userId: session.user.id,
      ...rest,
      ...(risk && {
        riskLevel: risk.level,
        riskReasons: risk.reasons,
        riskSource: JobRiskSource.HEURISTIC,
        riskCheckedAt: new Date(),
      }),
      ...(requirementFlags.length > 0 && { requirementFlags }),
      // A create that lands directly on a terminal status (OFFER/REJECTED/
      // WITHDRAWN) never goes through `updateJobApplicationStatus`, so this is
      // the only place that transition gets stamped. Same `clientToday`
      // convention as that action: the caller's own calendar day, falling back
      // to the server's UTC day.
      ...(isTerminalStatus(rest.status) && {
        outcomeAt: resolveClientToday(clientToday),
      }),
      jobLink: jobLink || null,
      ...(canonicalUrl && { canonicalUrl }),
      salary: salary ?? null,
      salaryPeriod: salaryPeriod ?? null,
      // Non-null column: leave it undefined so the schema default (USD) applies.
      salaryCurrency: salaryCurrency ?? undefined,
      // Quick add has no date field: an application created straight into
      // APPLIED still has to count toward the goal / "applied today". Clients
      // that know their own calendar day send it as `dateApplied`; otherwise
      // the same `clientToday` convention as `outcomeAt` above decides the day,
      // falling back to the server's UTC day only when nothing was sent.
      dateApplied: dateApplied
        ? new Date(dateApplied)
        : rest.status === ApplicationStatus.APPLIED
          ? resolveClientToday(clientToday)
          : null,
      deadline: deadline ? new Date(deadline) : null,
      interviewDate: interviewDate ? new Date(interviewDate) : null,
      followUpAt: followUpAt ? new Date(followUpAt) : null,
    })

    // The unique key caught what the pre-check did not (a lookup that failed, or
    // a save that raced this one): nothing was created, so the user gets the
    // same notice rather than a success toast for a row they already had.
    if (application.duplicate) {
      const existing = await findExistingJob({
        userId: session.user.id,
        canonicalUrl: canonicalUrl || null,
      })
      if (existing) {
        const named = await describeJob(session.user.id, existing.jobId)
        return duplicateResult("DUPLICATE", {
          ...existing,
          companyName: named?.companyName ?? rest.companyName,
          title: named?.title ?? rest.jobTitle,
        })
      }
    }

    // Best-effort: questions the posting already asks are a bonus, never a
    // reason to fail a create the user just completed.
    if (rest.jobDescription) {
      const questions = extractEmployerQuestions(rest.jobDescription)
      if (questions.length > 0) {
        try {
          await prisma.interviewQuestion.createMany({
            data: questions.map((question) => ({
              jobApplicationId: application.id,
              question,
              source: InterviewQuestionSource.SCRAPED,
            })),
          })
        } catch (err) {
          log.warn("Failed to store scraped interview questions", {
            err,
            jobId: application.id,
          })
        }
      }
    }

    revalidatePath("/jobs")
    revalidatePath("/workspace")
    return { success: true as const, id: application.id }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function updateJobApplication(id: string, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const existing = await prisma.jobApplication.findUnique({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        jobId: true,
        // The scan inputs describe the posting, so they come off `job` now.
        job: { select: { description: true, location: true } },
      },
    })
    if (!existing) return { error: "Not found" }

    const existingJobDescription = existing.job.description
    const existingLocation = existing.job.location

    const raw = Object.fromEntries(formData)
    const parsed = updateJobApplicationSchema.safeParse(raw)
    if (!parsed.success) return { error: "Invalid input", details: parsed.error.flatten() }

    const {
      dateApplied,
      deadline,
      interviewDate,
      followUpAt,
      jobLink,
      salary,
      salaryPeriod,
      salaryCurrency,
      jobType,
      workType,
      location,
      contact,
      notes,
      ...rest
    } = parsed.data

    // An edited link that already belongs to another of this user's postings is
    // refused before anything is written — the unique key alone would only
    // catch it when the two links normalize identically.
    const editCanonicalUrl = canonicalizeUrl(jobLink)
    if (jobLink !== undefined) {
      const duplicate = await findEditDuplicate({
        userId: session.user.id,
        jobId: existing.jobId,
        jobLink: jobLink || null,
        canonicalUrl: editCanonicalUrl,
      })
      if (duplicate) return duplicate
    }

    // Only the description and the location feed the requirement scan, so the
    // flags are recomputed only when one of them actually moved. Best-effort as
    // on the create path: a throw here must not cost the user their edit.
    const nextJobDescription =
      rest.jobDescription !== undefined ? rest.jobDescription : existingJobDescription
    const nextLocation = location !== undefined ? location || null : existingLocation
    const requirementsChanged =
      nextJobDescription !== existingJobDescription || nextLocation !== existingLocation

    let requirementFlags: string[] | null = null
    if (requirementsChanged) {
      try {
        requirementFlags = extractJobRequirements({
          jobDescription: nextJobDescription,
          location: nextLocation,
        })
      } catch (err) {
        log.warn("Failed to extract job requirements", { err, jobId: id })
      }
    }

    // The paired write sends the posting half of the edit to the `Job` row and
    // the decision half to the application; the mirrored columns are no longer
    // written at all. An edited link carries the dedupe key with it, so the edit
    // can now land on a `(userId, canonicalUrl)` the user already holds: that is
    // the same "you already track this" the create path reports, not a failure.
    const write = updateJobApplicationWithJob(
      { id, userId: session.user.id },
      {
        ...rest,
        // `DbNull` (not `null`, which Prisma reads as JSON null) clears the
        // column when a rescan found nothing, so a posting edited to drop its
        // restrictions loses the badges too.
        ...(requirementFlags !== null
          ? {
              requirementFlags:
                requirementFlags.length > 0 ? requirementFlags : Prisma.DbNull,
            }
          : {}),
        // Clearing an optional text cell means null, not "".
        ...(location !== undefined ? { location: location || null } : {}),
        ...(contact !== undefined ? { contact: contact || null } : {}),
        ...(notes !== undefined ? { notes: notes || null } : {}),
        ...(jobLink !== undefined ? { jobLink: jobLink || null } : {}),
        ...(jobType !== undefined ? { jobType: jobType || null } : {}),
        ...(workType !== undefined ? { workType: workType || null } : {}),
        ...(salary !== undefined ? { salary: salary === "" ? null : salary } : {}),
        ...(salaryPeriod !== undefined ? { salaryPeriod: salaryPeriod || null } : {}),
        // "" is not a clear here — the column cannot be null, so it means no change.
        ...(salaryCurrency ? { salaryCurrency } : {}),
        ...(dateApplied !== undefined ? { dateApplied: dateApplied ? new Date(dateApplied) : null } : {}),
        ...(deadline !== undefined ? { deadline: deadline ? new Date(deadline) : null } : {}),
        ...(interviewDate !== undefined ? { interviewDate: interviewDate ? new Date(interviewDate) : null } : {}),
        ...(followUpAt !== undefined ? { followUpAt: followUpAt ? new Date(followUpAt) : null } : {}),
      }
    )

    try {
      await write
    } catch (err) {
      if (!isCanonicalUrlConflict(err)) throw err
      const duplicate = await describeCanonicalConflict(
        session.user.id,
        editCanonicalUrl
      )
      // Nothing to name the conflict after means the row it collided with is
      // already gone; the generic failure below is then the honest answer.
      if (!duplicate) throw err
      return duplicate
    }

    revalidatePath("/jobs")
    revalidatePath(`/jobs/${id}`)
    revalidatePath("/workspace")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function deleteJobApplication(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const existing = await prisma.jobApplication.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!existing) return { error: "Not found" }

    // Takes the posting with it when this was the last application on it.
    await deleteJobApplicationWithJob({ id, userId: session.user.id })
    revalidatePath("/jobs")
    revalidatePath("/workspace")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

/**
 * Deletes several of the caller's applications in one go, each taking its
 * posting with it when it was the last application on it. Ids that are not the
 * caller's are never touched; they come back in `skippedIds` instead of failing
 * the whole call, so a stale selection still deletes what it can.
 */
export async function deleteJobApplications(ids: string[]) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = z
    .array(z.string().min(1))
    .min(1)
    .max(BULK_DELETE_MAX_IDS)
    .safeParse(ids)
  if (!parsed.success) return { error: "Invalid selection" }

  try {
    const { deletedCount, skippedIds } = await deleteJobApplicationsWithJobs(
      session.user.id,
      parsed.data
    )
    revalidatePath("/jobs")
    revalidatePath("/workspace")
    return { success: true as const, deletedCount, skippedIds }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

/**
 * Records which resume this application is submitted with. Both rows are read
 * back under the session user before the write: an id from someone else's
 * account must not be linkable, and the composite FK behind `resumeId` would
 * only reject it after the fact.
 *
 * `resumeId: null` clears the choice.
 */
export async function selectJobApplicationResume(
  id: string,
  resumeId: string | null
) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const application = await prisma.jobApplication.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!application) return { error: "Not found" }

    if (resumeId) {
      const resume = await prisma.resume.findUnique({
        where: { id: resumeId, userId: session.user.id },
        select: { id: true },
      })
      if (!resume) return { error: "Resume not found" }
    }

    await prisma.jobApplication.update({
      where: { id },
      data: { resumeId },
    })

    revalidatePath("/jobs")
    revalidatePath(`/jobs/${id}`)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

/** A follow-up is a week out by default — long enough to be polite, short enough to matter. */
const FOLLOW_UP_DAYS = 7

/**
 * Schedules the nudge for an application that has already gone out. Only the
 * post-send statuses get one: there is nothing to chase on a job still sitting
 * at INTERESTED, and a closed application is closed.
 *
 * `clientToday` is the caller's own calendar day (`YYYY-MM-DD`). The server can
 * be in any timezone — on Vercel it is UTC — so "a week from today" has to be
 * counted from the day the *user* is having, or the stored date is off by one
 * for anyone east of Greenwich in the evening. An absent or malformed value
 * falls back to the UTC day.
 */
export async function scheduleJobApplicationFollowUp(id: string, clientToday?: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const existing = await prisma.jobApplication.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true, status: true },
    })
    if (!existing) return { error: "Not found" }
    if (!FOLLOW_UP_STATUSES.includes(existing.status)) {
      return { error: "This application is not waiting on a reply" }
    }

    // A calendar date, not an instant: the field is edited through an
    // `<input type="date">` and rendered without a clock, so it is stored as the
    // UTC midnight of the day the user should chase.
    const followUpAt = addCalendarDays(resolveClientToday(clientToday), FOLLOW_UP_DAYS)

    await prisma.jobApplication.update({
      where: { id },
      data: { followUpAt },
    })

    revalidatePath("/jobs")
    revalidatePath(`/jobs/${id}`)
    revalidatePath("/workspace")
    revalidatePath("/planner")
    revalidatePath("/dashboard")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

/**
 * Pushes an existing nudge a week further out.
 *
 * The counterpart to "Done" on a chase the user is not ready to make: clearing
 * it would drop the application off both the overdue list and the dashboard for
 * good, which is not the same answer as "not yet". Counted from the later of
 * today and the stored day, so snoozing an overdue chase lands a week from now
 * rather than a week from a date that has already gone, and snoozing one that
 * is still ahead adds a week to it.
 *
 * `clientToday` follows the same convention as `scheduleJobApplicationFollowUp`:
 * the caller's own calendar day, because the server may be in another timezone.
 */
export async function snoozeJobApplicationFollowUp(id: string, clientToday?: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const existing = await prisma.jobApplication.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true, status: true, followUpAt: true },
    })
    if (!existing) return { error: "Not found" }
    if (!FOLLOW_UP_STATUSES.includes(existing.status)) {
      return { error: "This application is not waiting on a reply" }
    }

    const today = resolveClientToday(clientToday)
    // A row with no follow-up yet behaves exactly like scheduling one, so the
    // action is safe to call from a stale render of a row that has since been
    // cleared elsewhere.
    const from =
      existing.followUpAt && existing.followUpAt.getTime() > today.getTime()
        ? existing.followUpAt
        : today

    await prisma.jobApplication.update({
      where: { id },
      data: { followUpAt: addCalendarDays(from, FOLLOW_UP_DAYS) },
    })

    revalidatePath("/jobs")
    revalidatePath(`/jobs/${id}`)
    revalidatePath("/workspace")
    revalidatePath("/planner")
    revalidatePath("/dashboard")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

/**
 * Clears the nudge once the user has actually followed up.
 *
 * The counterpart to scheduling: without it, a follow-up that has been done is
 * a permanent overdue badge on the job and a permanent nag on the dashboard,
 * both of which key off `followUpAt` alone. No status check here — chasing a
 * reply is something the user can finish at any point, including after the
 * application moved on.
 */
export async function clearJobApplicationFollowUp(id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const existing = await prisma.jobApplication.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!existing) return { error: "Not found" }

    await prisma.jobApplication.update({
      where: { id },
      data: { followUpAt: null, lastFollowedUpAt: new Date() },
    })

    revalidatePath("/jobs")
    revalidatePath(`/jobs/${id}`)
    revalidatePath("/workspace")
    revalidatePath("/planner")
    revalidatePath("/dashboard")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

export async function updateJobApplicationStatus(
  id: string,
  status: ApplicationStatus,
  clientToday?: string,
) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = z.nativeEnum(ApplicationStatus).safeParse(status)
  if (!parsed.success) return { error: "Invalid status" }

  try {
    const existing = await prisma.jobApplication.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true, status: true, dateApplied: true, outcomeAt: true },
    })
    if (!existing) return { error: "Not found" }

    const becameApplied =
      parsed.data === ApplicationStatus.APPLIED &&
      existing.status !== ApplicationStatus.APPLIED

    // Every status change in the app funnels through this action, so this is the
    // one place the end of an application can be dated without a modal getting
    // in the way of the move. The date follows the *current* outcome: a move
    // from REJECTED to OFFER re-stamps it, because "Decide on the offer —
    // received {rejection date}" is simply wrong. Re-saving the same status
    // writes nothing, and leaving a terminal status keeps the old date — the
    // history is the point.
    const enteredTerminal =
      isTerminalStatus(parsed.data) && parsed.data !== existing.status

    await prisma.jobApplication.update({
      where: { id },
      data: {
        status: parsed.data,
        ...(enteredTerminal ? { outcomeAt: resolveClientToday(clientToday) } : {}),
        // A finished application has nobody left to chase, so a pending
        // follow-up would only linger as a Done/Snooze the planner can't honour.
        ...(isTerminalStatus(parsed.data) ? { followUpAt: null } : {}),
        // The goal panel and the dashboard's "applied today" count `dateApplied`,
        // so the transition has to stamp it or those numbers never move. It is
        // stamped as the *client's* calendar day (see `resolveClientToday`):
        // stamping the server instant made a 07:00 application in UTC+8 land on
        // yesterday's date once `@db.Date` truncated it in UTC.
        ...(becameApplied && !existing.dateApplied
          ? { dateApplied: resolveClientToday(clientToday) }
          : {}),
      },
    })

    revalidatePath("/jobs")
    revalidatePath(`/jobs/${id}`)
    revalidatePath("/workspace")
    revalidatePath("/dashboard")
    revalidatePath("/planner")
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}

/** Long enough for what happened, short enough to stay a note and not a journal. */
const OUTCOME_NOTE_MAX_LENGTH = 2000

/**
 * Records the user's own account of how an application ended.
 *
 * Deliberately separate from the status move that stamps `outcomeAt`: the note
 * is optional, written afterwards, and an empty one is a valid answer — it
 * clears back to null rather than storing "". No status check, because a note
 * can be corrected at any point, including after the application is re-opened.
 */
export async function saveJobApplicationOutcomeNote(id: string, note: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = z.string().max(OUTCOME_NOTE_MAX_LENGTH).safeParse(note)
  if (!parsed.success) return { error: "That note is too long" }

  try {
    const existing = await prisma.jobApplication.findUnique({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!existing) return { error: "Not found" }

    const trimmed = parsed.data.trim()

    await prisma.jobApplication.update({
      where: { id },
      data: { outcomeNote: trimmed === "" ? null : trimmed },
    })

    revalidatePath("/jobs")
    revalidatePath(`/jobs/${id}`)
    return { success: true as const }
  } catch {
    return { error: "Something went wrong. Please try again." }
  }
}
