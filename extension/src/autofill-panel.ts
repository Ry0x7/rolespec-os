/**
 * Side-panel controller for ATS preparation.
 *
 * The safety contract is visible in the UI:
 *  - scanning reads question text and control metadata, never the values already
 *    on the page;
 *  - the server re-classifies every field and decides what may be filled;
 *  - nothing is written until the user presses Fill and then Confirm;
 *  - sensitive, essay, choice, unknown and file fields go to a persistent review
 *    queue, where an answer can be approved for this application or all future
 *    ones, edited and revoked with its provenance kept;
 *  - a chosen resume is attached only after the user presses Attach, with a
 *    download/manual-select fallback when the page refuses the file;
 *  - a short-lived submit guard blocks an accidental submission while reviewing;
 *  - the extension never clicks Submit, and the tracker moves to APPLIED only
 *    after the user explicitly confirms what happened.
 */

import {
  buildFillPlan,
  formSignature,
  type ApprovedAnswers,
  type FieldDescriptor,
  type FillPlan,
  type PlannedFill,
  type ProfileFacts,
  type ReviewField,
} from "./autofill-core"
import {
  armSubmitGuard,
  attachResumeToPage,
  disarmSubmitGuard,
  fillAutofillFields,
  inspectAutofillPage,
  scanAutofillFields,
  type FieldFillResult,
  type FillAssignment,
  type PageGuardInfo,
  type ScannedField,
} from "./autofill-page"
import { detectAtsAdapter, fillingLabel, type AtsAdapter } from "./ats-adapters"
import {
  attachAtsResume,
  confirmAtsSubmission,
  createAtsPreparation,
  fetchResumePdf,
  recordAtsResults,
  revokeAtsAnswer,
  saveAtsAnswer,
  type AtsApprovedAnswer,
  type AtsPreparation,
  type AtsResultInput,
  type AtsServerField,
} from "./ats-api"
import {
  clearApprovedAnswers,
  deleteApprovedAnswer,
  loadApprovedAnswers,
  saveApprovedAnswer,
} from "./approved-answers"
import { fetchProfile, fetchResumes } from "./api"
import { hasCredentials } from "./settings"
import { hostLabelFor, originPatternFor } from "./site-access"
import type { ResumeSummary, Settings } from "./types"

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}

type StatusKind = "info" | "ok" | "warn" | "error"

interface PanelDeps {
  getSettings: () => Settings
}

interface FillResultRow {
  fieldId: string
  frameId?: number
  label: string
  status: "FILLED" | "FAILED" | "REVIEW_REQUIRED" | "SKIPPED"
  reason?: string
}

interface ScanState {
  tabId: number
  url: string
  adapter: AtsAdapter
  title: string
  fields: FieldDescriptor[]
  plan: FillPlan
  profile: ProfileFacts
  resumes: ResumeSummary[]
  serverAnswers: Map<string, AtsApprovedAnswer>
  approved: ApprovedAnswers
  preparation: AtsPreparation | null
  signature: string
  guardCount: number
  captchaDetected: boolean
  partialFrames: boolean
  manualOnly: boolean
  results: FillResultRow[]
  attachedResumeId: string | null
  conflict: { key: string; value: string; scope: "APPLICATION" | "GLOBAL"; message: string } | null
}

interface PendingGrant {
  tabId: number
  pattern: string
  host: string
}

function statusClass(kind: StatusKind): string {
  return `notice${
    kind === "error"
      ? " notice-error"
      : kind === "ok"
        ? " notice-ok"
        : kind === "warn"
          ? " notice-warn"
          : ""
  }`
}

function suggestionFor(item: ReviewField, profile: ProfileFacts): string {
  if (item.suggestedValue) return item.suggestedValue
  switch (item.category) {
    case "authorization":
      return (profile.workAuthorization ?? "").trim()
    case "sponsorship":
      if (profile.requiresSponsorship === true) return "Yes"
      if (profile.requiresSponsorship === false) return "No"
      return ""
    case "compensation": {
      if (profile.salaryMin == null && profile.salaryMax == null) return ""
      const currency = profile.salaryCurrency ?? ""
      if (profile.salaryMin != null && profile.salaryMax != null) {
        return `${currency} ${profile.salaryMin}–${profile.salaryMax}`.trim()
      }
      return `${currency} ${profile.salaryMin ?? profile.salaryMax}`.trim()
    }
    case "work":
      return (profile.currentRole ?? "").trim()
    default:
      return ""
  }
}

function frameKey(fieldId: string, frameId?: number): string {
  return `${frameId ?? 0}:${fieldId}`
}

function approvedMap(local: ApprovedAnswers, server: Map<string, AtsApprovedAnswer>): ApprovedAnswers {
  // Server answers win: they carry the approval and scope the user last chose.
  const merged: ApprovedAnswers = { ...local }
  for (const [key, answer] of server) merged[key] = answer.value
  return merged
}

function serverFieldMap(prep: AtsPreparation | null): Map<string, AtsServerField> {
  const map = new Map<string, AtsServerField>()
  for (const field of prep?.plan?.fields ?? []) {
    map.set(frameKey(field.fieldId, field.frameId), field)
  }
  return map
}

/**
 * Refuses to write anything the server marked REVIEW or ATTACH_RESUME, even if
 * a stale local plan thought it was safe. Blocked fields become visible review
 * rows rather than silently disappearing.
 */
