import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/shared/lib/prisma"
import { logger } from "@/shared/lib/logger"
import { canonicalizeUrl } from "@/features/discovery/services/normalize.service"

/**
 * The paired `Job` + `JobApplication` write, used by every ingest path (manual
 * entry, extension capture, discovery save).
 *
 * Step 4c of the Job/Application split: the mirrored posting columns are gone
 * from `JobApplication`, so `Job` is not just the only write target for posting
 * data, it is the only place it exists.
 *
 * Callers still hand this service one flat object holding both halves —
 * decision fields plus posting fields in the *application* vocabulary
 * (`jobTitle`, `jobLink`, `jobDescription`) they have always spoken. Splitting
 * that object across the two rows is this service's whole job, so the payload
 * shape is described here by {@link CreateJobApplicationInput} /
 * {@link UpdateJobApplicationInput} rather than by a Prisma model type.
 */

const log = logger("jobs")

/**
 * The posting fields a caller may put in an application-shaped payload, which
 * are routed to `Job` and stripped from the application half. Everything absent
 * from this list is decision-side (`status`, `contact`, `dateApplied`,
 * `interviewDate`, `notes`, the `match*` fields) and stays on the application.
 */
const POSTING_FIELDS = [
  "companyName",
  "jobTitle",
  "jobLink",
  "location",
  "jobType",
  "workType",
  "salary",
  "salaryPeriod",
  "salaryCurrency",
  "jobDescription",
  "deadline",
  "riskLevel",
  "riskReasons",
  "riskSource",
  "riskCheckedAt",
  "requirementFlags",
  "source",
  "sourceProvider",
  "externalId",
  "canonicalUrl",
  "discoveredAt",
  "postedAt",
  "qualification",
] as const

type PostingField = (typeof POSTING_FIELDS)[number]

/**
 * The posting half of a create payload, in application vocabulary. Each field
 * borrows its type from the `Job` column it lands on, so a schema change to the
 * posting cannot silently drift away from what callers are allowed to send.
 */
interface PostingCreateFields {
  companyName: Prisma.JobUncheckedCreateInput["companyName"]
  jobTitle: Prisma.JobUncheckedCreateInput["title"]
  jobLink?: Prisma.JobUncheckedCreateInput["url"]
  location?: Prisma.JobUncheckedCreateInput["location"]
  jobType?: Prisma.JobUncheckedCreateInput["jobType"]
  workType?: Prisma.JobUncheckedCreateInput["workType"]
  salary?: Prisma.JobUncheckedCreateInput["salary"]
  salaryPeriod?: Prisma.JobUncheckedCreateInput["salaryPeriod"]
  salaryCurrency?: Prisma.JobUncheckedCreateInput["salaryCurrency"]
  jobDescription?: Prisma.JobUncheckedCreateInput["description"]
  deadline?: Prisma.JobUncheckedCreateInput["deadline"]
  riskLevel?: Prisma.JobUncheckedCreateInput["riskLevel"]
  riskReasons?: Prisma.JobUncheckedCreateInput["riskReasons"]
  riskSource?: Prisma.JobUncheckedCreateInput["riskSource"]
  riskCheckedAt?: Prisma.JobUncheckedCreateInput["riskCheckedAt"]
  requirementFlags?: Prisma.JobUncheckedCreateInput["requirementFlags"]
  source?: Prisma.JobUncheckedCreateInput["source"]
  sourceProvider?: Prisma.JobUncheckedCreateInput["sourceProvider"]
  externalId?: Prisma.JobUncheckedCreateInput["externalId"]
  canonicalUrl?: Prisma.JobUncheckedCreateInput["canonicalUrl"]
  discoveredAt?: Prisma.JobUncheckedCreateInput["discoveredAt"]
  postedAt?: Prisma.JobUncheckedCreateInput["postedAt"]
  /**
   * The deterministic Career-Profile snapshot, taken by the ingest path before
   * it calls in so the posting is created already carrying its reasoning — a
   * crash after the create can no longer leave a permanently null snapshot.
   *
   * Typed as the column's own JSON input rather than the discovery type that
   * produces it: discovery imports this service, so the reverse import would
   * close a cycle. The shape is `StoredQualification`, cast at the call site.
   */
  qualification?: Prisma.JobUncheckedCreateInput["qualification"]
}

