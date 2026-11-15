/**
 * Network calls for ATS preparation. Every parser is defensive: a missing or
 * malformed field is dropped rather than allowed to become a page write.
 */

import type { FieldDescriptor } from "./autofill-core"
import type { Settings } from "./types"

export type AtsFailureKind =
  | "unauthorized"
  | "rate_limited"
  | "validation"
  | "conflict"
  | "network"
  | "unknown"

export interface AtsFailure {
  ok: false
  kind: AtsFailureKind
  message: string
  status?: number
  details?: unknown
}

export type AtsResult<T> = ({ ok: true } & T) | AtsFailure

export interface AtsReviewTask {
  id: string
  kind: string
  status: string
  question: string
  reason: string
  category: string | null
  fallback: string | null
  suggestedValue: unknown
  createdAt: string
}

export interface AtsServerField {
  fieldId: string
  label: string
  questionKey: string
  category: string
  sensitivity: string
  decision: "FILL" | "REVIEW" | "ATTACH_RESUME"
  required: boolean
  frameId?: number
  reason?: string
  answerId?: string
}

export interface AtsPreparation {
  id: string
  jobApplicationId: string | null
  workflowRunId: string | null
  vendor: string
  sourceUrl: string
  canonicalUrl: string
  pageTitle: string | null
  jobTitle: string | null
  companyName: string | null
  status: string
  resumeId: string | null
  resumeTitle: string | null
  plan: { fields: AtsServerField[]; fillCount: number; reviewCount: number; resumeUploadCount: number } | null
  results: unknown
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
  openReviewTasks: AtsReviewTask[]
}

export interface AtsApprovedAnswer {
  id: string
  questionKey: string
  value: string
  scope: "APPLICATION" | "GLOBAL"
  category: string
  approvedAt: string | null
  useCount: number
}

const PREPARE_TIMEOUT_MS = 15000
const ANSWER_TIMEOUT_MS = 15000
const PDF_TIMEOUT_MS = 45000

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function toReviewTask(value: unknown): AtsReviewTask | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  if (!str(row.id) || !str(row.question)) return null
  return {
    id: str(row.id) as string,
    kind: str(row.kind) ?? "UNKNOWN_FIELD",
    status: str(row.status) ?? "OPEN",
    question: str(row.question) as string,
    reason: str(row.reason) ?? "",
    category: str(row.category),
    fallback: str(row.fallback),
    suggestedValue: row.suggestedValue ?? null,
    createdAt: str(row.createdAt) ?? "",
  }
}

function toServerField(value: unknown): AtsServerField | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  const decision = row.decision
  if (decision !== "FILL" && decision !== "REVIEW" && decision !== "ATTACH_RESUME") return null
  if (!str(row.fieldId) || !str(row.questionKey)) return null
  return {
    fieldId: str(row.fieldId) as string,
    label: str(row.label) ?? "",
    questionKey: str(row.questionKey) as string,
    category: str(row.category) ?? "unknown",
    sensitivity: str(row.sensitivity) ?? "unknown",
    decision,
    required: row.required === true,
    ...(number(row.frameId) !== null ? { frameId: number(row.frameId) as number } : {}),
    ...(str(row.reason) ? { reason: str(row.reason) as string } : {}),
    ...(str(row.answerId) ? { answerId: str(row.answerId) as string } : {}),
  }
}

