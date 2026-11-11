import { createHash } from "node:crypto"

import { prisma } from "@/shared/lib/prisma"
import { decryptAnswerValue, encryptAnswerValue } from "@/shared/lib/answer-crypto"
import { logger, redactText } from "@/shared/lib/logger"
import { canonicalizeUrl } from "@/features/discovery/services/normalize.service"
import type {
  AtsAnswerScope,
  AtsPreparationStatus,
  ReviewTaskKind,
} from "@/generated/prisma/enums"
import { Prisma } from "@/generated/prisma/client"

import {
  answerKey,
  buildAtsFieldPlan,
  classifyAtsField,
  type AtsApprovedAnswer,
  type AtsFieldInput,
  type AtsFieldPlan,
  type AtsProfileFacts,
} from "../lib/field-classifier"

const log = logger("ats-preparation")

export const ATS_VENDORS = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "bamboohr",
  "smartrecruiters",
  "jobvite",
  "icims",
  "taleo",
  "workday",
  "recruitee",
  "teamtailor",
  "personio",
  "generic",
] as const

export type AtsVendor = (typeof ATS_VENDORS)[number]

/** Maps a vendor string from the extension onto the fixed allowlist. */
export function normalizeVendor(value: string | undefined | null): AtsVendor {
  const vendor = (value ?? "").trim().toLowerCase().replace(/\s+/g, "")
  return (ATS_VENDORS as readonly string[]).includes(vendor)
    ? (vendor as AtsVendor)
    : "generic"
}