function validatePlanAgainstServer(
  plan: FillPlan,
  fields: FieldDescriptor[],
  prep: AtsPreparation | null
): { plan: FillPlan; blocked: number } {
  if (!prep?.plan) return { plan, blocked: 0 }
  const serverFields = serverFieldMap(prep)
  const byFrameAndId = new Map(fields.map((field) => [frameKey(field.id, field.frameId), field]))
  const allowed: PlannedFill[] = []
  const review = [...plan.review]
  let blocked = 0

  for (const fill of plan.fills) {
    const server = serverFields.get(frameKey(fill.fieldId, fill.frameId))
    if (server?.decision === "FILL") {
      allowed.push(fill)
      continue
    }
    blocked += 1
    const field = byFrameAndId.get(frameKey(fill.fieldId, fill.frameId))
    const already = review.some(
      (item) => item.fieldId === fill.fieldId && (item.frameId ?? 0) === (fill.frameId ?? 0)
    )
    if (!already && field) {
      review.push({
        fieldId: fill.fieldId,
        label: fill.label,
        key: fill.key,
        category: server?.category as ReviewField["category"] ?? "unknown",
        sensitivity: "unknown",
        reason: server?.reason ?? "RoleSpec's server did not approve this write.",
        required: field.required === true,
        ...(field.options ? { options: field.options } : {}),
        ...(typeof field.frameId === "number" ? { frameId: field.frameId } : {}),
      })
    }
  }

  // A server-only review row (for example a control the local copy classified
  // differently) must still be visible.
  for (const server of serverFields.values()) {
    if (server.decision === "FILL") continue
    const exists = [...allowed, ...review].some(
      (item) =>
        item.fieldId === server.fieldId &&
        ((("frameId" in item ? item.frameId : undefined) ?? 0) === (server.frameId ?? 0))
    )
    if (exists) continue
    const field = byFrameAndId.get(frameKey(server.fieldId, server.frameId))
    review.push({
      fieldId: server.fieldId,
      label: server.label || field?.label || "Untitled field",
      key: server.questionKey,
      category: server.category as ReviewField["category"],
      sensitivity: "unknown",
      reason: server.reason ?? "RoleSpec did not approve this field.",
      required: server.required,
      ...(typeof server.frameId === "number" ? { frameId: server.frameId } : {}),
    })
  }

  return {
    plan: { fills: allowed, review, skipped: plan.skipped },
    blocked,
  }
}

async function executeAllFrames<T>(
  tabId: number,
  func: () => T
): Promise<{ results: chrome.scripting.InjectionResult<T>[]; partial: boolean }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func,
    })
    return { results: results as chrome.scripting.InjectionResult<T>[], partial: false }
  } catch {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func })
    return { results: results as chrome.scripting.InjectionResult<T>[], partial: true }
  }
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: "application/pdf" })
}