export function parseAtsPreparation(value: unknown): AtsPreparation | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  if (!str(row.id) || !str(row.vendor) || !str(row.status)) return null
  const rawPlan = row.plan
  let plan: AtsPreparation["plan"] = null
  if (rawPlan && typeof rawPlan === "object") {
    const p = rawPlan as Record<string, unknown>
    const fields = Array.isArray(p.fields)
      ? p.fields.map(toServerField).filter((field): field is AtsServerField => field !== null)
      : []
    plan = {
      fields,
      fillCount: number(p.fillCount) ?? fields.filter((f) => f.decision === "FILL").length,
      reviewCount: number(p.reviewCount) ?? fields.filter((f) => f.decision === "REVIEW").length,
      resumeUploadCount:
        number(p.resumeUploadCount) ??
        fields.filter((f) => f.decision === "ATTACH_RESUME").length,
    }
  }
  const tasks = Array.isArray(row.openReviewTasks)
    ? row.openReviewTasks
        .map(toReviewTask)
        .filter((task): task is AtsReviewTask => task !== null)
    : []
  return {
    id: str(row.id) as string,
    jobApplicationId: str(row.jobApplicationId),
    workflowRunId: str(row.workflowRunId),
    vendor: str(row.vendor) as string,
    sourceUrl: str(row.sourceUrl) ?? "",
    canonicalUrl: str(row.canonicalUrl) ?? "",
    pageTitle: str(row.pageTitle),
    jobTitle: str(row.jobTitle),
    companyName: str(row.companyName),
    status: str(row.status) as string,
    resumeId: str(row.resumeId),
    resumeTitle: str(row.resumeTitle),
    plan,
    results: row.results ?? null,
    reviewTaskIds: Array.isArray(row.reviewTaskIds)
      ? row.reviewTaskIds.filter((id): id is string => typeof id === "string")
      : [],
    fieldsDetected: number(row.fieldsDetected) ?? 0,
    fieldsFilled: number(row.fieldsFilled) ?? 0,
    fieldsBlocked: number(row.fieldsBlocked) ?? 0,
    approvedAt: str(row.approvedAt),
    filledAt: str(row.filledAt),
    submittedAt: str(row.submittedAt),
    submissionNote: str(row.submissionNote),
    createdAt: str(row.createdAt) ?? "",
    updatedAt: str(row.updatedAt) ?? "",
    openReviewTasks: tasks,
  }
}

export function parseApprovedAnswers(value: unknown): AtsApprovedAnswer[] {
  if (!Array.isArray(value)) return []
  const answers: AtsApprovedAnswer[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue
    const row = entry as Record<string, unknown>
    if (!str(row.id) || !str(row.questionKey) || typeof row.value !== "string") continue
    const scope = row.scope === "GLOBAL" ? "GLOBAL" : "APPLICATION"
    answers.push({
      id: str(row.id) as string,
      questionKey: str(row.questionKey) as string,
      value: row.value,
      scope,
      category: str(row.category) ?? "unknown",
      approvedAt: str(row.approvedAt),
      useCount: number(row.useCount) ?? 0,
    })
  }
  return answers
}

async function request(
  settings: Settings,
  path: string,
  init: RequestInit,
  timeoutMs: number
): Promise<
  | { ok: true; status: number; data: Record<string, unknown> }
  | AtsFailure