export class AtsError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "CONFLICT"
      | "TERMINAL"
      | "RESUME_NOT_FOUND"
      | "APPLICATION_NOT_FOUND",
    /** Safe, user-owned context for a conflict (never a foreign record). */
    readonly details?: unknown
  ) {
    super(message)
    this.name = "AtsError"
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function asJson(value: unknown): Prisma.JsonValue | null {
  if (value === null || value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? redactText(value, max) : ""
}

function preparationKeyFor(vendor: string, canonicalUrl: string): string {
  return createHash("sha256").update(`${vendor}\n${canonicalUrl}`).digest("hex")
}

/** A stable, useful URL for the form. Only http(s) is accepted. */
function canonicalFormUrl(url: string): string {
  const canonical = canonicalizeUrl(url)
  if (!canonical) {
    throw new AtsError("A valid http(s) application form URL is required.", "INVALID_INPUT")
  }
  return canonical
}

export interface AtsFieldResultInput {
  fieldId: string
  questionKey?: string
  status: "FILLED" | "SKIPPED" | "FAILED" | "REVIEW_REQUIRED"
  reason?: string
}

export interface CreateAtsPreparationInput {
  sourceUrl: string
  vendor?: string
  pageTitle?: string
  jobTitle?: string
  companyName?: string
  jobApplicationId?: string
  resumeId?: string
  fields: AtsFieldInput[]
  results?: AtsFieldResultInput[]
}

export interface AtsReviewTaskView {
  id: string
  kind: ReviewTaskKind
  status: string
  question: string
  reason: string
  category: string | null
  fallback: string | null
  suggestedValue: Prisma.JsonValue | null
  createdAt: string
}

export interface AtsPreparationView {
  id: string
  jobApplicationId: string | null
  workflowRunId: string | null
  vendor: string
  sourceUrl: string
  canonicalUrl: string
  pageTitle: string | null
  jobTitle: string | null
  companyName: string | null
  status: AtsPreparationStatus
  resumeId: string | null
  resumeTitle: string | null
  plan: AtsFieldPlan | null
  results: Prisma.JsonValue | null
  reviewTaskIds: string[]
  fieldsDetected: number
  fieldsFilled: number
  fieldsBlocked: number
  approvedAt: string | null
  filledAt: string | null
  submittedAt: string | null
  submissionNote: string | null
  createdAt: string
  updatedAt: string
  openReviewTasks: AtsReviewTaskView[]
}

const PREP_SELECT = {
  id: true,
  jobApplicationId: true,
  workflowRunId: true,
  vendor: true,
  sourceUrl: true,
  canonicalUrl: true,
  pageTitle: true,
  jobTitle: true,
  companyName: true,
  status: true,
  resumeId: true,
  resumeTitle: true,
  plan: true,
  results: true,
  reviewTaskIds: true,
  fieldsDetected: true,
  fieldsFilled: true,
  fieldsBlocked: true,
  approvedAt: true,
  filledAt: true,
  submittedAt: true,
  submissionNote: true,
  createdAt: true,
  updatedAt: true,
} as const

const REVIEW_SELECT = {
  id: true,
  kind: true,
  status: true,
  question: true,
  reason: true,
  category: true,
  fallback: true,
  suggestedValue: true,
  createdAt: true,
} as const

type PrepRow = {
  id: string
  jobApplicationId: string | null
  workflowRunId: string | null
  vendor: string
  sourceUrl: string
  canonicalUrl: string
  pageTitle: string | null
  jobTitle: string | null
  companyName: string | null
  status: AtsPreparationStatus
  resumeId: string | null
  resumeTitle: string | null
  plan: unknown
  results: unknown
  reviewTaskIds: string[]
  fieldsDetected: number
  fieldsFilled: number
  fieldsBlocked: number
  approvedAt: Date | null
  filledAt: Date | null
  submittedAt: Date | null
  submissionNote: string | null
  createdAt: Date
  updatedAt: Date
}

function toReviewView(task: {
  id: string
  kind: ReviewTaskKind
  status: string
  question: string
  reason: string
  category: string | null
  fallback: string | null
  suggestedValue: unknown
  createdAt: Date
}): AtsReviewTaskView {
  return {
    id: task.id,
    kind: task.kind,
    status: task.status,
    question: task.question,
    reason: task.reason,
    category: task.category,
    fallback: task.fallback,
    suggestedValue: asJson(task.suggestedValue),
    createdAt: task.createdAt.toISOString(),
  }
}

function toPreparationView(
  prep: PrepRow,
  openReviewTasks: AtsReviewTaskView[] = []
): AtsPreparationView {
  const plan = asObject(prep.plan)
  return {
    id: prep.id,
    jobApplicationId: prep.jobApplicationId,
    workflowRunId: prep.workflowRunId,
    vendor: prep.vendor,
    sourceUrl: prep.sourceUrl,
    canonicalUrl: prep.canonicalUrl,
    pageTitle: prep.pageTitle,
    jobTitle: prep.jobTitle,
    companyName: prep.companyName,
    status: prep.status,
    resumeId: prep.resumeId,
    resumeTitle: prep.resumeTitle,
    plan:
      Array.isArray(plan.fields) && typeof plan.fillCount === "number"
        ? (plan as unknown as AtsFieldPlan)
        : null,
    results: asJson(prep.results),
    reviewTaskIds: prep.reviewTaskIds,
    fieldsDetected: prep.fieldsDetected,
    fieldsFilled: prep.fieldsFilled,
    fieldsBlocked: prep.fieldsBlocked,
    approvedAt: prep.approvedAt?.toISOString() ?? null,
    filledAt: prep.filledAt?.toISOString() ?? null,
    submittedAt: prep.submittedAt?.toISOString() ?? null,
    submissionNote: prep.submissionNote,
    createdAt: prep.createdAt.toISOString(),
    updatedAt: prep.updatedAt.toISOString(),
    openReviewTasks,
  }
}

async function loadOpenReviewTasks(prepId: string): Promise<AtsReviewTaskView[]> {
  const tasks = await prisma.reviewTask.findMany({
    where: { atsPreparationId: prepId, status: "OPEN" },
    orderBy: { createdAt: "asc" },
    select: REVIEW_SELECT,
  })
  return tasks.map(toReviewView)
}

async function viewPreparation(prep: PrepRow): Promise<AtsPreparationView> {
  return toPreparationView(prep, await loadOpenReviewTasks(prep.id))
}

async function loadProfile(userId: string): Promise<AtsProfileFacts> {
  const [career, player] = await Promise.all([
    prisma.careerProfile.findUnique({
      where: { userId },
      select: {
        contactFullName: true,
        contactEmail: true,
        contactPhone: true,
        contactLocation: true,
        linkedinUrl: true,
        githubUrl: true,
        websiteUrl: true,
      },
    }),
    prisma.playerProfile.findUnique({
      where: { userId },
      select: { currentRole: true },
    }),
  ])
  return {
    fullName: career?.contactFullName ?? null,
    email: career?.contactEmail ?? null,
    phone: career?.contactPhone ?? null,
    location: career?.contactLocation ?? null,
    linkedinUrl: career?.linkedinUrl ?? null,
    githubUrl: career?.githubUrl ?? null,
    websiteUrl: career?.websiteUrl ?? null,
    currentRole: player?.currentRole ?? null,
  }
}

/** Application-scoped answers win over a global answer for the same question. */
async function loadAnswers(
  userId: string,
  preparationId: string | null
): Promise<AtsApprovedAnswer[]> {
  const rows = await prisma.atsAnswer.findMany({
    where: {
      userId,
      revokedAt: null,
      OR: [
        { scope: "GLOBAL" },
        ...(preparationId
          ? [{ scope: "APPLICATION" as AtsAnswerScope, preparationId }]
          : []),
      ],
    },
    orderBy: [{ scope: "asc" }, { approvedAt: "desc" }],
    select: { id: true, questionKey: true, value: true, scope: true, category: true },
  })

  const byKey = new Map<string, AtsApprovedAnswer>()
  // `APPLICATION` sorts before `GLOBAL`; the first entry for a key is the most
  // specific answer, and later duplicates are deliberately ignored.
  for (const row of rows) {
    if (byKey.has(row.questionKey)) continue
    let value: unknown
    try {
      value = decryptAnswerValue(row.value)
    } catch (error) {
      // An answer that cannot be decrypted is never sent to a form. The user
      // can re-approve the question through the review queue.
      log.warn("Skipping an unreadable stored ATS answer", {
        answerId: row.id,
        err: error,
      })
      continue
    }
    if (typeof value !== "string" || !value.trim()) continue
    byKey.set(row.questionKey, {
      id: row.id,
      questionKey: row.questionKey,
      value,
      scope: row.scope,
      category: row.category,
    })
  }
  return [...byKey.values()]
}

function taskKindFor(field: AtsFieldPlan["fields"][number]): ReviewTaskKind {
  if (field.decision === "ATTACH_RESUME" || field.category === "document") {
    return "RESUME_ATTACHMENT"
  }
  if (field.category === "essay") return "ESSAY_ANSWER"
  if (
    field.category === "authorization" ||
    field.category === "sponsorship" ||
    field.category === "compensation" ||
    field.category === "demographic" ||
    field.category === "legal"
  ) {
    return "SENSITIVE_ANSWER"
  }
  if ((field.reason ?? "").includes("saved answer exists")) return "UNSUPPORTED_FIELD"
  if (field.sensitivity === "unknown") return "UNKNOWN_FIELD"
  return "MISSING_PROFILE_FACT"
}

function taskReasonFor(
  field: AtsFieldPlan["fields"][number],
  vendor: string
): string {
  const vendorLabel = vendor === "generic" ? "application" : vendor
  const base = field.reason ?? "Confirm this answer before filling it."
  return `${base} Detected on the ${vendorLabel} form; nothing was filled.`
}

const FALLBACK_MANUAL =
  "Answer this field directly in the employer's form. RoleSpec never fills or submits it for you."

/**
 * Reconciles open review tasks with the current plan. Resolved answers are not
 * reopened; a new question, or one whose approved answer was revoked, is.
 */
async function reconcileReviewTasks(
  tx: Prisma.TransactionClient,
  prep: { id: string; userId: string; jobApplicationId: string | null; vendor: string; resumeId: string | null },
  plan: AtsFieldPlan
): Promise<string[]> {
  const existing = await tx.reviewTask.findMany({
    where: { atsPreparationId: prep.id },
    select: { id: true, question: true, category: true, status: true },
  })
  const byKey = new Map(
    existing.map((task) => [`${task.question}\u0000${task.category ?? ""}`, task])
  )

  const ids: string[] = existing.map((task) => task.id)
  const currentKeys = new Set(
    plan.fields
      .filter(
        (field) =>
          field.decision === "REVIEW" ||
          (field.decision === "ATTACH_RESUME" && !prep.resumeId)
      )
      .map((field) => `${field.label}\u0000ats:${field.category}`)
  )

  // A form can drop a field between scans. Its old open task must not keep the
  // preparation in READY_FOR_REVIEW forever; expire it while keeping the row for
  // audit. Resolved/dismissed history is left untouched.
  for (const task of existing) {
    if (
      task.status === "OPEN" &&
      !currentKeys.has(`${task.question}\u0000${task.category ?? ""}`)
    ) {
      await tx.reviewTask.update({
        where: { id: task.id },
        data: {
          status: "EXPIRED",
          resolvedAt: new Date(),
        },
      })
    }
  }

  for (const field of plan.fields) {
    const needsTask =
      field.decision === "REVIEW" ||
      (field.decision === "ATTACH_RESUME" && !prep.resumeId)
    if (!needsTask) continue

    const category = `ats:${field.category}`
    const key = `${field.label}\u0000${category}`
    const found = byKey.get(key)
    if (found) {
      if (found.status === "OPEN") {
        await tx.reviewTask.update({
          where: { id: found.id },
          data: {
            reason: taskReasonFor(field, prep.vendor).slice(0, 2000),
            fallback: FALLBACK_MANUAL,
          },
        })
      }
      continue
    }

    const created = await tx.reviewTask.create({
      data: {
        userId: prep.userId,
        jobApplicationId: prep.jobApplicationId,
        atsPreparationId: prep.id,
        kind: taskKindFor(field),
        question: field.label.slice(0, 2000),
        reason: taskReasonFor(field, prep.vendor).slice(0, 2000),
        category,
        fallback: FALLBACK_MANUAL,
        suggestedValue: json({
          required: field.required,
          questionKey: field.questionKey,
          ...(field.answerId ? { savedAnswerId: field.answerId } : {}),
        }),
      },
      select: { id: true },
    })
    ids.push(created.id)
    byKey.set(key, { id: created.id, question: field.label, category, status: "OPEN" })
  }

  return [...new Set(ids)]
}

async function openTaskCount(prepId: string): Promise<number> {
  return prisma.reviewTask.count({ where: { atsPreparationId: prepId, status: "OPEN" } })
}

async function nextStatus(
  current: AtsPreparationStatus,
  prepId: string,
  fieldsDetected: number
): Promise<AtsPreparationStatus> {
  if (["SUBMITTED", "NOT_SUBMITTED", "ABANDONED"].includes(current)) return current
  const open = await openTaskCount(prepId)
  if (open > 0) return "READY_FOR_REVIEW"
  return fieldsDetected > 0 ? "READY_TO_SUBMIT" : "DRAFT"
}

/**
 * Recomputes the status after a transaction committed. Open review tasks are
 * counted outside the transaction on purpose: a query through the global client
 * while the transaction is open cannot see the tasks it just created.
 */
async function applyNextStatus(prep: PrepRow): Promise<PrepRow> {
  const status = await nextStatus(prep.status, prep.id, prep.fieldsDetected)
  if (status === prep.status) return prep
  return prisma.atsPreparation.update({
    where: { id: prep.id },
    data: { status },
    select: PREP_SELECT,
  })
}

function sanitizeField(input: unknown): AtsFieldInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const row = input as Record<string, unknown>
  const fieldId = typeof row.fieldId === "string" ? row.fieldId.trim().slice(0, 80) : ""
  const label = typeof row.label === "string" ? row.label.trim().slice(0, 300) : ""
  if (!fieldId || !label) return null
  const options = Array.isArray(row.options)
    ? row.options
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 40)
    : undefined
  return {
    fieldId,
    label,
    ...(typeof row.name === "string" ? { name: row.name.slice(0, 120) } : {}),
    ...(typeof row.type === "string" ? { type: row.type.slice(0, 40) } : {}),
    ...(typeof row.tagName === "string" ? { tagName: row.tagName.slice(0, 20) } : {}),
    ...(typeof row.autocomplete === "string"
      ? { autocomplete: row.autocomplete.slice(0, 60) }
      : {}),
    ...(typeof row.required === "boolean" ? { required: row.required } : {}),
    ...(options && options.length > 0 ? { options } : {}),
    ...(typeof row.requiresSelection === "boolean"
      ? { requiresSelection: row.requiresSelection }
      : {}),
    ...(typeof row.frameId === "number" && Number.isFinite(row.frameId)
      ? { frameId: Math.trunc(row.frameId) }
      : {}),
  }
}