function downloadPdf(base64: string, filename: string): void {
  const url = URL.createObjectURL(base64ToBlob(base64))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename || "resume.pdf"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export function initAutofillPanel(deps: PanelDeps) {
  const scanButton = el<HTMLButtonElement>("autofill-scan")
  const fillButton = el<HTMLButtonElement>("autofill-fill")
  const grantButton = el<HTMLButtonElement>("autofill-grant")
  const clearButton = el<HTMLButtonElement>("autofill-clear")
  const releaseGuardButton = el<HTMLButtonElement>("autofill-release-guard")
  const status = el<HTMLParagraphElement>("autofill-status")
  const summary = el<HTMLParagraphElement>("autofill-summary")
  const siteNote = el<HTMLParagraphElement>("autofill-site")
  const vendorNote = el<HTMLParagraphElement>("autofill-vendor")
  const guardBox = el<HTMLElement>("autofill-guard")
  const guardText = el<HTMLParagraphElement>("autofill-guard-text")
  const recordBox = el<HTMLElement>("autofill-record")
  const recordText = el<HTMLParagraphElement>("autofill-record-text")
  const review = el<HTMLElement>("autofill-review")
  const reviewList = el<HTMLUListElement>("autofill-review-list")
  const fillPreview = el<HTMLElement>("autofill-fill-preview")
  const fillList = el<HTMLUListElement>("autofill-fill-list")
  const submitBox = el<HTMLElement>("autofill-submit")
  const submitNote = el<HTMLTextAreaElement>("autofill-submit-note")
  const confirmSubmittedButton = el<HTMLButtonElement>("autofill-confirm-submitted")
  const confirmNotSubmittedButton = el<HTMLButtonElement>("autofill-confirm-not-submitted")
  const submitStatus = el<HTMLParagraphElement>("autofill-submit-status")

  let state: ScanState | null = null
  let armed = false
  let busy = false
  let pendingGrant: PendingGrant | null = null
  let scanSeq = 0

  function showStatus(kind: StatusKind, message: string): void {
    status.textContent = message
    status.className = statusClass(kind)
    status.hidden = false
  }

  function clearStatus(): void {
    status.hidden = true
    status.textContent = ""
  }

  function setBusy(next: boolean, label?: string): void {
    busy = next
    scanButton.disabled = next
    scanButton.textContent = next ? (label ?? "Scanning…") : "Scan this page"
  }

  function applicationApprovedKeys(): Set<string> {
    return new Set(
      [...(state?.serverAnswers.values() ?? [])]
        .filter((answer) => answer.scope === "APPLICATION")
        .map((answer) => answer.questionKey)
    )
  }

  function rebuildPlan(): void {
    if (!state) return
    const merged = approvedMap(state.approved, state.serverAnswers)
    const local = buildFillPlan(state.profile, state.fields, merged, {
      applicationApprovedKeys: applicationApprovedKeys(),
    })
    const validated = validatePlanAgainstServer(local, state.fields, state.preparation)
    state.plan = validated.plan
    armed = false
    render()
  }

  function taskFor(item: ReviewField): AtsPreparation["openReviewTasks"][number] | undefined {
    const tasks = state?.preparation?.openReviewTasks ?? []
    return tasks.find(
      (task) =>
        task.question === item.label ||
        (task.category === `ats:${item.category}` && task.question === item.label)
    )
  }

  function serverAnswerFor(item: ReviewField): AtsApprovedAnswer | undefined {
    return state?.serverAnswers.get(item.key)
  }

  function renderGuard(): void {
    if (!state || state.guardCount === 0) {
      guardBox.hidden = true
      return
    }
    guardBox.hidden = false
    guardText.textContent =
      `Submit guard active: ${state.guardCount} submit control${state.guardCount === 1 ? "" : "s"} ` +
      `will be blocked until you release it (or it expires in 5 minutes).` +
      (state.captchaDetected
        ? " A CAPTCHA is present; RoleSpec will not interact with it."
        : "")
  }

  function renderRecord(): void {
    const prep = state?.preparation
    if (!prep) {
      recordBox.hidden = true
      submitBox.hidden = true
      return
    }
    recordBox.hidden = false
    recordText.textContent =
      `${prep.status.replace(/_/g, " ").toLowerCase()} · ${prep.fieldsDetected} fields detected · ` +
      `${prep.fieldsFilled} filled · ${prep.fieldsBlocked} need review` +
      (prep.resumeTitle ? ` · resume: ${prep.resumeTitle}` : " · no resume selected") +
      ` · ${prep.sourceUrl}`

    const terminal = ["SUBMITTED", "NOT_SUBMITTED", "ABANDONED"].includes(prep.status)
    submitBox.hidden = terminal || prep.fieldsDetected === 0
    if (terminal) {
      submitStatus.hidden = false
      submitStatus.textContent =
        prep.status === "SUBMITTED"
          ? `Recorded as submitted${prep.submittedAt ? ` on ${new Date(prep.submittedAt).toLocaleString()}` : ""}.`
          : prep.status === "NOT_SUBMITTED"
            ? "Recorded as not submitted. Your tracker was not moved."
            : "This preparation was abandoned."
    }
  }

  function render(): void {
    if (!state) {
      summary.hidden = true
      fillButton.hidden = true
      fillPreview.hidden = true
      fillList.replaceChildren()
      review.hidden = true
      reviewList.replaceChildren()
      recordBox.hidden = true
      submitBox.hidden = true
      guardBox.hidden = true
      return
    }

    const { fills, review: reviewItems } = state.plan
    summary.hidden = false
    const recordState = state.preparation
      ? `Saved as a draft application (${state.preparation.status.replace(/_/g, " ").toLowerCase()}).`
      : "RoleSpec OS is offline, so this scan is not saved as an application record."
    summary.textContent =
      `${fills.length} field${fills.length === 1 ? "" : "s"} ready to fill · ` +
      `${reviewItems.length} to review. ${recordState}`

    renderGuard()
    renderRecord()

    fillButton.hidden = fills.length === 0 || state.manualOnly
    fillButton.disabled = busy || fills.length === 0
    fillButton.textContent = armed
      ? `Confirm fill ${fills.length} field${fills.length === 1 ? "" : "s"}`
      : `Fill ${fills.length} field${fills.length === 1 ? "" : "s"}`

    fillPreview.hidden = fills.length === 0 && state.results.length === 0
    fillList.replaceChildren()
    for (const fill of fills) {
      const li = document.createElement("li")
      li.className = "review-item"

      const head = document.createElement("div")
      head.className = "review-head"
      const label = document.createElement("span")
      label.className = "review-label"
      label.textContent = fill.label
      head.appendChild(label)

      const source = document.createElement("span")
      source.className = "review-saved"
      source.textContent =
        fill.source === "approved_answer" ? "Approved answer" : "Profile fact"
      head.appendChild(source)

      const result = state.results.find(
        (row) =>
          row.fieldId === fill.fieldId && (row.frameId ?? 0) === (fill.frameId ?? 0)
      )
      if (result) {
        const badge = document.createElement("span")
        badge.className = result.status === "FILLED" ? "review-saved" : "review-category"
        badge.textContent = result.status === "FILLED" ? "Filled" : result.reason ?? "Not filled"
        head.appendChild(badge)
      }

      const value = document.createElement("p")
      value.className = "fill-value"
      value.textContent = fill.value

      li.append(head, value)
      if (result?.status === "FAILED") {
        const reason = document.createElement("p")
        reason.className = "hint"
        reason.textContent = result.reason ?? "The control could not be set."
        li.appendChild(reason)
      }
      fillList.appendChild(li)
    }

    review.hidden = reviewItems.length === 0
    reviewList.replaceChildren()

    for (const item of reviewItems) {
      const li = document.createElement("li")
      li.className = "review-item"

      const head = document.createElement("div")
      head.className = "review-head"
      const title = document.createElement("span")
      title.className = "review-label"
      title.textContent = item.label
      head.appendChild(title)

      if (item.required) {
        const required = document.createElement("span")
        required.className = "required"
        required.textContent = "required"
        head.appendChild(required)
      }

      const category = document.createElement("span")
      category.className = "review-category"
      category.textContent = item.category
      head.appendChild(category)

      const task = taskFor(item)
      if (task) {
        const taskBadge = document.createElement("span")
        taskBadge.className = "review-saved"
        taskBadge.textContent = "Review task"
        taskBadge.title = task.reason
        head.appendChild(taskBadge)
      }

      const reason = document.createElement("p")
      reason.className = "hint"
      reason.textContent = task?.reason || item.reason

      if (item.category === "document" || item.isResumeUpload) {
        const docBox = document.createElement("div")
        docBox.className = "resume-attachment-card"
        const docNotice = document.createElement("p")
        docNotice.className = "hint"
        docNotice.textContent =
          "Choose the resume you want to use. RoleSpec attaches it only when you press the button; " +
          "if the form refuses the file, the PDF downloads for manual selection."

        const selectRow = document.createElement("label")
        selectRow.className = "field"
        const selectLabel = document.createElement("span")
        selectLabel.textContent = "Resume"
        const select = document.createElement("select")
        select.setAttribute("aria-label", "Resume to attach")
        for (const resume of state.resumes) {
          const option = document.createElement("option")
          option.value = resume.id
          option.textContent = resume.title || "Untitled resume"
          if (
            resume.id === state.attachedResumeId ||
            (!state.attachedResumeId && resume.id === state.preparation?.resumeId)
          ) {
            option.selected = true
          }
          select.appendChild(option)
        }
        selectRow.append(selectLabel, select)

        const actions = document.createElement("div")
        actions.className = "review-input-row"
        const attach = document.createElement("button")
        attach.type = "button"
        attach.className = "button button-quiet button-mini"
        attach.textContent = "Attach selected resume"
        attach.disabled = !state.resumes.length
        attach.addEventListener("click", () => {
          const resumeId = select.value
          if (resumeId) void attachResume(item, resumeId)
        })
        actions.appendChild(attach)

        const openApp = document.createElement("button")
        openApp.type = "button"
        openApp.className = "button button-quiet button-mini"
        openApp.textContent = "Open Resumes"
        openApp.addEventListener("click", () => {
          const settings = deps.getSettings()
          void chrome.tabs.create({ url: `${settings.appUrl}/resumes` })
        })
        actions.appendChild(openApp)

        if (!state.resumes.length) {
          const noResumes = document.createElement("p")
          noResumes.className = "hint"
          noResumes.textContent =
            "No active resumes were found. Create or import one in RoleSpec OS, then scan again."
          docBox.append(docNotice, noResumes, actions)
        } else {
          docBox.append(docNotice, selectRow, actions)
        }

        if (state.attachedResumeId) {
          const attached = document.createElement("p")
          attached.className = "hint"
          attached.textContent =
            "Resume selected and recorded. Check the file name on the employer's form before submitting."
          docBox.appendChild(attached)
        }

        li.append(head, reason, docBox)
        reviewList.appendChild(li)
        continue
      }

      const saved = serverAnswerFor(item)
      const localSaved = !saved ? state.approved[item.key] : undefined
      const currentValue = saved?.value ?? localSaved ?? suggestionFor(item, state.profile)
      const isGlobal = saved?.scope === "GLOBAL"

      const provenance = document.createElement("p")
      provenance.className = "hint"
      if (saved) {
        provenance.textContent =
          `${isGlobal ? "Saved for all applications" : "Saved for this application only"}` +
          (saved.approvedAt
            ? ` · approved ${new Date(saved.approvedAt).toLocaleDateString()}`
            : "") +
          (saved.useCount > 0 ? ` · used ${saved.useCount}×` : "")
      } else if (localSaved) {
        provenance.textContent = "Saved in this browser from an earlier session."
      }

      const inputRow = document.createElement("div")
      inputRow.className = "review-input-row"

      const input = document.createElement("input")
      input.type = "text"
      input.maxLength = 2000
      input.autocomplete = "off"
      input.placeholder = "Your answer"
      input.setAttribute("aria-label", `Answer for ${item.label}`)
      input.value = currentValue

      const conflict =
        state.conflict && state.conflict.key === item.key ? state.conflict : null

      const save = document.createElement("button")
      save.type = "button"
      save.className = "button button-quiet button-mini"
      save.textContent = saved || localSaved ? "Update answer" : "Approve answer"
      save.addEventListener("click", () => {
        const value = input.value.trim()
        if (!value) {
          showStatus("warn", "Type an answer before approving it.")
          input.focus()
          return
        }
        const rememberAll = inputRow.dataset.rememberAll === "1"
        const scope = isGlobal || rememberAll ? "GLOBAL" : "APPLICATION"
        void persistAnswer(item, value, scope, false, saved)
      })
      inputRow.appendChild(input)
      inputRow.appendChild(save)

      if (saved && !isGlobal) {
        const makeGlobal = document.createElement("button")
        makeGlobal.type = "button"
        makeGlobal.className = "button button-quiet button-mini"
        makeGlobal.textContent = "Remember for all applications"
        makeGlobal.addEventListener("click", () => {
          const value = input.value.trim()
          if (!value) return
          void persistAnswer(item, value, "GLOBAL", true, saved)
        })
        inputRow.appendChild(makeGlobal)
      }

      if (saved && isGlobal && item.sensitivity === "sensitive") {
        const useHere = document.createElement("button")
        useHere.type = "button"
        useHere.className = "button button-quiet button-mini"
        useHere.textContent = "Use for this application"
        useHere.title =
          "Copies this approved answer into an application-only approval; it still will not be filled until you press Fill."
        useHere.addEventListener("click", () => {
          const value = input.value.trim()
          if (!value) return
          void persistAnswer(item, value, "APPLICATION", false, undefined)
        })
        inputRow.appendChild(useHere)
      }

      if (saved) {
        const revoke = document.createElement("button")
        revoke.type = "button"
        revoke.className = "button button-quiet button-mini"
        revoke.textContent = "Revoke"
        revoke.setAttribute("aria-label", `Revoke the approved answer for ${item.label}`)
        revoke.addEventListener("click", () => void revokeSavedAnswer(item, saved))
        inputRow.appendChild(revoke)
      } else if (localSaved) {
        const forget = document.createElement("button")
        forget.type = "button"
        forget.className = "button button-quiet button-mini"
        forget.textContent = "Forget"
        forget.addEventListener("click", () => {
          void deleteApprovedAnswer(item.label).then(async (next) => {
            if (!state) return
            state.approved = next
            showStatus("ok", "Browser answer removed.")
            rebuildPlan()
          })
        })
        inputRow.appendChild(forget)
      }

      const scopeRow = document.createElement("div")
      scopeRow.className = "review-input-row"
      if (!saved && !localSaved && state.preparation) {
        const rememberLabel = document.createElement("label")
        rememberLabel.className = "hint"
        const remember = document.createElement("input")
        remember.type = "checkbox"
        remember.setAttribute("aria-label", "Remember this answer for all future applications")
        rememberLabel.append(
          remember,
          document.createTextNode(" Remember for all future applications")
        )
        remember.addEventListener("change", () => {
          remember.dataset.checked = remember.checked ? "1" : "0"
        })
        scopeRow.appendChild(rememberLabel)
        // The save handler reads this checkbox through the row's dataset.
        inputRow.dataset.rememberAll = "0"
        remember.addEventListener("change", () => {
          inputRow.dataset.rememberAll = remember.checked ? "1" : "0"
        })
      }

      if (conflict) {
        const conflictNote = document.createElement("p")
        conflictNote.className = "notice notice-warn"
        conflictNote.textContent = conflict.message
        const replace = document.createElement("button")
        replace.type = "button"
        replace.className = "button button-quiet button-mini"
        replace.textContent = "Replace saved answer"
        replace.addEventListener("click", () => {
          void persistAnswer(item, conflict.value, conflict.scope, true, saved)
        })
        conflictNote.appendChild(document.createTextNode(" "))
        conflictNote.appendChild(replace)
        li.append(head, reason, provenance, conflictNote)
      } else {
        li.append(head, reason, provenance)
      }

      if (item.options && item.options.length > 0) {
        const options = document.createElement("p")
        options.className = "hint"
        options.textContent = `Choices on the form: ${item.options.join(" · ")}`
        li.appendChild(options)
      }

      li.append(inputRow)
      if (scopeRow.childElementCount > 0) li.appendChild(scopeRow)
      reviewList.appendChild(li)
    }
  }

  async function currentTab(): Promise<chrome.tabs.Tab | null> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      return tab ?? null
    } catch {
      return null
    }
  }

  async function updateSiteNote(): Promise<void> {
    const tab = await currentTab()
    const adapter = detectAtsAdapter(tab?.url)
    if (!adapter) {
      siteNote.textContent =
        "This page is not a supported application form. Open a Greenhouse, Lever, Ashby, Workable, BambooHR, SmartRecruiters, Jobvite, iCIMS, Taleo, Workday, Recruitee, Teamtailor or Personio form."
      vendorNote.hidden = true
      return
    }
    siteNote.textContent = `Supported form detected on ${hostLabelFor(tab?.url) ?? adapter.label}.`
    vendorNote.hidden = false
    vendorNote.textContent = `${adapter.label} · ${fillingLabel(adapter.formFilling)} · ${adapter.note}`
  }

  async function releaseGuard(tabId?: number): Promise<boolean> {
    if (!tabId) return false
    try {
      const { results } = await executeAllFrames(tabId, disarmSubmitGuard)
      return results.some((result) => result.result === true)
    } catch {
      return false
    }
  }

  async function attachResume(item: ReviewField, resumeId: string): Promise<void> {
    if (!state || busy) return
    const settings = deps.getSettings()
    if (!state.preparation) {
      showStatus(
        "warn",
        "RoleSpec OS is offline. Open Resumes in RoleSpec, download the PDF, and attach it manually."
      )
      return
    }
    busy = true
    showStatus("info", "Preparing the resume PDF…")
    const pdf = await fetchResumePdf(settings, resumeId)
    if (!pdf.ok) {
      busy = false
      showStatus("error", pdf.message)
      return
    }

    let attached = false
    let attachReason: string | undefined
    try {
      const target =
        typeof item.frameId === "number"
          ? { tabId: state.tabId, frameIds: [item.frameId] }
          : { tabId: state.tabId }
      const injection = await chrome.scripting.executeScript({
        target,
        func: attachResumeToPage,
        args: [item.fieldId, pdf.base64, pdf.filename],
      })
      const outcome = injection[0]?.result as
        | { attached: boolean; reason?: string }
        | undefined
      attached = outcome?.attached === true
      attachReason = outcome?.reason
    } catch {
      attached = false
      attachReason = "The form could not be reached"
    }

    // Record the user's explicit choice before anything else, so the staged
    // application keeps the resume even when the page rejects the file.
    const recorded = await attachAtsResume(settings, state.preparation.id, resumeId)
    if (recorded.ok && state) {
      state.preparation = recorded.preparation
      state.serverAnswers = serverAnswersFromPreparation()
    }
    state.attachedResumeId = resumeId

    if (attached) {
      showStatus("ok", "Resume attached. Check the file name on the form before submitting.")
      if (state.preparation) {
        await reportResults([
          {
            fieldId: item.fieldId,
            questionKey: item.key,
            status: "FILLED",
          },
        ])
      }
    } else {
      downloadPdf(pdf.base64, pdf.filename)
      showStatus(
        "warn",
        `${attachReason ?? "The form did not accept the file"}. The PDF was downloaded — choose it manually in the form's file picker.`
      )
      if (state.preparation) {
        await reportResults([
          {
            fieldId: item.fieldId,
            questionKey: item.key,
            status: "FAILED",
            reason: "Manual file selection required",
          },
        ])
      }
    }
    busy = false
    rebuildPlan()
  }

  function serverAnswersFromPreparation(): Map<string, AtsApprovedAnswer> {
    // The preparation response does not repeat answer values (they live in the
    // approved-answer table). Reuse the values this panel already has and add
    // nothing new; a fresh scan fetches the full list.
    return state?.serverAnswers ?? new Map()
  }

  async function persistAnswer(
    item: ReviewField,
    value: string,
    scope: "APPLICATION" | "GLOBAL",
    replace: boolean,
    existing?: AtsApprovedAnswer
  ): Promise<void> {
    if (!state) return
    const settings = deps.getSettings()
    const prep = state.preparation

    if (!prep) {
      // Offline fallback: nothing is written to RoleSpec. A browser answer is
      // only stored when the user explicitly chose the all-applications scope.
      if (scope === "GLOBAL") {
        const next = await saveApprovedAnswer(item.label, value)
        state.approved = next
        showStatus("ok", "Saved in this browser only. RoleSpec OS was not reachable.")
        rebuildPlan()
      } else {
        state.approved[item.key] = value
        showStatus("warn", "Answer kept for this panel only; connect RoleSpec to save it.")
        rebuildPlan()
      }
      return
    }

    busy = true
    const result = await saveAtsAnswer(settings, {
      preparationId: prep.id,
      questionText: item.label,
      value,
      scope,
      ...(existing && scope === existing.scope ? { replace: replace || value !== existing.value } : {}),
    })
    busy = false

    if (!result.ok) {
      if (result.kind === "conflict") {
        state.conflict = {
          key: item.key,
          value,
          scope,
          message:
            "A different approved answer already exists for this exact question. Review it, then replace it explicitly.",
        }
        render()
        return
      }
      showStatus("error", result.message)
      return
    }

    state.conflict = null
    if (result.preparation) {
      state.preparation = result.preparation
      state.serverAnswers = serverAnswersFromPreparation()
    }
    state.serverAnswers.set(item.key, result.answer)
    // Keep the browser cache in sync only for deliberately global answers.
    if (scope === "GLOBAL") {
      state.approved = await saveApprovedAnswer(item.label, value)
    } else {
      state.approved[item.key] = value
    }
    showStatus(
      "ok",
      scope === "GLOBAL"
        ? "Answer approved for this and all future applications."
        : "Answer approved for this application."
    )
    rebuildPlan()
  }

  async function revokeSavedAnswer(item: ReviewField, answer: AtsApprovedAnswer): Promise<void> {
    if (!state) return
    const settings = deps.getSettings()
    if (!state.preparation) {
      state.serverAnswers.delete(item.key)
      item.suggestedValue = undefined
      rebuildPlan()
      return
    }
    const result = await revokeAtsAnswer(settings, answer.id)
    if (!result.ok) {
      showStatus("error", result.message)
      return
    }
    state.serverAnswers.delete(item.key)
    if (result.preparation) state.preparation = result.preparation
    if (answer.scope === "GLOBAL") {
      state.approved = await deleteApprovedAnswer(item.label)
    }
    showStatus(
      "ok",
      "Approval revoked. It will not be reused; the question is back in the review queue."
    )
    rebuildPlan()
  }

  async function reportResults(results: AtsResultInput[]): Promise<void> {
    if (!state?.preparation || results.length === 0) return
    const settings = deps.getSettings()
    const response = await recordAtsResults(settings, state.preparation.id, results)
    if (response.ok) {
      state.preparation = response.preparation
    }
  }

  async function scanTab(tab: chrome.tabs.Tab): Promise<void> {
    if (tab.id === undefined) {
      showStatus("error", "No active tab to scan.")
      return
    }
    const seq = ++scanSeq
    setBusy(true)
    clearStatus()
    pendingGrant = null
    grantButton.hidden = true
    armed = false

    const settings = deps.getSettings()
    if (!hasCredentials(settings) || !settings.apiToken) {
      setBusy(false)
      showStatus("error", "Connect this clipper to RoleSpec first.")
      return
    }

    const adapter = detectAtsAdapter(tab.url)
    if (!adapter) {
      setBusy(false)
      showStatus("error", "This page is not a supported ATS application form.")
      return
    }

    // Release any guard left on the previous tab before reading a new one.
    if (state && state.tabId !== tab.id) void releaseGuard(state.tabId)

    let fields: FieldDescriptor[] = []
    let guardCount = 0
    let captchaDetected = false
    let partialFrames = false
    try {
      const scan = await executeAllFrames(tab.id, scanAutofillFields)
      partialFrames = scan.partial
      for (const injection of scan.results) {
        const frameId = typeof injection.frameId === "number" ? injection.frameId : 0
        const scanned = (injection.result ?? []) as ScannedField[]
        fields.push(
          ...scanned.map((field) => ({
            ...field,
            frameId,
          }))
        )
      }
      const guard = await executeAllFrames(tab.id, armSubmitGuard)
      guardCount = guard.results.reduce(
        (total, injection) => total + (typeof injection.result === "number" ? injection.result : 0),
        0
      )
      const info = await executeAllFrames(tab.id, inspectAutofillPage)
      for (const injection of info.results) {
        const result = injection.result as PageGuardInfo | undefined
        if (!result) continue
        captchaDetected = captchaDetected || result.captchaDetected
        guardCount = Math.max(guardCount, result.submitControlCount)
      }
    } catch {
      setBusy(false)
      showStatus(
        "error",
        "RoleSpec could not read this page. Reload it after granting site access and try again."
      )
      return
    }
    if (seq !== scanSeq) return

    const [profileResult, resumesResult] = await Promise.all([
      fetchProfile(settings),
      fetchResumes(settings),
    ])
    if (seq !== scanSeq) return
    setBusy(false)
    if (!profileResult.ok) {
      showStatus("error", profileResult.message)
      return
    }

    const approved = await loadApprovedAnswers()
    if (seq !== scanSeq) return

    const manualOnly = adapter.formFilling === "manual"
    const draftState: ScanState = {
      tabId: tab.id,
      url: tab.url ?? "",
      adapter,
      title: tab.title ?? "",
      fields,
      plan: buildFillPlan(profileResult.profile, fields, approved),
      profile: profileResult.profile,
      resumes: resumesResult.ok ? resumesResult.resumes : [],
      serverAnswers: new Map(),
      approved,
      preparation: null,
      signature: formSignature(fields),
      guardCount,
      captchaDetected,
      partialFrames,
      manualOnly,
      results: [],
      attachedResumeId: null,
      conflict: null,
    }
    state = draftState

    // Persist the detected form and let the server make the safety decisions.
    // A failure is not fatal: safe profile fields still fill locally, but no
    // application record is claimed and application-scoped answers are refused.
    if (fields.length > 0) {
      const prepared = await createAtsPreparation(settings, {
        sourceUrl: tab.url ?? "",
        vendor: adapter.key,
        pageTitle: tab.title ?? undefined,
        fields,
      })
      if (seq !== scanSeq) return
      if (prepared.ok) {
        draftState.preparation = prepared.preparation
        draftState.serverAnswers = new Map(
          prepared.approvedAnswers.map((answer) => [answer.questionKey, answer])
        )
        draftState.attachedResumeId = prepared.preparation.resumeId
      } else if (prepared.kind !== "unauthorized") {
        showStatus(
          "warn",
          `${prepared.message} Safe profile fields still work locally, but no application record was saved.`
        )
      }
    }

    rebuildPlan()
    if (fields.length === 0) {
      showStatus(
        "warn",
        "No visible form fields were found. Open the application form itself, not the job description."
      )
      return
    }
    if (manualOnly) {
      showStatus(
        "warn",
        `${adapter.label} is a manual-fallback ATS. Fields are listed for review, but RoleSpec will not write them.`
      )
      return
    }
    const frameNote = partialFrames
      ? " Some embedded frames could not be read; complete those steps manually."
      : ""
    showStatus(
      "info",
      `Scan complete. Review the fields below, then press Fill. RoleSpec never submits an application.${frameNote}`
    )
  }

  async function onScan(): Promise<void> {
    if (busy) return
    const tab = await currentTab()
    if (!tab || tab.id === undefined) {
      showStatus("error", "No active tab to scan.")
      return
    }
    await updateSiteNote()
    const adapter = detectAtsAdapter(tab.url)
    if (!adapter) {
      showStatus("error", "This page is not a supported ATS application form.")
      return
    }

    const pattern = originPatternFor(tab.url)
    if (!pattern) {
      showStatus("error", "This page cannot be read.")
      return
    }

    let granted = false
    try {
      granted = await chrome.permissions.contains({ origins: [pattern] })
    } catch {
      granted = false
    }

    if (!granted) {
      pendingGrant = { tabId: tab.id, pattern, host: adapter.label }
      fillButton.hidden = true
      review.hidden = true
      grantButton.hidden = false
      grantButton.textContent = `Allow RoleSpec to read ${adapter.label}`
      showStatus("warn", "RoleSpec needs your permission to inspect this site's form fields.")
      return
    }

    await scanTab(tab)
  }

  function onGrant(): void {
    const pending = pendingGrant
    if (!pending) return
    pendingGrant = null
    grantButton.hidden = true
    chrome.permissions.request({ origins: [pending.pattern] }).then(
      (granted) => {
        if (!granted) {
          showStatus("error", "Permission declined. Fill the form yourself or try again.")
          return
        }
        void chrome.tabs
          .get(pending.tabId)
          .then((tab) => scanTab(tab))
          .catch(() => showStatus("error", "That tab is no longer available."))
      },
      () => showStatus("error", "Chrome could not grant access to this site.")
    )
  }

  async function onFill(): Promise<void> {
    if (!state || busy || state.manualOnly) return
    const { fills } = state.plan
    if (fills.length === 0) return

    if (!armed) {
      armed = true
      render()
      showStatus(
        "warn",
        `This will write ${fills.length} field${fills.length === 1 ? "" : "s"} on the page. Check the preview, then press Confirm.`
      )
      return
    }

    armed = false
    setBusy(true)

    // Re-scan immediately before writing. A dynamic form can change while the
    // user reads the preview; writing a stale plan into new controls is exactly
    // what this check prevents.
    try {
      const rescan = await executeAllFrames(state.tabId, scanAutofillFields)
      const fresh: FieldDescriptor[] = []
      for (const injection of rescan.results) {
        const frameId = typeof injection.frameId === "number" ? injection.frameId : 0
        fresh.push(
          ...((injection.result ?? []) as ScannedField[]).map((field) => ({
            ...field,
            frameId,
          }))
        )
      }
      if (formSignature(fresh) !== state.signature) {
        state.fields = fresh
        state.signature = formSignature(fresh)
        state.results = []
        rebuildPlan()
        setBusy(false)
        showStatus(
          "error",
          "The form changed while you were reviewing it. The plan was reset — review the fields and scan again before filling."
        )
        return
      }
    } catch {
      setBusy(false)
      showStatus("error", "RoleSpec could not re-check the page. Scan again before filling.")
      return
    }

    // Fill only the server-approved subset.
    const validated = validatePlanAgainstServer(
      buildFillPlan(
        state.profile,
        state.fields,
        approvedMap(state.approved, state.serverAnswers),
        { applicationApprovedKeys: applicationApprovedKeys() }
      ),
      state.fields,
      state.preparation
    )
    state.plan = validated.plan
    if (validated.blocked > 0) {
      render()
      showStatus(
        "warn",
        `${validated.blocked} planned write${validated.blocked === 1 ? "" : "s"} moved to review by the server's safety check. Filling the remaining safe fields.`
      )
    }
    if (state.plan.fills.length === 0) {
      setBusy(false)
      render()
      return
    }

    // The guard is already armed from the scan, but re-arm in case it expired.
    try {
      const guard = await executeAllFrames(state.tabId, armSubmitGuard)
      state.guardCount = guard.results.reduce(
        (total, injection) => total + (typeof injection.result === "number" ? injection.result : 0),
        0
      )
    } catch {
      // Filling is still allowed; the panel just cannot claim the guard is on.
    }

    const byFrame = new Map<number, PlannedFill[]>()
    for (const fill of state.plan.fills) {
      const frameId = fill.frameId ?? 0
      const list = byFrame.get(frameId) ?? []
      list.push(fill)
      byFrame.set(frameId, list)
    }

    const resultRows: FillResultRow[] = []
    for (const [frameId, frameFills] of byFrame) {
      const assignments: FillAssignment[] = frameFills.map((fill) => ({
        id: fill.fieldId,
        value: fill.value,
      }))
      try {
        const injection = await chrome.scripting.executeScript({
          target: { tabId: state.tabId, frameIds: [frameId] },
          func: fillAutofillFields,
          args: [assignments],
        })
        const outcome = injection[0]?.result as
          | { filled: number; missed: number; results: FieldFillResult[] }
          | undefined
        const fieldResults = outcome?.results ?? []
        for (const fill of frameFills) {
          const row = fieldResults.find((entry) => entry.id === fill.fieldId)
          resultRows.push({
            fieldId: fill.fieldId,
            frameId: fill.frameId,
            label: fill.label,
            status: row?.status ?? "FAILED",
            ...(row?.reason ? { reason: row.reason } : {}),
          })
        }
      } catch {
        for (const fill of frameFills) {
          resultRows.push({
            fieldId: fill.fieldId,
            frameId: fill.frameId,
            label: fill.label,
            status: "FAILED",
            reason: "This frame could not be written",
          })
        }
      }
    }

    state.results = resultRows
    const filled = resultRows.filter((row) => row.status === "FILLED").length
    const failed = resultRows.filter((row) => row.status === "FAILED").length

    if (state.preparation) {
      const results: AtsResultInput[] = state.plan.fills.map((fill) => {
        const row = resultRows.find(
          (entry) => entry.fieldId === fill.fieldId && (entry.frameId ?? 0) === (fill.frameId ?? 0)
        )
        return {
          fieldId: fill.fieldId,
          questionKey: fill.key,
          status: row?.status === "FILLED" ? "FILLED" : "FAILED",
          ...(row?.reason ? { reason: row.reason } : {}),
        }
      })
      for (const item of state.plan.review) {
        if (item.category === "document" || item.isResumeUpload) {
          results.push({
            fieldId: item.fieldId,
            questionKey: item.key,
            status: state.attachedResumeId ? "FILLED" : "SKIPPED",
            ...(state.attachedResumeId ? {} : { reason: "Resume selected manually" }),
          })
        } else {
          results.push({
            fieldId: item.fieldId,
            questionKey: item.key,
            status: "REVIEW_REQUIRED",
          })
        }
      }
      await reportResults(results.slice(0, 150))
    }

    setBusy(false)
    rebuildPlan()
    showStatus(
      filled > 0 ? "ok" : "error",
      filled > 0
        ? `Filled ${filled} field${filled === 1 ? "" : "s"}.` +
            (failed > 0 ? ` ${failed} failed — see the field list.` : "") +
            ` ${state.plan.review.length} need your review. RoleSpec never submits — check every value and submit it yourself.`
        : "No fields were written. The form may have changed; scan again."
    )
  }

  async function onConfirmSubmission(submitted: boolean): Promise<void> {
    if (!state?.preparation) {
      showStatus("warn", "Connect RoleSpec OS before recording an application outcome.")
      return
    }
    setBusy(true)
    const response = await confirmAtsSubmission(
      deps.getSettings(),
      state.preparation.id,
      submitted,
      submitNote.value.trim() || undefined
    )
    setBusy(false)
    if (!response.ok) {
      showStatus("error", response.message)
      return
    }
    state.preparation = response.preparation
    render()
    submitStatus.hidden = false
    submitStatus.textContent = submitted
      ? response.applicationStatus === "APPLIED"
        ? "Recorded. Your tracker now shows this application as applied."
        : "Recorded as submitted."
      : "Recorded as not submitted. Nothing was changed in your tracker."
    submitStatus.className = "notice notice-ok"
  }

  function onReleaseGuard(): void {
    if (!state) return
    void releaseGuard(state.tabId).then((released) => {
      if (!state) return
      if (released) {
        state.guardCount = 0
        render()
        showStatus(
          "warn",
          "Submit guard released. Submit only after checking every answer and file on the page yourself."
        )
      } else {
        showStatus("info", "No active submit guard was found on this page.")
      }
    })
  }

  function onClear(): void {
    void clearApprovedAnswers().then(() => {
      if (!state) return
      // Only browser-cached answers are cleared. Server-approved answers keep
      // their provenance and must be revoked one by one on purpose.
      state.approved = {}
      showStatus(
        "ok",
        "Browser-cached answers cleared. Answers saved in RoleSpec are unchanged."
      )
      rebuildPlan()
    })
  }

  const refresh = (): void => {
    if (state) void releaseGuard(state.tabId)
    state = null
    armed = false
    pendingGrant = null
    grantButton.hidden = true
    summary.hidden = true
    fillButton.hidden = true
    fillPreview.hidden = true
    fillList.replaceChildren()
    review.hidden = true
    reviewList.replaceChildren()
    recordBox.hidden = true
    submitBox.hidden = true
    guardBox.hidden = true
    submitStatus.hidden = true
    submitNote.value = ""
    clearStatus()
    void updateSiteNote()
  }

  scanButton.addEventListener("click", () => void onScan())
  grantButton.addEventListener("click", onGrant)
  fillButton.addEventListener("click", () => void onFill())
  clearButton.addEventListener("click", onClear)
  releaseGuardButton.addEventListener("click", onReleaseGuard)
  confirmSubmittedButton.addEventListener("click", () => void onConfirmSubmission(true))
  confirmNotSubmittedButton.addEventListener("click", () => void onConfirmSubmission(false))

  void updateSiteNote()
  return { refresh }
}