> {
  let response: Response
  try {
    response = await fetch(`${settings.appUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiToken}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError"
    return {
      ok: false,
      kind: "network",
      message: timedOut
        ? "RoleSpec took too long to respond. Try again."
        : `Could not reach ${settings.appUrl}. Check that RoleSpec OS is running.`,
    }
  }

  let data: Record<string, unknown> = {}
  try {
    data = (await response.json()) as Record<string, unknown>
  } catch {
    data = {}
  }
  if (response.ok) return { ok: true, status: response.status, data }

  const message = str(data.error) ?? `RoleSpec returned ${response.status}.`
  const kind: AtsFailureKind =
    response.status === 401
      ? "unauthorized"
      : response.status === 429
        ? "rate_limited"
        : response.status === 409
          ? "conflict"
          : response.status === 400
            ? "validation"
            : "unknown"
  return {
    ok: false,
    kind,
    message,
    status: response.status,
    ...(data.details ? { details: data.details } : {}),
  }
}

export interface CreateAtsPreparationInput {
  sourceUrl: string
  vendor: string
  pageTitle?: string
  jobTitle?: string
  companyName?: string
  jobApplicationId?: string
  resumeId?: string
  fields: FieldDescriptor[]
}

export async function createAtsPreparation(
  settings: Settings,
  input: CreateAtsPreparationInput
): Promise<AtsResult<{ preparation: AtsPreparation; approvedAnswers: AtsApprovedAnswer[]; created: boolean }>> {
  const result = await request(
    settings,
    "/api/extension/ats/preparations",
    {
      method: "POST",
      body: JSON.stringify({
        ...input,
        fields: input.fields
          .filter((field) => /^af-\d+$/.test(field.id))
          .map((field) => ({
            fieldId: field.id,
            label: field.label,
            ...(field.name ? { name: field.name } : {}),
            ...(field.type ? { type: field.type } : {}),
            ...(field.tagName ? { tagName: field.tagName } : {}),
            ...(field.autocomplete ? { autocomplete: field.autocomplete } : {}),
            ...(field.required !== undefined ? { required: field.required } : {}),
            ...(field.options ? { options: field.options } : {}),
            ...(field.requiresSelection !== undefined
              ? { requiresSelection: field.requiresSelection }
              : {}),
            ...(field.frameId !== undefined ? { frameId: field.frameId } : {}),
          })),
      }),
    },
    PREPARE_TIMEOUT_MS
  )
  if (!result.ok) return result
  const preparation = parseAtsPreparation(result.data.preparation)
  if (!preparation) {
    return { ok: false, kind: "unknown", message: "RoleSpec returned an unreadable preparation." }
  }
  return {
    ok: true,
    preparation,
    approvedAnswers: parseApprovedAnswers(result.data.approvedAnswers),
    created: result.data.created === true,
  }
}

export interface AtsResultInput {
  fieldId: string
  questionKey?: string
  status: "FILLED" | "SKIPPED" | "FAILED" | "REVIEW_REQUIRED"
  reason?: string
}

export async function recordAtsResults(
  settings: Settings,
  preparationId: string,
  results: AtsResultInput[]
): Promise<AtsResult<{ preparation: AtsPreparation }>> {
  const result = await request(
    settings,
    `/api/extension/ats/preparations/${encodeURIComponent(preparationId)}`,
    { method: "PATCH", body: JSON.stringify({ action: "RECORD_RESULTS", results }) },
    PREPARE_TIMEOUT_MS
  )
  if (!result.ok) return result
  const preparation = parseAtsPreparation(result.data.preparation)
  return preparation
    ? { ok: true, preparation }
    : { ok: false, kind: "unknown", message: "RoleSpec returned an unreadable preparation." }
}

export async function attachAtsResume(
  settings: Settings,
  preparationId: string,
  resumeId: string
): Promise<AtsResult<{ preparation: AtsPreparation }>> {
  const result = await request(
    settings,
    `/api/extension/ats/preparations/${encodeURIComponent(preparationId)}`,
    { method: "PATCH", body: JSON.stringify({ action: "ATTACH_RESUME", resumeId }) },
    PREPARE_TIMEOUT_MS
  )
  if (!result.ok) return result
  const preparation = parseAtsPreparation(result.data.preparation)
  return preparation
    ? { ok: true, preparation }
    : { ok: false, kind: "unknown", message: "RoleSpec returned an unreadable preparation." }
}

export async function confirmAtsSubmission(
  settings: Settings,
  preparationId: string,
  submitted: boolean,
  note?: string
): Promise<AtsResult<{ preparation: AtsPreparation; applicationStatus: string | null }>> {
  const result = await request(
    settings,
    `/api/extension/ats/preparations/${encodeURIComponent(preparationId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "CONFIRM_SUBMISSION",
        submitted,
        ...(note ? { note } : {}),
      }),
    },
    PREPARE_TIMEOUT_MS
  )
  if (!result.ok) return result
  const preparation = parseAtsPreparation(result.data.preparation)
  if (!preparation) {
    return { ok: false, kind: "unknown", message: "RoleSpec returned an unreadable preparation." }
  }
  return {
    ok: true,
    preparation,
    applicationStatus: str(result.data.applicationStatus),
  }
}