function sanitizeResults(results: AtsFieldResultInput[] | undefined): AtsFieldResultInput[] {
  if (!Array.isArray(results)) return []
  const allowed = new Set(["FILLED", "SKIPPED", "FAILED", "REVIEW_REQUIRED"])
  return results
    .slice(0, 150)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null
      const row = entry as unknown as Record<string, unknown>
      const fieldId = typeof row.fieldId === "string" ? row.fieldId.slice(0, 80) : ""
      const status = typeof row.status === "string" && allowed.has(row.status) ? row.status : null
      if (!fieldId || !status) return null
      return {
        fieldId,
        status: status as AtsFieldResultInput["status"],
        ...(typeof row.questionKey === "string"
          ? { questionKey: row.questionKey.slice(0, 180) }
          : {}),
        ...(typeof row.reason === "string"
          ? { reason: redactText(row.reason, 300) }
          : {}),
      }
    })
    .filter((entry): entry is AtsFieldResultInput => entry !== null)
}

async function resolveResumeTitle(userId: string, resumeId: string): Promise<string> {
  const resume = await prisma.resume.findFirst({
    where: { id: resumeId, userId, status: { not: "ARCHIVED" } },
    select: { id: true, title: true },
  })
  if (!resume) {
    throw new AtsError("That resume does not exist or is archived.", "RESUME_NOT_FOUND")
  }
  return resume.title
}