/**
 * What an ingest path hands {@link createJobApplicationWithJob}: the posting it
 * captured plus the user's decision fields, as one object. `jobId` is this
 * service's to assign — the posting does not exist until it creates it.
 */
export type CreateJobApplicationInput = Omit<
  Prisma.JobApplicationUncheckedCreateInput,
  "jobId"
> &
  PostingCreateFields

/** The posting half of an update payload, in application vocabulary. */
interface PostingUpdateFields {
  companyName?: Prisma.JobUncheckedUpdateInput["companyName"]
  jobTitle?: Prisma.JobUncheckedUpdateInput["title"]
  jobLink?: Prisma.JobUncheckedUpdateInput["url"]
  location?: Prisma.JobUncheckedUpdateInput["location"]
  jobType?: Prisma.JobUncheckedUpdateInput["jobType"]
  workType?: Prisma.JobUncheckedUpdateInput["workType"]
  salary?: Prisma.JobUncheckedUpdateInput["salary"]
  salaryPeriod?: Prisma.JobUncheckedUpdateInput["salaryPeriod"]
  salaryCurrency?: Prisma.JobUncheckedUpdateInput["salaryCurrency"]
  jobDescription?: Prisma.JobUncheckedUpdateInput["description"]
  deadline?: Prisma.JobUncheckedUpdateInput["deadline"]
  riskLevel?: Prisma.JobUncheckedUpdateInput["riskLevel"]
  riskReasons?: Prisma.JobUncheckedUpdateInput["riskReasons"]
  riskSource?: Prisma.JobUncheckedUpdateInput["riskSource"]
  riskCheckedAt?: Prisma.JobUncheckedUpdateInput["riskCheckedAt"]
  requirementFlags?: Prisma.JobUncheckedUpdateInput["requirementFlags"]
  /**
   * Re-running the deterministic Career-Profile check replaces the snapshot on
   * an existing posting, so this is an update field as well as a create one.
   * Same typing rule as the create side: the column's own JSON input, with the
   * `StoredQualification` shape cast at the call site.
   */
  qualification?: Prisma.JobUncheckedUpdateInput["qualification"]
}

/**
 * What an edit hands {@link updateJobApplicationWithJob}: decision fields and
 * posting fields together, exactly as the caller's form produced them.
 */
export type UpdateJobApplicationInput = Prisma.JobApplicationUncheckedUpdateInput &
  PostingUpdateFields

/** Strips the posting fields, leaving only what the application itself owns. */
function withoutPostingFields<T extends object>(data: T): Omit<T, PostingField> {
  const rest = { ...data }
  for (const field of POSTING_FIELDS) {
    delete (rest as Record<string, unknown>)[field]
  }
  return rest as Omit<T, PostingField>
}

/**
 * Projects an application's create input onto the posting row it describes.
 *
 * Deliberately a pure mapping with no defaults of its own: whatever the caller
 * decided the application should say about the posting is exactly what the
 * `Job` says, so the two rows cannot disagree.
 */
export function jobDataFromApplication(
  data: CreateJobApplicationInput
): Prisma.JobUncheckedCreateInput {
  return {
    userId: data.userId,
    companyName: data.companyName,
    title: data.jobTitle,
    url: data.jobLink ?? null,
    location: data.location ?? null,
    jobType: data.jobType ?? null,
    workType: data.workType ?? null,
    salary: data.salary ?? null,
    salaryPeriod: data.salaryPeriod ?? null,
    // Non-null column with a schema default: `undefined` keeps the default.
    salaryCurrency: data.salaryCurrency ?? undefined,
    description: data.jobDescription ?? null,
    deadline: data.deadline ?? null,
    riskLevel: data.riskLevel ?? null,
    riskReasons: data.riskReasons ?? Prisma.DbNull,
    riskSource: data.riskSource ?? null,
    riskCheckedAt: data.riskCheckedAt ?? null,
    requirementFlags: data.requirementFlags ?? Prisma.DbNull,
    source: data.source ?? undefined,
    sourceProvider: data.sourceProvider ?? null,
    externalId: data.externalId ?? null,
    canonicalUrl: data.canonicalUrl ?? null,
    discoveredAt: data.discoveredAt ?? null,
    postedAt: data.postedAt ?? null,
    qualification: data.qualification ?? Prisma.DbNull,
  }
}