export async function listAtsAnswers(
  settings: Settings,
  preparationId?: string
): Promise<AtsResult<{ answers: AtsApprovedAnswer[] }>> {
  const query = preparationId
    ? `?preparationId=${encodeURIComponent(preparationId)}`
    : ""
  const result = await request(
    settings,
    `/api/extension/ats/answers${query}`,
    { method: "GET" },
    ANSWER_TIMEOUT_MS
  )
  if (!result.ok) return result
  return { ok: true, answers: parseApprovedAnswers(result.data.answers) }
}

export async function saveAtsAnswer(
  settings: Settings,
  input: {
    preparationId?: string
    questionText: string
    value: string
    scope: "APPLICATION" | "GLOBAL"
    replace?: boolean
  }
): Promise<
  AtsResult<{
    answer: AtsApprovedAnswer
    resolvedTaskIds: string[]
    preparation: AtsPreparation | null
  }>
> {
  const result = await request(
    settings,
    "/api/extension/ats/answers",
    { method: "POST", body: JSON.stringify(input) },
    ANSWER_TIMEOUT_MS
  )
  if (!result.ok) return result
  const raw = result.data.answer
  const answers = parseApprovedAnswers(raw ? [raw] : [])
  const preparation = result.data.preparation
    ? parseAtsPreparation(result.data.preparation)
    : null
  if (answers.length === 0) {
    return { ok: false, kind: "unknown", message: "RoleSpec did not return the saved answer." }
  }
  return {
    ok: true,
    answer: answers[0],
    resolvedTaskIds: Array.isArray(result.data.resolvedTaskIds)
      ? result.data.resolvedTaskIds.filter((id): id is string => typeof id === "string")
      : [],
    preparation,
  }
}

export async function revokeAtsAnswer(
  settings: Settings,
  answerId: string
): Promise<AtsResult<{ revoked: boolean; preparation: AtsPreparation | null }>> {
  const result = await request(
    settings,
    "/api/extension/ats/answers",
    { method: "DELETE", body: JSON.stringify({ id: answerId }) },
    ANSWER_TIMEOUT_MS
  )
  if (!result.ok) return result
  return {
    ok: true,
    revoked: result.data.revoked === true,
    preparation: result.data.preparation ? parseAtsPreparation(result.data.preparation) : null,
  }
}

export interface ResumePdf {
  base64: string
  filename: string
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function fetchResumePdf(
  settings: Settings,
  resumeId: string
): Promise<AtsResult<ResumePdf>> {
  let response: Response
  try {
    response = await fetch(
      `${settings.appUrl}/api/extension/resumes/${encodeURIComponent(resumeId)}/pdf`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${settings.apiToken}` },
        signal: AbortSignal.timeout(PDF_TIMEOUT_MS),
      }
    )
  } catch {
    return {
      ok: false,
      kind: "network",
      message: "Could not download the resume PDF from RoleSpec.",
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      kind: response.status === 401 ? "unauthorized" : "unknown",
      message:
        response.status === 401
          ? "Token rejected. Reconnect the extension."
          : "RoleSpec could not render that resume.",
      status: response.status,
    }
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength === 0 || buffer.byteLength > 12 * 1024 * 1024) {
    return { ok: false, kind: "unknown", message: "The rendered resume was not a usable PDF." }
  }
  const disposition = response.headers.get("content-disposition") ?? ""
  const match = /filename="([^"]+)"/i.exec(disposition)
  return {
    ok: true,
    base64: bytesToBase64(new Uint8Array(buffer)),
    filename: match?.[1] ?? "resume.pdf",
  }
}