/** Creates or refreshes one preparation for a form, idempotent per URL+vendor. */
export async function createAtsPreparation(
  userId: string,
  input: CreateAtsPreparationInput
): Promise<{
  preparation: AtsPreparationView
  approvedAnswers: AtsApprovedAnswer[]
  created: boolean
}> {
  const canonicalUrl = canonicalFormUrl(input.sourceUrl)
  const vendor = normalizeVendor(input.vendor)
  const preparationKey = preparationKeyFor(vendor, canonicalUrl)
  const fields = Array.isArray(input.fields)
    ? input.fields
        .map(sanitizeField)
        .filter((field): field is AtsFieldInput => field !== null)
        .slice(0, 150)
    : []

  let jobTitle = clean(input.jobTitle, 200) || null
  let companyName = clean(input.companyName, 200) || null
  let jobApplicationId: string | null = null
  let workflowRunId: string | null = null

  const linkedApplication = input.jobApplicationId
    ? await prisma.jobApplication.findFirst({
        where: { id: input.jobApplicationId, userId },
        select: {
          id: true,
          job: { select: { title: true, companyName: true } },
        },
      })
    : // No application id is sent by the extension. Link one when the form URL
      // matches a tracked posting, so a confirmed submission updates the right
      // tracker row and never creates a second one.
      await prisma.jobApplication.findFirst({
        where: { userId, job: { canonicalUrl } },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          job: { select: { title: true, companyName: true } },
        },
      })

  if (input.jobApplicationId && !linkedApplication) {
    throw new AtsError("That tracked application does not exist.", "APPLICATION_NOT_FOUND")
  }

  if (linkedApplication) {
    jobApplicationId = linkedApplication.id
    jobTitle = jobTitle ?? linkedApplication.job.title
    companyName = companyName ?? linkedApplication.job.companyName
    const run = await prisma.workflowRun.findFirst({
      where: { userId, jobApplicationId: linkedApplication.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
    workflowRunId = run?.id ?? null
  }

  const existing = await prisma.atsPreparation.findUnique({
    where: { userId_preparationKey: { userId, preparationKey } },
    select: { ...PREP_SELECT, resumeId: true },
  })

  let resumeId = existing?.resumeId ?? null
  let resumeTitle: string | null = null
  if (input.resumeId) {
    resumeTitle = await resolveResumeTitle(userId, input.resumeId)
    resumeId = input.resumeId
  } else if (existing?.resumeId) {
    const resume = await prisma.resume.findFirst({
      where: { id: existing.resumeId, userId },
      select: { title: true },
    })
    resumeTitle = resume?.title ?? null
  }

  const preparationId = existing?.id ?? null
  const profile = await loadProfile(userId)
  const answers = await loadAnswers(userId, preparationId)
  const plan = buildAtsFieldPlan({ fields, profile, answers })
  const status: AtsPreparationStatus =
    plan.reviewCount + (resumeId ? 0 : plan.resumeUploadCount) > 0
      ? "READY_FOR_REVIEW"
      : "READY_TO_SUBMIT"

  if (existing) {
    const updated = await prisma.$transaction(async (tx) => {
      const prep = await tx.atsPreparation.update({
        where: { id: existing.id },
        data: {
          jobApplicationId: jobApplicationId ?? existing.jobApplicationId,
          workflowRunId: workflowRunId ?? existing.workflowRunId,
          pageTitle: clean(input.pageTitle, 300) || existing.pageTitle,
          jobTitle: jobTitle ?? existing.jobTitle,
          companyName: companyName ?? existing.companyName,
          resumeId,
          resumeTitle,
          plan: json(plan),
          fieldsDetected: fields.length,
          fieldsBlocked: plan.reviewCount + plan.resumeUploadCount,
          status,
        },
        select: PREP_SELECT,
      })
      const taskIds = await reconcileReviewTasks(
        tx,
        {
          id: prep.id,
          userId,
          jobApplicationId: prep.jobApplicationId,
          vendor: prep.vendor,
          resumeId: prep.resumeId,
        },
        plan
      )
      return tx.atsPreparation.update({
        where: { id: prep.id },
        data: { reviewTaskIds: taskIds },
        select: PREP_SELECT,
      })
    })
    const reconciled = await applyNextStatus(updated)
    return {
      preparation: await viewPreparation(reconciled),
      approvedAnswers: answers,
      created: false,
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const prep = await tx.atsPreparation.create({
        data: {
          userId,
          jobApplicationId,
          workflowRunId,
          vendor,
          // Keep the user-navigable URL but redact credential-shaped query
          // parameters before the staged record stores it.
          sourceUrl: redactText(input.sourceUrl, 4000),
          canonicalUrl,
          preparationKey,
          pageTitle: clean(input.pageTitle, 300) || null,
          jobTitle,
          companyName,
          status,
          resumeId,
          resumeTitle,
          plan: json(plan),
          fieldsDetected: fields.length,
          fieldsBlocked: plan.reviewCount + plan.resumeUploadCount,
        },
        select: PREP_SELECT,
      })
      const taskIds = await reconcileReviewTasks(
        tx,
        {
          id: prep.id,
          userId,
          jobApplicationId,
          vendor,
          resumeId,
        },
        plan
      )
      return tx.atsPreparation.update({
        where: { id: prep.id },
        data: { reviewTaskIds: taskIds },
        select: PREP_SELECT,
      })
    })
    const reconciled = await applyNextStatus(created)
    return {
      preparation: await viewPreparation(reconciled),
      approvedAnswers: answers,
      created: true,
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // A concurrent scan created the same preparation. Refresh the winner.
      return createAtsPreparation(userId, input)
    }
    throw error
  }
}

export async function getAtsPreparation(
  userId: string,
  id: string
): Promise<AtsPreparationView> {
  const prep = await prisma.atsPreparation.findFirst({
    where: { id, userId },
    select: PREP_SELECT,
  })
  if (!prep) throw new AtsError("ATS preparation not found.", "NOT_FOUND")
  return viewPreparation(prep)
}

export async function listAtsPreparations(
  userId: string,
  filters: { jobApplicationId?: string; limit?: number } = {}
): Promise<AtsPreparationView[]> {
  const rows = await prisma.atsPreparation.findMany({
    where: {
      userId,
      ...(filters.jobApplicationId
        ? { jobApplicationId: filters.jobApplicationId }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: Math.min(50, Math.max(1, Math.floor(filters.limit ?? 20))),
    select: PREP_SELECT,
  })
  return Promise.all(rows.map(viewPreparation))
}

async function markAnswersUsed(
  userId: string,
  preparationId: string,
  results: AtsFieldResultInput[]
): Promise<void> {
  const questions = results
    .filter((result) => result.status === "FILLED" && result.questionKey)
    .map((result) => result.questionKey as string)
  if (questions.length === 0) return
  const answers = await prisma.atsAnswer.findMany({
    where: {
      userId,
      revokedAt: null,
      questionKey: { in: [...new Set(questions)] },
      OR: [{ scope: "GLOBAL" }, { scope: "APPLICATION", preparationId }],
    },
    select: { id: true, questionKey: true, scope: true, preparationId: true },
  })
  if (answers.length === 0) return

  // One answer is actually reused per question. An application-scoped row
  // overrides a global row with the same key, so counting both would inflate
  // the usage history of an answer the fill never used.
  const chosen = new Map<string, string>()
  for (const answer of answers) {
    const current = chosen.get(answer.questionKey)
    if (!current || answer.scope === "APPLICATION") {
      chosen.set(answer.questionKey, answer.id)
    }
  }
  await prisma.atsAnswer.updateMany({
    where: { id: { in: [...chosen.values()] } },
    data: { lastUsedAt: new Date(), useCount: { increment: 1 } },
  })
}

/** Reports what actually happened on the page, field by field. */
export async function recordAtsResults(
  userId: string,
  id: string,
  results: AtsFieldResultInput[]
): Promise<AtsPreparationView> {
  const prep = await prisma.atsPreparation.findFirst({
    where: { id, userId },
    select: { ...PREP_SELECT, status: true },
  })
  if (!prep) throw new AtsError("ATS preparation not found.", "NOT_FOUND")
  if (["SUBMITTED", "NOT_SUBMITTED", "ABANDONED"].includes(prep.status)) {
    throw new AtsError("That preparation is already finished.", "TERMINAL")
  }

  const cleanResults = sanitizeResults(results)
  const filled = cleanResults.filter((result) => result.status === "FILLED").length
  const blocked = cleanResults.filter(
    (result) => result.status === "REVIEW_REQUIRED"
  ).length

  await markAnswersUsed(userId, id, cleanResults)
  const status = await nextStatus("DRAFT", id, prep.fieldsDetected)

  const updated = await prisma.atsPreparation.update({
    where: { id },
    data: {
      results: json({ fields: cleanResults, recordedAt: new Date().toISOString() }),
      fieldsFilled: filled,
      fieldsBlocked: blocked,
      ...(filled > 0 ? { filledAt: new Date() } : {}),
      status: status === "READY_TO_SUBMIT" || status === "READY_FOR_REVIEW" ? status : prep.status,
    },
    select: PREP_SELECT,
  })
  return viewPreparation(updated)
}

export async function attachAtsResume(
  userId: string,
  id: string,
  resumeId: string
): Promise<AtsPreparationView> {
  const prep = await prisma.atsPreparation.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  })
  if (!prep) throw new AtsError("ATS preparation not found.", "NOT_FOUND")
  if (["SUBMITTED", "NOT_SUBMITTED", "ABANDONED"].includes(prep.status)) {
    throw new AtsError("That preparation is already finished.", "TERMINAL")
  }
  const title = await resolveResumeTitle(userId, resumeId)

  const updated = await prisma.$transaction(async (tx) => {
    // The resume task is done because the user chose a document here. It is
    // still attached manually on the page; this records the decision.
    await tx.reviewTask.updateMany({
      where: {
        atsPreparationId: id,
        status: "OPEN",
        kind: "RESUME_ATTACHMENT",
      },
      data: {
        status: "RESOLVED",
        answer: json({ resumeId, attachedBy: "user" }),
        resolvedAt: new Date(),
        resolvedBy: userId,
      },
    })
    return tx.atsPreparation.update({
      where: { id },
      data: { resumeId, resumeTitle: title },
      select: PREP_SELECT,
    })
  })
  return viewPreparation(await applyNextStatus(updated))
}

/**
 * Records the user's own statement about submission. `submitted: true` is the
 * only path that moves the tracked application to APPLIED — it is never inferred
 * from a form being filled, a workflow step, or a page event.
 */
export async function confirmAtsSubmission(
  userId: string,
  id: string,
  input: { submitted: boolean; note?: string }
): Promise<{
  preparation: AtsPreparationView
  applicationStatus: string | null
}> {
  const prep = await prisma.atsPreparation.findFirst({
    where: { id, userId },
    select: {
      id: true,
      jobApplicationId: true,
      workflowRunId: true,
      status: true,
    },
  })
  if (!prep) throw new AtsError("ATS preparation not found.", "NOT_FOUND")

  if (prep.status === "SUBMITTED" && input.submitted) {
    return {
      preparation: await getAtsPreparation(userId, id),
      applicationStatus: "APPLIED",
    }
  }
  if (prep.status === "NOT_SUBMITTED" && !input.submitted) {
    return {
      preparation: await getAtsPreparation(userId, id),
      applicationStatus: null,
    }
  }
  // A submission is a one-way fact. Allowing SUBMITTED -> NOT_SUBMITTED would
  // leave the tracked application on APPLIED with no status history that
  // explains the reversal, and would let a second click erase the only evidence
  // that the user confirmed a submission. Corrections belong in the tracker.
  if (prep.status === "SUBMITTED" && !input.submitted) {
    throw new AtsError(
      "This application was already confirmed as submitted. Correct the tracker if that was a mistake.",
      "TERMINAL"
    )
  }
  if (prep.status === "ABANDONED") {
    throw new AtsError("That preparation was abandoned.", "TERMINAL")
  }

  const note = input.note ? redactText(input.note, 2000) : null
  let applicationStatus: string | null = null

  const preparation = await prisma.$transaction(async (tx) => {
    if (input.submitted && prep.jobApplicationId) {
      const application = await tx.jobApplication.findFirst({
        where: { id: prep.jobApplicationId, userId },
        select: { id: true, status: true, dateApplied: true },
      })
      if (application) {
        applicationStatus = "APPLIED"
        const previousStatus = application.status
        if (previousStatus !== "APPLIED") {
          await tx.jobApplication.update({
            where: { id: application.id },
            data: {
              status: "APPLIED",
              dateApplied:
                application.dateApplied ??
                new Date(
                  Date.UTC(
                    new Date().getUTCFullYear(),
                    new Date().getUTCMonth(),
                    new Date().getUTCDate()
                  )
                ),
            },
          })
          await tx.applicationStatusEvent.create({
            data: {
              jobApplicationId: application.id,
              fromStatus: previousStatus,
              toStatus: "APPLIED",
              note: note ?? "Submission confirmed by the user in the browser extension.",
              source: "EXTENSION",
            },
          })
        }
      }
    }

    if (prep.workflowRunId) {
      await tx.workflowEvent
        .create({
          data: {
            runId: prep.workflowRunId,
            type: "REVIEW_RESOLVED",
            message: input.submitted
              ? "The user confirmed the application was submitted manually."
              : "The user confirmed the application was not submitted.",
            metadata: json({ atsPreparationId: prep.id, submitted: input.submitted }),
          },
        })
        .catch(() => undefined)
    }

    return tx.atsPreparation.update({
      where: { id },
      data: {
        status: input.submitted ? "SUBMITTED" : "NOT_SUBMITTED",
        submittedAt: input.submitted ? new Date() : null,
        submissionNote: note,
      },
      select: PREP_SELECT,
    })
  })

  return { preparation: await viewPreparation(preparation), applicationStatus }
}

/** Recomputes readiness after a task is dismissed or a form changes. */
export async function refreshAtsPreparationStatus(
  userId: string,
  id: string
): Promise<AtsPreparationView> {
  const prep = await prisma.atsPreparation.findFirst({
    where: { id, userId },
    select: PREP_SELECT,
  })
  if (!prep) throw new AtsError("ATS preparation not found.", "NOT_FOUND")
  return viewPreparation(await applyNextStatus(prep))
}

export async function abandonAtsPreparation(
  userId: string,
  id: string
): Promise<AtsPreparationView> {
  const prep = await prisma.atsPreparation.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  })
  if (!prep) throw new AtsError("ATS preparation not found.", "NOT_FOUND")
  if (prep.status === "SUBMITTED") {
    throw new AtsError("A submitted application cannot be abandoned.", "TERMINAL")
  }
  const updated = await prisma.atsPreparation.update({
    where: { id },
    data: { status: "ABANDONED" },
    select: PREP_SELECT,
  })
  return viewPreparation(updated)
}