/**
 * Projects an application's update input onto its posting row: only the
 * mirrored posting fields actually present in the update are carried across,
 * renamed onto the posting's own vocabulary. Explicit nulls and `Prisma.DbNull`
 * pass through unchanged — clearing a cell clears it on both rows. Fields that
 * describe the user's decision (status, notes, dates, match verdicts) never
 * touch the posting.
 */
export function jobUpdateFromApplicationUpdate(
  data: UpdateJobApplicationInput
): Prisma.JobUncheckedUpdateInput {
  const job: Prisma.JobUncheckedUpdateInput = {}
  if ("companyName" in data) job.companyName = data.companyName
  if ("jobTitle" in data) job.title = data.jobTitle
  if ("jobLink" in data) {
    job.url = data.jobLink
    // The dedupe key is derived from the link, so it moves with it: an edited
    // link that left `canonicalUrl` behind would dedupe against the old posting
    // forever. Cleared, or edited to something that is not an http(s) URL, it
    // goes back to null — the same "nothing to match on" state a manual entry
    // without a link has always had.
    job.canonicalUrl =
      (typeof data.jobLink === "string" ? canonicalizeUrl(data.jobLink) : "") || null
  }
  if ("location" in data) job.location = data.location
  if ("jobType" in data) job.jobType = data.jobType
  if ("workType" in data) job.workType = data.workType
  if ("salary" in data) job.salary = data.salary
  if ("salaryPeriod" in data) job.salaryPeriod = data.salaryPeriod
  if ("salaryCurrency" in data) job.salaryCurrency = data.salaryCurrency
  if ("jobDescription" in data) job.description = data.jobDescription
  if ("deadline" in data) job.deadline = data.deadline
  if ("riskLevel" in data) job.riskLevel = data.riskLevel
  if ("riskReasons" in data) job.riskReasons = data.riskReasons
  if ("riskSource" in data) job.riskSource = data.riskSource
  if ("riskCheckedAt" in data) job.riskCheckedAt = data.riskCheckedAt
  if ("requirementFlags" in data) job.requirementFlags = data.requirementFlags
  if ("qualification" in data) job.qualification = data.qualification
  return job
}

/**
 * The paired update, mirroring `createJobApplicationWithJob`: whatever an edit
 * says about the posting is written to the `Job` row in the same transaction,
 * so the posting never goes stale behind the application's mirrored columns.
 * Without this, readers could never move onto the `job` relation — an edited
 * title or a fresh risk verdict would only exist on the application.
 *
 * The posting fields are stripped from the application half: they only exist on
 * `Job` now. The application update still runs even when the strip leaves it
 * empty — it is the ownership check (a row belonging to someone else raises
 * P2025 exactly as before) and it is where `jobId` comes from, so skipping it
 * would cost a query and a guard to save nothing.
 */
export async function updateJobApplicationWithJob(
  where: { id: string; userId: string },
  data: UpdateJobApplicationInput
): Promise<void> {
  const jobData = jobUpdateFromApplicationUpdate(data)
  const applicationData = withoutPostingFields(data)

  await prisma.$transaction(async (tx) => {
    const application = await tx.jobApplication.update({
      where: { id: where.id, userId: where.userId },
      data: applicationData,
      select: { jobId: true },
    })
    if (Object.keys(jobData).length === 0) return
    await tx.job.update({
      where: { id: application.jobId, userId: where.userId },
      data: jobData,
    })
  })
}

/** The identifiers a posting can be recognised by, in order of authority. */
export interface JobDedupeKeys {
  userId: string
  /** Normalized posting URL. The unique key — the others are fallbacks. */
  canonicalUrl?: string | null
  /** The raw link, for postings saved before `canonicalUrl` existed. */
  url?: string | null
  sourceProvider?: string | null
  externalId?: string | null
}

/** An existing posting and the application the user is tracking it as. */
export interface ExistingJobMatch {
  jobId: string
  /** Null only for a posting whose application has since been deleted. */
  applicationId: string | null
}

function dedupeWhere(keys: JobDedupeKeys): Prisma.JobWhereInput | null {
  const or: Prisma.JobWhereInput[] = []
  if (keys.canonicalUrl) or.push({ canonicalUrl: keys.canonicalUrl })
  if (keys.url) or.push({ url: keys.url })
  if (keys.sourceProvider && keys.externalId) {
    or.push({ sourceProvider: keys.sourceProvider, externalId: keys.externalId })
  }
  if (or.length === 0) return null
  return { userId: keys.userId, OR: or }
}

