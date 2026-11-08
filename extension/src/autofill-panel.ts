/**
 * Side-panel controller for assisted ATS form filling.
 *
 * The safety contract is visible in the UI: scanning only reads field labels,
 * nothing is written until the user presses the fill button twice (arm, then
 * confirm), sensitive/unknown fields are listed in a review queue, and the
 * panel never clicks a submit control. Approved answers are cached locally for
 * the exact question the user answered.
 */

import {
  buildFillPlan,
  isAutofillSupportedUrl,
  autofillHostFor,
  type ApprovedAnswers,
  type FieldDescriptor,
  type FillPlan,
  type ProfileFacts,
  type ReviewField,
} from "./autofill-core"
import {
  fillAutofillFields,
  scanAutofillFields,
  type FillAssignment,
} from "./autofill-page"
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

interface ScanState {
  tabId: number
  fields: FieldDescriptor[]
  plan: FillPlan
  profile: ProfileFacts
  resumes?: ResumeSummary[]
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

export function initAutofillPanel(deps: PanelDeps) {
  const scanButton = el<HTMLButtonElement>("autofill-scan")
  const fillButton = el<HTMLButtonElement>("autofill-fill")
  const grantButton = el<HTMLButtonElement>("autofill-grant")
  const clearButton = el<HTMLButtonElement>("autofill-clear")
  const status = el<HTMLParagraphElement>("autofill-status")
  const summary = el<HTMLParagraphElement>("autofill-summary")
  const siteNote = el<HTMLParagraphElement>("autofill-site")
  const review = el<HTMLElement>("autofill-review")
  const reviewList = el<HTMLUListElement>("autofill-review-list")
  const fillPreview = el<HTMLElement>("autofill-fill-preview")
  const fillList = el<HTMLUListElement>("autofill-fill-list")

  let state: ScanState | null = null
  let approved: ApprovedAnswers = {}
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

  function rebuildPlan(): void {
    if (!state) return
    state.plan = buildFillPlan(state.profile, state.fields, approved)
    armed = false
    render()
  }

  function render(): void {
    if (!state) {
      summary.hidden = true
      fillButton.hidden = true
      fillPreview.hidden = true
      fillList.replaceChildren()
      review.hidden = true
      reviewList.replaceChildren()
      return
    }

    const { fills, review: reviewItems } = state.plan
    summary.hidden = false
    summary.textContent =
      `${fills.length} field${fills.length === 1 ? "" : "s"} ready to fill · ` +
      `${reviewItems.length} to review. Nothing is written until you approve.`

    fillButton.hidden = fills.length === 0
    fillButton.disabled = busy || fills.length === 0
    fillButton.textContent = armed
      ? `Confirm fill ${fills.length} field${fills.length === 1 ? "" : "s"}`
      : `Fill ${fills.length} field${fills.length === 1 ? "" : "s"}`

    // The confirmation copy promises a preview, so one has to exist. It shows
    // every value the next confirmed press would write, from the profile or an
    // answer the user saved for that exact question.
    fillPreview.hidden = fills.length === 0
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

      if (fill.approved) {
        const saved = document.createElement("span")
        saved.className = "review-saved"
        saved.textContent = "Saved answer"
        head.appendChild(saved)
      }

      const value = document.createElement("p")
      value.className = "fill-value"
      value.textContent = fill.value

      li.append(head, value)
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

      const reason = document.createElement("p")
      reason.className = "hint"
      reason.textContent = item.reason

      if (item.category === "document" || item.isResumeUpload) {
        const docBox = document.createElement("div")
        docBox.className = "resume-attachment-card"

        const docNotice = document.createElement("p")
        docNotice.className = "hint"
        docNotice.textContent =
          "Browser extensions cannot silently inject files into file upload inputs. Attach your tailored resume from RoleSpec OS:"

        const actionsRow = document.createElement("div")
        actionsRow.className = "review-input-row"

        const openResumesBtn = document.createElement("button")
        openResumesBtn.type = "button"
        openResumesBtn.className = "button button-quiet button-mini"
        openResumesBtn.textContent = "Open Resumes in RoleSpec"
        openResumesBtn.addEventListener("click", () => {
          const settings = deps.getSettings()
          void chrome.tabs.create({ url: `${settings.appUrl}/resumes` })
        })
        actionsRow.appendChild(openResumesBtn)

        if (state?.resumes && state.resumes.length > 0) {
          const resumeList = document.createElement("ul")
          resumeList.className = "resume-attach-list"
          for (const resume of state.resumes.slice(0, 3)) {
            const rLi = document.createElement("li")
            rLi.className = "resume-attach-item"
            const rTitle = document.createElement("span")
            rTitle.className = "resume-title-text"
            rTitle.textContent = resume.title || "Untitled Resume"
            rLi.appendChild(rTitle)

            if (resume.atsScore != null) {
              const scoreBadge = document.createElement("span")
              scoreBadge.className = "review-saved"
              scoreBadge.textContent = `${resume.atsScore}% ATS`
              rLi.appendChild(scoreBadge)
            }

            const openBtn = document.createElement("button")
            openBtn.type = "button"
            openBtn.className = "button button-quiet button-mini"
            openBtn.textContent = "Open"
            openBtn.title = "Open this resume in RoleSpec OS"
            openBtn.addEventListener("click", () => {
              const settings = deps.getSettings()
              void chrome.tabs.create({ url: `${settings.appUrl}/resumes/${resume.id}` })
            })
            rLi.appendChild(openBtn)
            resumeList.appendChild(rLi)
          }
          docBox.append(docNotice, actionsRow, resumeList)
        } else {
          docBox.append(docNotice, actionsRow)
        }

        li.append(head, reason, docBox)
        reviewList.appendChild(li)
        continue
      }

      const suggestion = suggestionFor(item, state!.profile)
      const isApproved = Boolean(approved[item.key])

      const inputRow = document.createElement("div")
      inputRow.className = "review-input-row"

      const input = document.createElement("input")
      input.type = "text"
      input.maxLength = 1000
      input.autocomplete = "off"
      input.placeholder = "Your answer"
      input.setAttribute("aria-label", `Answer for ${item.label}`)
      input.value = approved[item.key] ?? suggestion

      const save = document.createElement("button")
      save.type = "button"
      save.className = "button button-quiet button-mini"
      save.textContent = approved[item.key] ? "Update" : "Save answer"
      save.addEventListener("click", () => {
        const value = input.value.trim()
        if (!value) {
          showStatus("warn", "Type an answer before saving it.")
          input.focus()
          return
        }
        void saveApprovedAnswer(item.label, value).then((next) => {
          approved = next
          showStatus("ok", "Answer saved. Press Fill to apply it on this page.")
          rebuildPlan()
        })
      })

      inputRow.appendChild(input)
      inputRow.appendChild(save)

      if (suggestion && !isApproved) {
        const accept = document.createElement("button")
        accept.type = "button"
        accept.className = "button button-quiet button-mini"
        accept.textContent = "Accept suggestion"
        accept.title = `Accept profile value: "${suggestion}"`
        accept.addEventListener("click", () => {
          void saveApprovedAnswer(item.label, suggestion).then((next) => {
            approved = next
            showStatus("ok", "Profile suggestion saved as approved answer.")
            rebuildPlan()
          })
        })
        inputRow.appendChild(accept)
      }

      if (approved[item.key]) {
        const remove = document.createElement("button")
        remove.type = "button"
        remove.className = "button button-quiet button-mini"
        remove.textContent = "Forget"
        remove.setAttribute("aria-label", `Forget the saved answer for ${item.label}`)
        remove.addEventListener("click", () => {
          void deleteApprovedAnswer(item.label).then((next) => {
            approved = next
            showStatus("ok", "Saved answer removed.")
            rebuildPlan()
          })
        })
        inputRow.appendChild(remove)

        const saved = document.createElement("span")
        saved.className = "review-saved"
        saved.textContent = "Saved answer"
        head.appendChild(saved)
      }

      if (item.options && item.options.length > 0) {
        const options = document.createElement("p")
        options.className = "hint"
        options.textContent = `Choices: ${item.options.join(" · ")}`
        li.append(head, reason, options, inputRow)
      } else {
        li.append(head, reason, inputRow)
      }
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
    const host = autofillHostFor(tab?.url)
    if (!host) {
      siteNote.textContent =
        "This page is not a supported application form. Open a Greenhouse, Lever, Ashby, Workable, BambooHR, SmartRecruiters, Jobvite, iCIMS, Taleo, Workday, Recruitee, Teamtailor or Personio form."
      return
    }
    siteNote.textContent = `Supported form detected on ${hostLabelFor(tab?.url) ?? host}.`
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

    let fields: FieldDescriptor[] = []
    try {
      const injection = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scanAutofillFields,
      })
      fields = (injection[0]?.result ?? []) as FieldDescriptor[]
    } catch {
      setBusy(false)
      showStatus(
        "error",
        "RoleSpec could not read this page. Reload it after granting site access and try again.",
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

    approved = await loadApprovedAnswers()
    if (seq !== scanSeq) return

    state = {
      tabId: tab.id,
      fields,
      profile: profileResult.profile,
      resumes: resumesResult.ok ? resumesResult.resumes : [],
      plan: buildFillPlan(profileResult.profile, fields, approved),
    }
    render()
    if (fields.length === 0) {
      showStatus(
        "warn",
        "No visible form fields were found. Open the application form itself, not the job description.",
      )
      return
    }
    showStatus(
      "info",
      "Scan complete. Review the fields below, then press Fill. RoleSpec never submits an application.",
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
    if (!isAutofillSupportedUrl(tab.url)) {
      showStatus("error", "This page is not a supported ATS application form.")
      return
    }

    const pattern = originPatternFor(tab.url)
    const host = autofillHostFor(tab.url)
    if (!pattern || !host) {
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
      pendingGrant = { tabId: tab.id, pattern, host }
      fillButton.hidden = true
      review.hidden = true
      grantButton.hidden = false
      grantButton.textContent = `Allow RoleSpec to read ${host}`
      showStatus("warn", "RoleSpec needs your permission to inspect this site's form fields.")
      return
    }

    await scanTab(tab)
  }

  function onGrant(): void {
    const pending = pendingGrant
    if (!pending) return
    // The permission request must be the first call in this click handler:
    // Chrome rejects it once an await has consumed the user gesture.
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
      () => showStatus("error", "Chrome could not grant access to this site."),
    )
  }

  function onFill(): void {
    if (!state || busy) return
    const { fills } = state.plan
    if (fills.length === 0) return

    if (!armed) {
      armed = true
      render()
      showStatus(
        "warn",
        `This will write ${fills.length} field${fills.length === 1 ? "" : "s"} on the page. Check the values in the preview below, then press Confirm.`,
      )
      return
    }

    armed = false
    const assignments: FillAssignment[] = fills.map((fill) => ({
      id: fill.fieldId,
      value: fill.value,
    }))
    setBusy(true)
    chrome.scripting
      .executeScript({
        target: { tabId: state.tabId },
        func: fillAutofillFields,
        args: [assignments],
      })
      .then(
        (injection) => {
          setBusy(false)
          const outcome = injection[0]?.result as
            | { filled: number; missed: number }
            | undefined
          const filled = outcome?.filled ?? 0
          const missed = outcome?.missed ?? 0
          if (filled === 0) {
            showStatus(
              "error",
              "No fields were written. The form may have changed; scan again.",
            )
            return
          }
          showStatus(
            "ok",
            `Filled ${filled} field${filled === 1 ? "" : "s"}.` +
              (missed > 0 ? ` ${missed} field${missed === 1 ? "" : "s"} could not be matched.` : "") +
              (state!.plan.review.length > 0
                ? ` ${state!.plan.review.length} need your review before you submit.`
                : "") +
              " RoleSpec never submits — review the page and submit it yourself.",
          )
          render()
        },
        () => {
          setBusy(false)
          showStatus("error", "RoleSpec could not write to the page. Scan again and retry.")
        },
      )
  }

  function onClear(): void {
    void clearApprovedAnswers().then(() => {
      approved = {}
      if (state) rebuildPlan()
      showStatus("ok", "Saved answers cleared from this browser.")
    })
  }

  // Keep the site note current when the panel opens or switches tabs.
  const refresh = (): void => {
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
    clearStatus()
    void updateSiteNote()
  }

  scanButton.addEventListener("click", () => void onScan())
  grantButton.addEventListener("click", onGrant)
  fillButton.addEventListener("click", onFill)
  clearButton.addEventListener("click", onClear)

  void updateSiteNote()
  return { refresh }
}