// ── Approved answer memory ───────────────────────────────────────────────────

export interface AtsAnswerView {
  id: string
  preparationId: string | null
  questionKey: string
  questionText: string
  category: string
  sensitivity: string
  value: Prisma.JsonValue
  scope: AtsAnswerScope
  source: string
  approvedAt: string
  lastUsedAt: string | null
  useCount: number
}

const ANSWER_SELECT = {
  id: true,
  preparationId: true,
  questionKey: true,
  questionText: true,
  category: true,
  sensitivity: true,
  value: true,
  scope: true,
  source: true,
  approvedAt: true,
  revokedAt: true,
  lastUsedAt: true,
  useCount: true,
} as const

function toAnswerView(answer: {
  id: string
  preparationId: string | null
  questionKey: string
  questionText: string
  category: string
  sensitivity: string
  value: unknown
  scope: AtsAnswerScope
  source: string
  approvedAt: Date
  lastUsedAt: Date | null
  useCount: number
}): AtsAnswerView {
  return {
    id: answer.id,
    preparationId: answer.preparationId,
    questionKey: answer.questionKey,
    questionText: answer.questionText,
    category: answer.category,
    sensitivity: answer.sensitivity,
    value: asJson(decryptAnswerValue(answer.value)) as Prisma.JsonValue,
    scope: answer.scope,
    source: answer.source,
    approvedAt: answer.approvedAt.toISOString(),
    lastUsedAt: answer.lastUsedAt?.toISOString() ?? null,
    useCount: answer.useCount,
  }
}