/**
 * Answers "does this user already have this posting?" against `Job`, the row
 * that owns the dedupe keys, rather than against each ingest path's own copy of
 * the question.
 *
 * A posting with none of the keys populated (a manual entry with no link) is
 * never a duplicate of anything — there is nothing to match it on.
 */
export async function findExistingJob(keys: JobDedupeKeys): Promise<ExistingJobMatch | null> {
  const where = dedupeWhere(keys)
  if (!where) return null

  const job = await prisma.job.findFirst({
    where,
    select: {
      id: true,
      // Oldest first: the application the user has been tracking all along is
      // the one they expect a re-clip to land on.
      applications: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  })
  if (!job) return null

  return { jobId: job.id, applicationId: job.applications[0]?.id ?? null }
}

/** A posting matched by name alone, plus what to call it in the notice. */
export interface SimilarJobMatch extends ExistingJobMatch {
  companyName: string
  title: string
}

/**
 * Answers the weaker question "does this user already track a posting with this
 * company and title?", for entries that carry no link to dedupe on.
 *
 * Name equality is not identity — two openings at the same company can share a
 * title — so this is only ever a warning the user can overrule, never a block.
 * Only postings that still have an application are considered: there is nothing
 * to send the user to otherwise.
 */
export async function findSimilarJob(keys: {
  userId: string
  companyName: string
  title: string
}): Promise<SimilarJobMatch | null> {
  const job = await prisma.job.findFirst({
    where: {
      userId: keys.userId,
      companyName: { equals: keys.companyName, mode: "insensitive" },
      title: { equals: keys.title, mode: "insensitive" },
      applications: { some: {} },
    },
    select: {
      id: true,
      companyName: true,
      title: true,
      // Oldest first, same as `findExistingJob`: the application the user has
      // been tracking all along is the one they mean.
      applications: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  })
  if (!job) return null

  return {
    jobId: job.id,
    applicationId: job.applications[0]?.id ?? null,
    companyName: job.companyName,
    title: job.title,
  }
}

export interface CreateJobApplicationResult {
  /** The application id — newly created, or the existing one on a collision. */
  id: string
  /** True when the write lost a race and resolved onto an existing posting. */
  duplicate: boolean
}

/**
 * Creates an application together with the `Job` it is about, in one
 * transaction — an application must never exist without its posting.
 *
 * `(userId, canonicalUrl)` is unique, so two concurrent saves of the same tab
 * race here. The loser resolves onto the winner's posting instead of failing:
 * a user who clipped one job twice wants one job, not an error.
 */
export async function createJobApplicationWithJob(
  data: CreateJobApplicationInput,
  /** Internal: a resolved conflict is retried once, never in a loop. */
  retryOnVanishedConflict = true
): Promise<CreateJobApplicationResult> {
  try {
    const application = await prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: jobDataFromApplication(data),
        select: { id: true },
      })
      return tx.jobApplication.create({
        data: applicationCreateData(data, job.id),
        select: { id: true },
      })
    })
    return { id: application.id, duplicate: false }
  } catch (err) {
    if (!isCanonicalUrlConflict(err)) throw err

    const existing = await findExistingJob({
      userId: data.userId,
      canonicalUrl: data.canonicalUrl ?? null,
    })
    // The conflicting row must exist — it is what the constraint just rejected
    // against — but if it was deleted in between, the caller's save is still
    // valid, so retrying it beats reporting a duplicate that is no longer there.
    if (!existing) {
      if (!retryOnVanishedConflict) throw err
      log.warn("Canonical-URL conflict resolved to nothing; retrying the write", {
        userId: data.userId,
      })
      return createJobApplicationWithJob(data, false)
    }

    if (existing.applicationId) {
      return { id: existing.applicationId, duplicate: true }
    }

    // A posting with no application left: reuse it rather than orphaning a
    // second one behind a key that can never be written again.
    const application = await prisma.jobApplication.create({
      data: applicationCreateData(data, existing.jobId),
      select: { id: true },
    })
    return { id: application.id, duplicate: false }
  }
}

/**
 * The application half of a paired create: decision-side fields plus the link
 * to the posting. Every posting field the caller supplied has already gone to
 * the `Job` row via `jobDataFromApplication`.
 */
function applicationCreateData(
  data: CreateJobApplicationInput,
  jobId: string
): Prisma.JobApplicationUncheckedCreateInput {
  return { ...withoutPostingFields(data), jobId }
}

/**
 * Deletes an application and, when it was the last one pointing at its
 * posting, the posting too — otherwise every delete would leave an orphaned
 * `Job` behind, holding a `(userId, canonicalUrl)` the user can never save
 * again.
 *
 * A posting shared by another application survives: the `Job` is the user's
 * copy of the posting, not of this one application. The app→job FK is
 * ON DELETE RESTRICT, so the order matters — the application goes first, and
 * both writes share one transaction so a failed posting delete cannot leave
 * the application gone.
 */
export async function deleteJobApplicationWithJob(where: {
  id: string
  userId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const application = await tx.jobApplication.delete({
      where: { id: where.id, userId: where.userId },
      select: { jobId: true },
    })

    const remaining = await tx.jobApplication.count({
      where: { jobId: application.jobId, userId: where.userId },
    })
    if (remaining > 0) return

    await tx.job.delete({ where: { id: application.jobId, userId: where.userId } })
  })
}

/** The most applications one bulk delete may name. */
export const BULK_DELETE_MAX_IDS = 200

/**
 * Bulk form of {@link deleteJobApplicationWithJob}, with the same posting rule:
 * a `Job` goes only once no application of the user's points at it any more.
 *
 * Ownership is decided by the read, not trusted from the caller: only rows
 * matching both an id and `userId` are deleted, and every requested id that is
 * not one of them comes back in `skippedIds`. Everything runs in one
 * transaction, so a failed posting delete leaves every application in place.
 */
export async function deleteJobApplicationsWithJobs(
  userId: string,
  ids: string[]
): Promise<{ deletedCount: number; skippedIds: string[] }> {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length > BULK_DELETE_MAX_IDS) {
    throw new Error(
      `Cannot delete more than ${BULK_DELETE_MAX_IDS} applications at once (got ${uniqueIds.length})`
    )
  }
  if (uniqueIds.length === 0) return { deletedCount: 0, skippedIds: [] }

  return prisma.$transaction(async (tx) => {
    const owned = await tx.jobApplication.findMany({
      where: { id: { in: uniqueIds }, userId },
      select: { id: true, jobId: true },
    })
    const ownedIds = new Set(owned.map((application) => application.id))
    const skippedIds = uniqueIds.filter((id) => !ownedIds.has(id))
    if (owned.length === 0) return { deletedCount: 0, skippedIds }

    // Applications first: the app→job FK is ON DELETE RESTRICT.
    const { count } = await tx.jobApplication.deleteMany({
      where: { id: { in: [...ownedIds] }, userId },
    })

    const jobIds = [...new Set(owned.map((application) => application.jobId))]
    const stillReferenced = await tx.jobApplication.findMany({
      where: { jobId: { in: jobIds }, userId },
      select: { jobId: true },
    })
    const keep = new Set(stillReferenced.map((application) => application.jobId))
    const orphanedJobIds = jobIds.filter((jobId) => !keep.has(jobId))
    if (orphanedJobIds.length > 0) {
      await tx.job.deleteMany({ where: { id: { in: orphanedJobIds }, userId } })
    }

    return { deletedCount: count, skippedIds }
  })
}

/**
 * True for a unique violation on the `(userId, canonicalUrl)` posting key.
 *
 * P2002 does not report the offending key the same way everywhere. Verified
 * against the live database: the `@prisma/adapter-pg` driver leaves `target`
 * unset and puts the columns under `driverAdapterError`, while the classic
 * shape is a `target` string or field array. Both are read, and an unrecognised
 * shape still counts — `Job`'s only other unique key is `[id, userId]`, which a
 * create with a generated cuid cannot collide on.
 */
export function isCanonicalUrlConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
    return false
  }

  const target = err.meta?.target
  if (typeof target === "string") return target.includes("canonicalUrl")
  if (Array.isArray(target)) return target.some((field) => String(field).includes("canonicalUrl"))

  const fields = driverAdapterConstraintFields(err.meta)
  // Quoted identifiers in the driver's field list, hence `includes` not `===`.
  if (fields) return fields.some((field) => String(field).includes("canonicalUrl"))

  return true
}

/** The column list `@prisma/adapter-pg` nests under `meta.driverAdapterError`. */
function driverAdapterConstraintFields(meta: unknown): unknown[] | null {
  const cause = (meta as { driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } })
    ?.driverAdapterError?.cause
  const fields = cause?.constraint?.fields
  return Array.isArray(fields) ? fields : null
}