export async function listAtsAnswers(
  userId: string,
  filters: { preparationId?: string; questionKey?: string } = {}
): Promise<AtsAnswerView[]> {
  const rows = await prisma.atsAnswer.findMany({
    where: {
      userId,
      revokedAt: null,
      ...(filters.questionKey ? { questionKey: filters.questionKey } : {}),
      ...(filters.preparationId
        ? {
            OR: [
              { scope: "GLOBAL" },
              { scope: "APPLICATION", preparationId: filters.preparationId },
            ],
          }
        : {}),
    },
    orderBy: { approvedAt: "desc" },
    take: 200,
    select: ANSWER_SELECT,
  })
  return rows.map(toAnswerView)
}

function sanitizeAnswerValue(value: unknown): string | boolean | string[] {
  if (typeof value === "string") {
    const trimmed = value.trim().slice(0, 2000)
    if (!trimmed) throw new AtsError("An answer cannot be empty.", "INVALID_INPUT")
    return trimmed
  }
  if (typeof value === "boolean") return value
  if (Array.isArray(value)) {
    const values = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 20)
    if (values.length === 0) {
      throw new AtsError("An answer cannot be empty.", "INVALID_INPUT")
    }
    return values
  }
  throw new AtsError("Answers must be text, a boolean or a list of text.", "INVALID_INPUT")
}

export interface ApproveAtsAnswerInput {
  preparationId?: string
  questionText: string
  value: unknown
  scope?: "APPLICATION" | "GLOBAL"
  replace?: boolean
}

export interface ApproveAtsAnswerResult {
  answer: AtsAnswerView
  resolvedTaskIds: string[]
  preparation: AtsPreparationView | null
}

/**
 * Approves (or edits) one answer. A conflicting live answer is refused unless
 * the caller explicitly asks to replace it, so a stale panel cannot overwrite a
 * decision the user made elsewhere.
 */
export async function approveAtsAnswer(
  userId: string,
  input: ApproveAtsAnswerInput
): Promise<ApproveAtsAnswerResult> {
  const questionText = input.questionText.trim().slice(0, 2000)
  if (!questionText) throw new AtsError("A question is required.", "INVALID_INPUT")
  const questionKey = answerKey(questionText)
  if (!questionKey) throw new AtsError("A question is required.", "INVALID_INPUT")
  const scope: AtsAnswerScope = input.scope === "GLOBAL" ? "GLOBAL" : "APPLICATION"
  const value = sanitizeAnswerValue(input.value)

  let preparationId: string | null = null
  let preparationJobApplicationId: string | null = null
  if (scope === "APPLICATION") {
    if (!input.preparationId) {
      throw new AtsError(
        "An application-scoped answer needs the preparation it belongs to.",
        "INVALID_INPUT"
      )
    }
    const prep = await prisma.atsPreparation.findFirst({
      where: { id: input.preparationId, userId },
      select: { id: true, plan: true, jobApplicationId: true, status: true },
    })
    if (!prep) throw new AtsError("ATS preparation not found.", "NOT_FOUND")
    const plan = asObject(prep.plan)
    const fields = Array.isArray(plan.fields) ? plan.fields : []
    const detected = fields.some((field) => {
      if (!field || typeof field !== "object") return false
      return (field as Record<string, unknown>).questionKey === questionKey
    })
    if (!detected) {
      throw new AtsError(
        "That question was not detected on this application form.",
        "INVALID_INPUT"
      )
    }
    preparationId = prep.id
    preparationJobApplicationId = prep.jobApplicationId
  }

  const classification = classifyAtsField({
    fieldId: "answer",
    label: questionText,
    tagName: "input",
    type: "text",
  })
  const dedupeKey = `${scope}:${scope === "APPLICATION" ? preparationId : "global"}:${questionKey}`

  const existing = await prisma.atsAnswer.findUnique({
    where: { userId_dedupeKey: { userId, dedupeKey } },
    select: ANSWER_SELECT,
  })

  const existingValue = existing ? decryptAnswerValue(existing.value) : null
  if (
    existing &&
    existing.revokedAt === null &&
    JSON.stringify(existingValue) !== JSON.stringify(value)
  ) {
    if (!input.replace) {
      if (preparationId) {
        const category = `ats:${classification.category}`
        // The conflict is a reviewable question, not only a failed request. Keep
        // one open task per question so repeated attempts do not flood the queue.
        const openConflict = await prisma.reviewTask.findFirst({
          where: {
            userId,
            atsPreparationId: preparationId,
            kind: "CONFLICTING_ANSWER",
            status: "OPEN",
            question: questionText,
            category,
          },
          select: { id: true },
        })
        if (!openConflict) {
          await prisma.reviewTask.create({
            data: {
              userId,
              jobApplicationId: preparationJobApplicationId,
              atsPreparationId: preparationId,
              kind: "CONFLICTING_ANSWER",
              question: questionText,
              reason:
                "A different approved answer already exists for this question. Review both answers, then edit or revoke one.",
              category,
              fallback: FALLBACK_MANUAL,
              suggestedValue: json({
                existingAnswerId: existing.id,
                existingScope: existing.scope,
                questionKey,
              }),
            },
            select: { id: true },
          })
          await prisma.atsPreparation.updateMany({
            where: {
              id: preparationId,
              status: { notIn: ["SUBMITTED", "NOT_SUBMITTED", "ABANDONED"] },
            },
            data: { status: "READY_FOR_REVIEW" },
          })
        }
      }
      throw new AtsError(
        "A different approved answer already exists for this question. Replace it explicitly.",
        "CONFLICT",
        { existingAnswer: toAnswerView(existing) }
      )
    }
  }

  const saved = await prisma.$transaction(async (tx) => {
    const answer = existing
      ? await tx.atsAnswer.update({
          where: { id: existing.id },
          data: {
            questionText,
            category: classification.category,
            sensitivity: classification.sensitivity,
            value: json(encryptAnswerValue(value)),
            source: "USER_APPROVED",
            approvedAt: new Date(),
            revokedAt: null,
          },
          select: ANSWER_SELECT,
        })
      : await tx.atsAnswer.create({
          data: {
            userId,
            preparationId,
            questionKey,
            questionText,
            category: classification.category,
            sensitivity: classification.sensitivity,
            value: json(encryptAnswerValue(value)),
            scope,
            source: "USER_APPROVED",
            dedupeKey,
            approvedAt: new Date(),
          },
          select: ANSWER_SELECT,
        })

    let resolvedTaskIds: string[] = []
    if (preparationId) {
      const tasks = await tx.reviewTask.findMany({
        where: {
          userId,
          atsPreparationId: preparationId,
          status: "OPEN",
          category: `ats:${classification.category}`,
          question: questionText,
        },
        select: { id: true },
      })
      if (tasks.length > 0) {
        await tx.reviewTask.updateMany({
          where: { id: { in: tasks.map((task) => task.id) } },
          data: {
            status: "RESOLVED",
            answer: json(encryptAnswerValue(value)),
            resolvedAt: new Date(),
            resolvedBy: userId,
          },
        })
        resolvedTaskIds = tasks.map((task) => task.id)
      }
    }

    return { answer, resolvedTaskIds }
  })

  let preparation: AtsPreparationView | null = null
  if (preparationId) {
    const prep = await prisma.atsPreparation.findFirst({
      where: { id: preparationId, userId },
      select: PREP_SELECT,
    })
    if (prep && !["SUBMITTED", "NOT_SUBMITTED", "ABANDONED"].includes(prep.status)) {
      const status = await nextStatus("DRAFT", prep.id, prep.fieldsDetected)
      const updated = await prisma.atsPreparation.update({
        where: { id: prep.id },
        data: { status },
        select: PREP_SELECT,
      })
      preparation = await viewPreparation(updated)
    } else if (prep) {
      preparation = await viewPreparation(prep)
    }
  }

  log.info("ATS answer approved", {
    userId,
    answerId: saved.answer.id,
    scope,
    questionKey,
  })

  return {
    answer: toAnswerView(saved.answer),
    resolvedTaskIds: saved.resolvedTaskIds,
    preparation,
  }
}

export async function revokeAtsAnswer(
  userId: string,
  answerId: string
): Promise<{ revoked: boolean; preparation: AtsPreparationView | null }> {
  const answer = await prisma.atsAnswer.findFirst({
    where: { id: answerId, userId },
    select: {
      id: true,
      preparationId: true,
      questionKey: true,
      questionText: true,
      category: true,
      revokedAt: true,
    },
  })
  if (!answer) throw new AtsError("Answer not found.", "NOT_FOUND")

  await prisma.atsAnswer.update({
    where: { id: answer.id },
    data: { revokedAt: new Date() },
  })

  if (!answer.preparationId) return { revoked: true, preparation: null }
  const prep = await prisma.atsPreparation.findFirst({
    where: { id: answer.preparationId, userId },
    select: PREP_SELECT,
  })
  if (!prep) return { revoked: true, preparation: null }

  // A revoked answer makes its question reviewable again: reopen the resolved
  // task, or create one when the answer was approved before the task existed.
  const plan = asObject(prep.plan) as unknown as AtsFieldPlan
  if (Array.isArray(plan.fields)) {
    const field = plan.fields.find((entry) => entry.questionKey === answer.questionKey)
    if (field) {
      await prisma.$transaction(async (tx) => {
        await tx.reviewTask.updateMany({
          where: {
            atsPreparationId: prep.id,
            question: answer.questionText,
            category: `ats:${field.category}`,
            status: { in: ["RESOLVED", "DISMISSED"] },
          },
          data: {
            status: "OPEN",
            resolvedAt: null,
            resolvedBy: null,
            answer: Prisma.JsonNull,
          },
        })
        const taskIds = await reconcileReviewTasks(
          tx,
          {
            id: prep.id,
            userId,
            jobApplicationId: prep.jobApplicationId,
            vendor: prep.vendor,
            resumeId: prep.resumeId,
          },
          plan
        )
        await tx.atsPreparation.update({
          where: { id: prep.id },
          data: { reviewTaskIds: taskIds },
        })
      })
    }
  }

  const status = await nextStatus("DRAFT", prep.id, prep.fieldsDetected)
  const updated = await prisma.atsPreparation.update({
    where: { id: prep.id },
    data: { status },
    select: PREP_SELECT,
  })
  return { revoked: true, preparation: await viewPreparation(updated) }
}

/** The answer value for a review task, scoped by what the user chose there. */
export async function answerFromReviewTask(
  userId: string,
  taskId: string,
  input: { value: unknown; scope?: "APPLICATION" | "GLOBAL" }
): Promise<AtsPreparationView | null> {
  const task = await prisma.reviewTask.findFirst({
    where: { id: taskId, userId, atsPreparationId: { not: null } },
    select: { id: true, question: true, atsPreparationId: true },
  })
  if (!task || !task.atsPreparationId) return null

  const result = await approveAtsAnswer(userId, {
    preparationId: task.atsPreparationId,
    questionText: task.question,
    value: input.value,
    scope: input.scope === "GLOBAL" ? "GLOBAL" : "APPLICATION",
    replace: true,
  })
  return result.preparation
}
