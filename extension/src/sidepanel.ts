import { fetchResumes, fetchSearchLinks, generateColdEmail, generateEmailReply, postJob } from "./api"
import type { GroundingSummary, SignatureFinding } from "./api"
import { signInWithRoleSpec } from "./connect"
import { badgeEnableState } from "./badge-enable"
import { extractJobPosting } from "./extractor"
import { extractLinkedInProfile } from "./linkedin-extractor"
import { preservedSelection, resumeOptionLabel } from "./resume-select"
import { renderSearchLinks } from "./search-links"
import { hostLabelFor, originPatternFor, planBlockedRead } from "./site-access"
import type { BlockedReason } from "./site-access"
import { VERDICT_BADGES } from "./verdict-badges"
import {
  DEFAULT_APP_URL,
  SETTINGS_STORAGE_KEY,
  hasCredentials,
  loadSettings,
  saveSettings,
} from "./settings"
import {
  JOB_TYPES,
  MAX_CONNECTION_NOTE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_INSTRUCTIONS_LENGTH,
  MAX_JOB_CONTEXT_LENGTH,
  MAX_JOB_DESCRIPTION_CONTEXT_LENGTH,
  MAX_PREVIOUS_DRAFT_LENGTH,
  MAX_PRIOR_THREAD_LENGTH,
  MAX_PROFILE_ABOUT_LENGTH,
  MAX_PROFILE_COMPANY_LENGTH,
  MAX_PROFILE_HEADLINE_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
  MAX_PROFILE_URL_LENGTH,
  MAX_RECEIVED_EMAIL_LENGTH,
  MESSAGE_TYPES,
  OUTREACH_TONES,
  REPLY_LENGTHS,
  REPLY_TONES,
  SALARY_CURRENCIES,
  SALARY_PERIODS,
  WORK_TYPES,
} from "./types"
import type {
  ClippedJob,
  ColdEmailRequest,
  EmailReplyRequest,
  ConfidenceLevel,
  JobConfidence,
  JobMarketFit,
  JobQualification,
  JobRisk,
  JobRiskLevel,
  JobType,
  LinkedInProfile,
  LinkedInProfileExtraction,
  LinkedInProfileField,
  MessageType,
  OutreachTone,
  ReplyLength,
  ReplyTone,
  ResumeSummary,
  SalaryCurrency,
  SalaryPeriod,
  Settings,
  WorkType,
} from "./types"

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}

const form = el<HTMLFormElement>("form")
const setup = el<HTMLElement>("setup")
const setupText = el<HTMLParagraphElement>("setup-text")
const setupSignInButton = el<HTMLButtonElement>("setup-sign-in")
const setupLink = el<HTMLAnchorElement>("setup-link")
const optionsLink = el<HTMLAnchorElement>("open-options")
const extractNote = el<HTMLParagraphElement>("extract-note")
const replacePageButton = el<HTMLButtonElement>("replace-page")
const grantAccessButton = el<HTMLButtonElement>("grant-access")
const enableBadgesButton = el<HTMLButtonElement>("enable-badges")
const badgeNote = el<HTMLParagraphElement>("badge-note")
const status = el<HTMLParagraphElement>("status")
const clipRisk = el<HTMLParagraphElement>("clip-risk")
const clipVerdict = el<HTMLParagraphElement>("clip-verdict")
const clipContext = el<HTMLParagraphElement>("clip-context")
const clipMarket = el<HTMLElement>("clip-market")
const clipConfidence = el<HTMLElement>("clip-confidence")
const clipMatch = el<HTMLParagraphElement>("clip-match")
const clipRequirements = el<HTMLParagraphElement>("clip-requirements")
const saveButton = el<HTMLButtonElement>("save")
const clipAnotherButton = el<HTMLButtonElement>("clip-another")
const companyInput = el<HTMLInputElement>("companyName")
const titleInput = el<HTMLInputElement>("jobTitle")
const linkInput = el<HTMLInputElement>("jobLink")
const locationInput = el<HTMLInputElement>("location")
const salaryInput = el<HTMLInputElement>("salary")
const salaryRangeHint = el<HTMLElement>("salary-range-hint")
const salaryCurrencySelect = el<HTMLSelectElement>("salaryCurrency")
const salaryPeriodSelect = el<HTMLSelectElement>("salaryPeriod")
const jobTypeSelect = el<HTMLSelectElement>("jobType")
const workTypeSelect = el<HTMLSelectElement>("workType")
const postedAtInput = el<HTMLInputElement>("postedAt")
const deadlineInput = el<HTMLInputElement>("deadline")
const descriptionInput = el<HTMLTextAreaElement>("jobDescription")
const descriptionCount = el<HTMLElement>("description-count")

const clipTab = el<HTMLButtonElement>("tab-clip")
const emailTab = el<HTMLButtonElement>("tab-email")
const replyTab = el<HTMLButtonElement>("tab-reply")
const searchTab = el<HTMLButtonElement>("tab-search")
const clipView = el<HTMLElement>("view-clip")
const emailView = el<HTMLElement>("view-email")
const replyView = el<HTMLElement>("view-reply")
const searchView = el<HTMLElement>("view-search")
const searchStatus = el<HTMLParagraphElement>("search-status")
const searchResults = el<HTMLElement>("search-results")
const refreshSearchButton = el<HTMLButtonElement>("refresh-search")
const emailForm = el<HTMLFormElement>("email-form")
const emailNote = el<HTMLParagraphElement>("email-note")
const emailStatus = el<HTMLParagraphElement>("email-status")
const readProfileButton = el<HTMLButtonElement>("read-profile")
const generateButton = el<HTMLButtonElement>("generate-email")
const personNameInput = el<HTMLInputElement>("personName")
const personHeadlineInput = el<HTMLInputElement>("personHeadline")
const personCompanyInput = el<HTMLInputElement>("personCompany")
const personProfileUrlInput = el<HTMLInputElement>("personProfileUrl")
const personAboutInput = el<HTMLTextAreaElement>("personAbout")
const aboutCount = el<HTMLElement>("about-count")
const instructionsInput = el<HTMLTextAreaElement>("emailInstructions")
const messageTypeSelect = el<HTMLSelectElement>("messageType")
const emailToneSelect = el<HTMLSelectElement>("emailTone")
const emailResumeSelect = el<HTMLSelectElement>("emailResume")
const emailResult = el<HTMLElement>("email-result")
const emailSubjectRow = el<HTMLElement>("email-subject-row")
const emailSubjectOutput = el<HTMLInputElement>("email-subject")
const emailBodyOutput = el<HTMLTextAreaElement>("email-body")
const emailBodyCount = el<HTMLElement>("email-body-count")
const copySubjectButton = el<HTMLButtonElement>("copy-subject")
const copyBodyButton = el<HTMLButtonElement>("copy-body")

const replyForm = el<HTMLFormElement>("reply-form")
const replyStatus = el<HTMLParagraphElement>("reply-status")
const receivedEmailInput = el<HTMLTextAreaElement>("receivedEmail")
const receivedCount = el<HTMLElement>("received-count")
const replyCompanyInput = el<HTMLInputElement>("replyCompany")
const replyJobTitleInput = el<HTMLInputElement>("replyJobTitle")
const replyToneSelect = el<HTMLSelectElement>("replyTone")
const replyLengthSelect = el<HTMLSelectElement>("replyLength")
const replyResumeSelect = el<HTMLSelectElement>("replyResume")
const replyPriorThreadInput = el<HTMLTextAreaElement>("replyPriorThread")
const priorThreadCount = el<HTMLElement>("prior-thread-count")
const replyJobDescriptionInput = el<HTMLTextAreaElement>("replyJobDescription")
const replyInstructionsInput = el<HTMLTextAreaElement>("replyInstructions")
const replyButton = el<HTMLButtonElement>("generate-reply")
const replyResult = el<HTMLElement>("reply-result")
const replySubjectOutput = el<HTMLInputElement>("reply-subject")
const replyBodyOutput = el<HTMLTextAreaElement>("reply-body")
const copyReplySubjectButton = el<HTMLButtonElement>("copy-reply-subject")
const copyReplyBodyButton = el<HTMLButtonElement>("copy-reply-body")

let settings: Settings = { appUrl: "", apiToken: "" }

/**
 * True once the user has typed into the form after a prefill. Programmatic prefill
 * does not dispatch input/change events, so it never sets this.
 */
let dirty = false
let panelWindowId: number | undefined
let extracting = false

/** URL of the page the last extraction was blocked on, for the grant button to name. */
let blockedUrl: string | null = null
/** Why the last extraction was blocked; decides whether a grant button is offered. */
let blockedReason: BlockedReason = "browser-page"

/**
 * A grant we asked for ourselves also fires `permissions.onAdded`, and the click
 * handler already re-reads the page. Set before the request so either event order
 * is covered.
 */
let handledOwnGrant = false

/** Origin the "Show fit badges" button asks for; null while the button is hidden. */
let badgePattern: string | null = null
/** Bumped per re-evaluation so a slow `permissions.contains` cannot overwrite a newer tab. */
let badgeCheckSeq = 0
let badgeNoteTimer: ReturnType<typeof setTimeout> | undefined

/** How long "Fit badges on for <host>" stays up after a grant. */
const BADGE_NOTE_MS = 4000

/** Sent by the service worker on every toolbar-icon click. See `src/background.ts`. */
const ACTION_CLICKED_MESSAGE = "rolespec:action-clicked"

/** Sent by the service worker for every context-menu click. See `src/background.ts`. */
const CONTEXT_MENU_MESSAGE = "rolespec:context-menu"

const MENU_CLIP_SELECTION = "clip-selection"
const MENU_COLD_EMAIL = "cold-email-person"
const MENU_REPLY_EMAIL = "reply-email"

/** Click ids already acted on, so the worker's retry cannot run a command twice. */
const handledMenuClicks = new Set<string>()

/** Chrome can hand the panel document its activeTab grant a beat after it loads. */
const REGRANT_RETRY_MS = 300

/** `warn` is a usable draft that still needs the user to check something. */
type StatusKind = "info" | "error" | "ok" | "warn"

function showStatus(kind: StatusKind, message: string, link?: { href: string; label: string }) {
  status.textContent = message
  status.className = `notice${kind === "error" ? " notice-error" : kind === "ok" ? " notice-ok" : kind === "warn" ? " notice-warn" : ""}`
  status.hidden = false
  if (link) {
    status.append(" ")
    const anchor = document.createElement("a")
    anchor.className = "link"
    anchor.href = link.href
    anchor.target = "_blank"
    anchor.rel = "noreferrer"
    anchor.textContent = link.label
    status.append(anchor)
  }
}

function clearStatus() {
  status.hidden = true
  status.textContent = ""
  clearRisk()
}

/** Copy for the risk banner. HIGH gets the error border, LOW/MEDIUM the warn one. */
const RISK_HEADLINES: Record<JobRiskLevel, string> = {
  LOW: "⚠ Worth a second look (LOW risk)",
  MEDIUM: "⚠ Possible ghost job / scam (MEDIUM risk)",
  HIGH: "⚠ Possible ghost job / scam (HIGH risk)",
}

/**
 * Shown next to — never instead of — the "Saved." confirmation: the clip did land in
 * RoleSpec, the server just flagged the posting on the way in.
 */
function showRisk(risk: JobRisk) {
  const reasons = risk.reasons.join(" • ")
  clipRisk.textContent = reasons
    ? `${RISK_HEADLINES[risk.level]}: ${reasons}`
    : RISK_HEADLINES[risk.level]
  clipRisk.className = `notice ${risk.level === "HIGH" ? "notice-error" : "notice-warn"}`
  clipRisk.hidden = false
}

function clearRisk() {
  clipRisk.hidden = true
  clipRisk.textContent = ""
  clearQualification()
}

/**
 * Shown under the risk banner on a successful save, and only for the parts the
 * server actually sent: no verdict, no capabilities and no flags means the panel
 * looks exactly as it did against a RoleSpec older than the qualification check.
 */
function showQualification(
  qualification: JobQualification | undefined,
  requirements: string[],
  context: { marketFit?: JobMarketFit; confidence?: JobConfidence } = {}
) {
  if (qualification) {
    const badge = VERDICT_BADGES[qualification.verdict]
    clipVerdict.textContent = qualification.nextAction
      ? `${badge.label}: ${qualification.nextAction}`
      : badge.label
    clipVerdict.className = badge.notice
    clipVerdict.hidden = false

    const matched = qualification.match.matchedCapabilities
    if (matched.length > 0) {
      const confirmed =
        qualification.match.confirmedCount > 0
          ? ` (${qualification.match.confirmedCount} confirmed)`
          : ""
      clipMatch.textContent = `Matches: ${matched.join(", ")}${confirmed}`
      clipMatch.hidden = false
    }
  }

  showContextChips(context)

  if (requirements.length > 0) {
    clipRequirements.textContent = `Requires: ${requirements.map(humanizeFlag).join(", ")}`
    clipRequirements.hidden = false
  }
}

/** Chip copy per confidence level. The sentence behind it is the `title`. */
const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  HIGH: "High confidence",
  MEDIUM: "Medium confidence",
  LOW: "Low confidence",
  UNKNOWN: "Confidence unknown",
}

/**
 * The two facts the server sends back with a save that the verdict alone does not
 * carry: where the posting is open, and how much evidence it is current. Each chip
 * only appears when the server actually sent it, so an older RoleSpec leaves the
 * panel exactly as it was. A LOW confidence is triage, never an accusation — the
 * chip is plain, and the summary explains it.
 */
function showContextChips(context: { marketFit?: JobMarketFit; confidence?: JobConfidence }) {
  if (context.marketFit) {
    clipMarket.textContent = context.marketFit.label
    if (context.marketFit.reason) clipMarket.title = context.marketFit.reason
    clipMarket.hidden = false
  }
  if (context.confidence) {
    clipConfidence.textContent = CONFIDENCE_LABELS[context.confidence.level]
    if (context.confidence.summary) clipConfidence.title = context.confidence.summary
    clipConfidence.hidden = false
  }
  clipContext.hidden = clipMarket.hidden && clipConfidence.hidden
}

/**
 * `NO_SPONSORSHIP` → `No sponsorship`. Deliberately mechanical: a dictionary would
 * go stale the moment the server adds a flag, and a raw flag still reads.
 */
function humanizeFlag(flag: string): string {
  const words = flag.replace(/_/g, " ").trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : flag
}

function clearQualification() {
  clipVerdict.hidden = true
  clipVerdict.textContent = ""
  clipContext.hidden = true
  clipMarket.hidden = true
  clipMarket.textContent = ""
  clipMarket.title = ""
  clipConfidence.hidden = true
  clipConfidence.textContent = ""
  clipConfidence.title = ""
  clipMatch.hidden = true
  clipMatch.textContent = ""
  clipRequirements.hidden = true
  clipRequirements.textContent = ""
}

function showNote(message: string, options?: { offerReplace?: boolean; grantHost?: string }) {
  extractNote.textContent = message
  extractNote.hidden = false
  replacePageButton.hidden = !options?.offerReplace
  grantAccessButton.hidden = !options?.grantHost
  if (options?.grantHost) {
    grantAccessButton.textContent = `Allow RoleSpec to read ${options.grantHost}`
  }
}

function clearNote() {
  extractNote.hidden = true
  extractNote.textContent = ""
  replacePageButton.hidden = true
  grantAccessButton.hidden = true
}

function updateCounter() {
  const length = descriptionInput.value.length
  descriptionCount.textContent = `${length} / ${MAX_DESCRIPTION_LENGTH}`
  descriptionCount.classList.toggle("over", length >= MAX_DESCRIPTION_LENGTH)
}

function openOptions(event: Event) {
  event.preventDefault()
  chrome.runtime.openOptionsPage()
}

const SETUP_PROMPT = "Connect this clipper to RoleSpec before saving jobs."

/**
 * Same flow as Options, run against the saved App URL. The `storage.onChanged`
 * listener re-renders the banner once the token lands.
 */
async function onSetupSignIn() {
  const appUrl = settings.appUrl || DEFAULT_APP_URL
  setupSignInButton.disabled = true
  setupSignInButton.textContent = "Waiting for RoleSpec…"
  setupText.textContent = "Opening RoleSpec…"

  try {
    const apiToken = await signInWithRoleSpec(appUrl)
    await saveSettings({ appUrl, apiToken })
    setupText.textContent = "Connected. Token saved."
  } catch (error) {
    setupText.textContent = error instanceof Error ? error.message : "Sign-in failed."
  } finally {
    setupSignInButton.disabled = false
    setupSignInButton.textContent = "Sign in to RoleSpec"
  }
}

function prefill(job: Partial<ClippedJob>) {
  if (job.companyName) companyInput.value = job.companyName
  if (job.jobTitle) titleInput.value = job.jobTitle
  if (job.jobLink) linkInput.value = job.jobLink
  if (job.location) locationInput.value = job.location
  if (job.salary !== undefined) salaryInput.value = String(job.salary)
  if (job.salaryRangeText) {
    salaryRangeHint.textContent = `Posted range: ${job.salaryRangeText}`
    salaryRangeHint.hidden = false
  } else {
    salaryRangeHint.textContent = ""
    salaryRangeHint.hidden = true
  }
  if (
    job.salaryCurrency &&
    (SALARY_CURRENCIES as readonly string[]).includes(job.salaryCurrency)
  ) {
    salaryCurrencySelect.value = job.salaryCurrency
  }
  if (job.salaryPeriod && (SALARY_PERIODS as readonly string[]).includes(job.salaryPeriod)) {
    salaryPeriodSelect.value = job.salaryPeriod
  }
  if (job.jobType && (JOB_TYPES as readonly string[]).includes(job.jobType)) {
    jobTypeSelect.value = job.jobType
  }
  if (job.workType && (WORK_TYPES as readonly string[]).includes(job.workType)) {
    workTypeSelect.value = job.workType
  }
  if (job.jobDescription) descriptionInput.value = job.jobDescription
  // Not user-editable: they are what the posting itself published.
  if (job.postedAt) postedAtInput.value = job.postedAt
  if (job.deadline) deadlineInput.value = job.deadline
  updateCounter()
}

function clearForm() {
  companyInput.value = ""
  titleInput.value = ""
  linkInput.value = ""
  locationInput.value = ""
  salaryInput.value = ""
  salaryRangeHint.textContent = ""
  salaryRangeHint.hidden = true
  // USD is the default option in the markup, so a clear returns to it.
  salaryCurrencySelect.value = "USD"
  salaryPeriodSelect.value = ""
  jobTypeSelect.value = ""
  workTypeSelect.value = ""
  descriptionInput.value = ""
  postedAtInput.value = ""
  deadlineInput.value = ""
  updateCounter()
}

/** Back to "ready to clip": form editable, save button visible, nothing dirty. */
function resetToClipState() {
  dirty = false
  clearStatus()
  clearNote()
  clipAnotherButton.hidden = true
  saveButton.hidden = false
  saveButton.disabled = !hasCredentials(settings)
}

type ExtractOutcome = "ok" | "no-tab" | "blocked"

/**
 * Runs the extractor in the active tab. Page content needs either the activeTab grant
 * from a toolbar/context-menu click (which dies on a tab switch) or a persistent
 * per-site grant the user allowed from this panel — the caller handles "blocked".
 */
async function extractFromActiveTab(options: { clearFirst: boolean }): Promise<ExtractOutcome> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return "no-tab"

  const pattern = originPatternFor(tab.url)
  // `permissions.contains` does not see an activeTab grant, so a false here is not
  // proof the page is unreadable — the injection below is still attempted once.
  const granted = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractJobPosting,
    })
    const extracted = (injection?.result ?? {}) as Partial<ClippedJob>
    if (options.clearFirst) clearForm()
    prefill({ ...extracted, jobLink: tab.url ?? extracted.jobLink })
    if (!extracted.companyName || !extracted.jobTitle) {
      showNote("Could not read every field from this page — check company and title before saving.")
    } else {
      clearNote()
    }
    blockedUrl = null
    return "ok"
  } catch {
    // The "tabs" permission puts `tab.url` here with no page grant at all, so the Job
    // link is still filled when the posting's text cannot be read — but never next to
    // another page's company, title and description (see `planBlockedRead`).
    const plan = planBlockedRead({
      url: tab.url,
      granted,
      clearFirst: options.clearFirst,
      currentLink: linkInput.value,
    })
    if (plan.clearForm) clearForm()
    if (plan.link !== null) linkInput.value = plan.link
    blockedReason = plan.reason
    blockedUrl = plan.reason === "needs-grant" ? (tab.url ?? null) : null
    return "blocked"
  }
}

/**
 * The one place that explains a blocked page. A readable origin gets the grant button;
 * a browser-owned page can only be told the truth.
 */
function showBlockedNote() {
  if (blockedReason === "unreadable") {
    showNote(
      "RoleSpec has access to this site, but Chrome won't let extensions read this page — fill the form in manually.",
    )
    return
  }
  const host = hostLabelFor(blockedUrl)
  if (!host) {
    showNote(
      "RoleSpec can't read this page. Chrome and extension pages can never be read — fill the form in manually.",
    )
    return
  }
  showNote(
    `RoleSpec can't read this page yet. Allow access to ${host} once, or fill the form in manually.`,
    { grantHost: host },
  )
}

/**
 * The one place the panel asks Chrome for a persistent grant on `pattern`.
 * `permissions.request` is the first thing this does: Chrome rejects it outside a user
 * gesture, and an await before it loses the gesture — so callers must not await first.
 * Our own grant also fires `permissions.onAdded`; `handledOwnGrant` keeps that listener
 * from re-reading the page on top of whatever the caller does.
 */
function requestOriginGrant(pattern: string): Promise<boolean> {
  handledOwnGrant = true
  return chrome.permissions.request({ origins: [pattern] }).then(
    (granted) => {
      if (!granted) handledOwnGrant = false
      return granted
    },
    (error: unknown) => {
      handledOwnGrant = false
      throw error
    },
  )
}

/** Asks for a persistent grant on the blocked page's origin, then re-reads the page. */
function onGrantAccess() {
  const pattern = originPatternFor(blockedUrl)
  if (!pattern) return
  const host = hostLabelFor(blockedUrl)
  requestOriginGrant(pattern).then(
    (granted) => {
      if (!granted) {
        showNote("Permission declined. Fill the form in manually or try again.", {
          grantHost: host ?? undefined,
        })
        return
      }
      // Same guard as the `permissions.onAdded` listener: a form the user filled in by
      // hand (as the blocked note invited) is not wiped by the re-read.
      if (dirty) {
        showNote("Access allowed. Keep your edits, or read this page instead?", {
          offerReplace: true,
        })
        return
      }
      clearNote()
      void extractNow({ clearFirst: true })
    },
    () => {
      showNote("Chrome refused that request. Fill the form in manually or try again.", {
        grantHost: host ?? undefined,
      })
    },
  )
}

/**
 * Shows "Show fit badges on <host>" when the active tab is a supported job board the
 * extension has no persistent grant for. A toolbar click reads the page through
 * activeTab, which badges cannot use, so without this nothing ever offers the grant.
 */
async function refreshBadgeEnable() {
  const seq = ++badgeCheckSeq
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url
  const pattern = badgeEnableState({ url, granted: false }).pattern
  const granted = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false
  if (seq !== badgeCheckSeq) return
  const state = badgeEnableState({ url, granted })
  badgePattern = state.show ? state.pattern : null
  enableBadgesButton.hidden = !state.show
  if (state.show && state.host) enableBadgesButton.textContent = `Show fit badges on ${state.host}`
}

/** The badge script itself is registered by the worker on `permissions.onAdded`. */
function onEnableBadges() {
  const pattern = badgePattern
  if (!pattern) return
  const host = hostLabelFor(pattern.slice(0, -2))
  requestOriginGrant(pattern).then(
    (granted) => {
      if (!granted) return
      // The same grant makes a blocked page readable; `handledOwnGrant` kept the
      // `onAdded` listener from re-reading it, so do it here, as `onGrantAccess` does.
      if (blockedUrl && !dirty) {
        clearNote()
        void extractNow({ clearFirst: true })
      }
      enableBadgesButton.hidden = true
      badgePattern = null
      clearTimeout(badgeNoteTimer)
      badgeNote.textContent = `Fit badges on for ${host ?? "this site"}`
      badgeNote.hidden = false
      badgeNoteTimer = setTimeout(() => {
        badgeNote.hidden = true
        badgeNote.textContent = ""
      }, BADGE_NOTE_MS)
    },
    () => {
      // Chrome refused the request outright; the button stays for another try.
    },
  )
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Extraction for the panel opening, the toolbar click and the "Clip another job" button. */
async function extractNow(options: { clearFirst: boolean; retryOnBlocked?: boolean }) {
  if (extracting) return
  extracting = true
  try {
    let outcome = await extractFromActiveTab(options)
    if (outcome === "blocked" && options.retryOnBlocked) {
      // The click that opened the panel grants activeTab, but the panel document can win
      // the race against that grant — give it one more go before telling the user off.
      await wait(REGRANT_RETRY_MS)
      outcome = await extractFromActiveTab(options)
    }
    if (outcome === "no-tab") {
      showNote("No active tab to read. Fill the form in manually.")
    } else if (outcome === "blocked") {
      showBlockedNote()
    }
  } finally {
    extracting = false
  }
}

/**
 * The panel outlives the tab it was opened on. Re-read the new page when the user has
 * nothing at stake; otherwise leave their edits alone and just say the page moved.
 */
async function onActiveTabChanged() {
  if (dirty) {
    showNote("The page changed. Your edits are kept — press Save, or clear a field to re-read.")
    return
  }
  if (extracting) return
  extracting = true
  try {
    const outcome = await extractFromActiveTab({ clearFirst: true })
    if (outcome === "ok") {
      clearStatus()
      clipAnotherButton.hidden = true
      saveButton.hidden = false
      saveButton.disabled = !hasCredentials(settings)
    } else if (outcome === "no-tab") {
      showNote("No active tab to read. Fill the form in manually.")
    } else {
      showBlockedNote()
    }
  } finally {
    extracting = false
  }
}

/** Re-read the current page into a fresh form, as if the panel had just opened on it. */
async function reExtractForClick() {
  dirty = false
  clearStatus()
  clipAnotherButton.hidden = true
  saveButton.hidden = false
  saveButton.disabled = !hasCredentials(settings)
  await extractNow({ clearFirst: true, retryOnBlocked: true })
}

/**
 * The toolbar-icon click is the only thing that grants page access, and Chrome gives an
 * already-open panel no signal for it, so the service worker forwards one here. The click
 * is an explicit "read this page" request — but it still must not eat unsaved edits, so a
 * dirty form is offered the swap instead of having it done to it.
 */
async function onActionClicked(windowId?: number) {
  if (panelWindowId !== undefined && windowId !== undefined && windowId !== panelWindowId) return
  if (dirty) {
    showNote("Keep your edits, or read this page instead?", { offerReplace: true })
    return
  }
  await reExtractForClick()
}

/**
 * A context-menu command is an explicit instruction, so unlike the toolbar click it
 * says which flow to run. The click also re-grants `activeTab`, which is what makes
 * the re-read below possible.
 */
async function onContextMenuClick(menuId: string, selectionText?: string) {
  if (menuId === MENU_COLD_EMAIL) {
    setMode("email")
    await readProfileFromPage()
    return
  }

  if (menuId === MENU_REPLY_EMAIL) {
    setMode("reply")
    // The selection is the email being answered. Nothing is generated for them
    // until the user presses the button.
    const selection = selectionText?.trim()
    if (selection) {
      receivedEmailInput.value = selection.slice(0, MAX_RECEIVED_EMAIL_LENGTH)
      updateReceivedCounter()
      syncReplyButtonLabel()
    }
    receivedEmailInput.focus()
    return
  }

  setMode("clip")
  if (menuId === MENU_CLIP_SELECTION) {
    await reExtractForClick()
    // The extractor only promotes a selection of 200+ characters, but the user asked
    // for this one specifically — so a short selection is written in directly.
    const selection = selectionText?.trim()
    if (selection && !descriptionInput.value.includes(selection)) {
      descriptionInput.value = selection.slice(0, MAX_DESCRIPTION_LENGTH)
      updateCounter()
    }
    return
  }
  // "clip-job" behaves exactly like a toolbar click, dirty-form protection included.
  await onActionClicked()
}

function watchBackgroundMessages() {
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const payload = message as
      | {
          type?: unknown
          windowId?: unknown
          menuId?: unknown
          clickId?: unknown
          selectionText?: unknown
        }
      | null
    if (!payload) return

    if (payload.type === ACTION_CLICKED_MESSAGE) {
      void onActionClicked(typeof payload.windowId === "number" ? payload.windowId : undefined)
      return
    }

    if (payload.type !== CONTEXT_MENU_MESSAGE) return
    if (
      panelWindowId !== undefined &&
      typeof payload.windowId === "number" &&
      payload.windowId !== panelWindowId
    ) {
      return
    }
    // The worker retries the broadcast for a panel that was still booting; the retry
    // can also land after a slow first delivery, so repeats of a click are dropped.
    const clickId = typeof payload.clickId === "string" ? payload.clickId : undefined
    if (clickId) {
      if (handledMenuClicks.has(clickId)) return
      handledMenuClicks.add(clickId)
    }
    if (typeof payload.menuId !== "string") return
    void onContextMenuClick(
      payload.menuId,
      typeof payload.selectionText === "string" ? payload.selectionText : undefined,
    )
  })
}

// ── Cold email ───────────────────────────────────────────────────────────────

type PanelMode = "clip" | "email" | "reply" | "search"

let mode: PanelMode = "clip"

const TABS: Record<PanelMode, { tab: HTMLButtonElement; view: HTMLElement }> = {
  clip: { tab: clipTab, view: clipView },
  email: { tab: emailTab, view: emailView },
  reply: { tab: replyTab, view: replyView },
  search: { tab: searchTab, view: searchView },
}

function setMode(next: PanelMode) {
  if (mode === next) return
  mode = next
  for (const [name, { tab, view }] of Object.entries(TABS)) {
    const active = name === next
    tab.classList.toggle("is-active", active)
    tab.setAttribute("aria-selected", String(active))
    view.hidden = !active
  }
  if (next === "search" && !searchLoaded) void loadSearchLinks()
}

// ── Search links ─────────────────────────────────────────────────────────────

/** Set once a fetch succeeds, so switching tabs does not refetch; Refresh always does. */
let searchLoaded = false
/** Bumped per fetch so a slow response cannot overwrite a newer one. */
let searchSeq = 0

function showSearchStatus(kind: StatusKind, message: string) {
  searchStatus.textContent = message
  searchStatus.className = `notice${kind === "error" ? " notice-error" : kind === "ok" ? " notice-ok" : kind === "warn" ? " notice-warn" : ""}`
  searchStatus.hidden = false
}

function clearSearchStatus() {
  searchStatus.hidden = true
  searchStatus.textContent = ""
}

async function copySearchQuery(query: string) {
  try {
    await navigator.clipboard.writeText(query)
    showSearchStatus("ok", "Query copied.")
  } catch {
    showSearchStatus("error", "Could not copy the query.")
  }
}

async function loadSearchLinks() {
  clearSearchStatus()
  if (!hasCredentials(settings)) {
    showSearchStatus("error", "Add your App URL and API token first.")
    setup.hidden = false
    return
  }
  const seq = ++searchSeq
  showSearchStatus("info", "Loading search links…")
  refreshSearchButton.disabled = true
  const result = await fetchSearchLinks(settings)
  if (seq !== searchSeq) return
  refreshSearchButton.disabled = false
  if (!result.ok) {
    showSearchStatus("error", result.message)
    return
  }
  clearSearchStatus()
  searchLoaded = true
  renderSearchLinks(searchResults, result.data, {
    appUrl: settings.appUrl,
    onCopy: (query) => void copySearchQuery(query),
  })
}

/**
 * The server ran a deterministic evidence check on the draft it just returned.
 * When it found something, saying so is the whole point — a draft that quietly
 * claims a skill the user does not have is worse than no draft.
 *
 * Two tiers, same as the web app: a bare mention is a warning, a mention the
 * draft itself frames as a gap is only worth confirming. The caller picks the
 * status colour off `claimed`, so a gap-only draft never turns the line amber.
 */
function groundingSentence(grounding: GroundingSummary): string {
  const parts: string[] = []
  if (grounding.claimed.length > 0) {
    const keywords = grounding.claimed.map((note) => note.keyword).join(", ")
    parts.push(
      ` Check it before sending: it mentions ${keywords}, which your resume does not back.`
    )
  }
  if (grounding.namedAsGap.length > 0) {
    const keywords = grounding.namedAsGap.map((note) => note.keyword).join(", ")
    parts.push(
      ` It names ${keywords} as ${
        grounding.namedAsGap.length === 1 ? "something" : "things"
      } you have not done — check that is what you meant.`
    )
  }
  return parts.join("")
}

/**
 * The other deterministic check on the same draft: the name in the sign-off.
 *
 * Same voice as `groundingSentence` — it asks the user to look, it does not
 * announce that the model lied, because the server only ever established that
 * the real name is ABSENT from the slot. `missing_name` never arrives (the
 * server withholds it, `parseSignature` refuses it), so there are only two
 * shapes to say.
 */
function signatureSentence(signature: SignatureFinding | null): string {
  if (!signature) return ""
  const signed = signature.offending.join(" / ")
  if (signature.issue === "unexpected_name") {
    return ` Check the sign-off: RoleSpec had no name on file for you and this draft signed off as “${signed}”.`
  }
  return ` Check the sign-off: it ends with “${signed}”, not ${signature.expectedName ?? "your name"}.`
}

function showEmailStatus(kind: StatusKind, message: string, link?: { href: string; label: string }) {
  emailStatus.textContent = message
  emailStatus.className = `notice${kind === "error" ? " notice-error" : kind === "ok" ? " notice-ok" : kind === "warn" ? " notice-warn" : ""}`
  emailStatus.hidden = false
  if (link) {
    emailStatus.append(" ")
    const anchor = document.createElement("a")
    anchor.className = "link"
    anchor.href = link.href
    anchor.target = "_blank"
    anchor.rel = "noreferrer"
    anchor.textContent = link.label
    emailStatus.append(anchor)
  }
}

function clearEmailStatus() {
  emailStatus.hidden = true
  emailStatus.textContent = ""
}

function showEmailNote(message: string) {
  emailNote.textContent = message
  emailNote.hidden = false
}

function clearEmailNote() {
  emailNote.hidden = true
  emailNote.textContent = ""
}

function updateAboutCounter() {
  const length = personAboutInput.value.length
  aboutCount.textContent = `${length} / ${MAX_PROFILE_ABOUT_LENGTH}`
  aboutCount.classList.toggle("over", length >= MAX_PROFILE_ABOUT_LENGTH)
}

/** The profile fields the read fills in, in the order the note lists them. */
const PROFILE_FIELD_LABELS: { key: LinkedInProfileField; label: string }[] = [
  { key: "name", label: "name" },
  { key: "headline", label: "headline" },
  { key: "company", label: "company" },
  { key: "about", label: "about" },
]

/**
 * Reads a LinkedIn profile out of the active tab. Same `activeTab` semantics as the
 * job flow: the grant comes from the click that opened the panel and does not survive
 * a tab switch, so a blocked read tells the user how to re-grant it.
 */
async function readProfileFromPage() {
  clearEmailNote()
  clearEmailStatus()
  readProfileButton.disabled = true
  readProfileButton.textContent = "Reading…"

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      showEmailNote("No active tab to read. Fill the fields in manually.")
      return
    }

    let profile: LinkedInProfileExtraction
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractLinkedInProfile,
      })
      profile = (injection?.result ?? {}) as LinkedInProfileExtraction
    } catch {
      showEmailNote(
        "This page cannot be read yet. Click the RoleSpec toolbar icon to read it, or fill the fields in manually (Chrome and extension pages can never be read).",
      )
      return
    }

    if (profile.name) personNameInput.value = profile.name
    if (profile.headline) personHeadlineInput.value = profile.headline
    if (profile.company) personCompanyInput.value = profile.company
    if (profile.about) personAboutInput.value = profile.about
    personProfileUrlInput.value = profile.profileUrl ?? tab.url ?? personProfileUrlInput.value
    updateAboutCounter()

    // Name the fields that came back empty: a silent partial read otherwise looks like a
    // successful one, and LinkedIn changing its markup is the usual cause.
    const missing = PROFILE_FIELD_LABELS.filter(({ key }) => !profile[key]).map(
      ({ label }) => label,
    )
    if (missing.length === PROFILE_FIELD_LABELS.length) {
      showEmailNote(
        "Could not read anything from this page — open a LinkedIn profile, or fill the fields in manually.",
      )
    } else if (!profile.name) {
      const others = missing.filter((label) => label !== "name")
      showEmailNote(
        `Could not read a name from this page — open a LinkedIn profile, or type it in.${
          others.length > 0 ? ` Also missing: ${others.join(", ")}.` : ""
        }`,
      )
    } else if (missing.length > 0) {
      showEmailNote(
        `Could not read: ${missing.join(", ")}. LinkedIn may have changed its page markup — fill them in manually.`,
      )
    }
  } finally {
    readProfileButton.disabled = false
    readProfileButton.textContent = "Read profile from page"
  }
}

/** Label for the generate button and the "writing…" copy, per message type. */
const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  cold_email: "cold email",
  connection_note: "connection note",
  linkedin_dm: "LinkedIn DM",
}

function selectedMessageType(): MessageType {
  const value = messageTypeSelect.value
  return (MESSAGE_TYPES as readonly string[]).includes(value)
    ? (value as MessageType)
    : "cold_email"
}

function selectedEmailTone(): OutreachTone {
  const value = emailToneSelect.value
  return (OUTREACH_TONES as readonly string[]).includes(value)
    ? (value as OutreachTone)
    : "professional"
}

function generateButtonLabel(): string {
  return `Generate ${MESSAGE_TYPE_LABELS[selectedMessageType()]}`
}

function syncGenerateButtonLabel() {
  if (generateButton.textContent?.startsWith("Writing")) return
  generateButton.textContent = generateButtonLabel()
}

function readEmailForm(): { person: LinkedInProfile; instructions?: string } | null {
  const name = personNameInput.value.trim()
  if (!name) {
    showEmailStatus("error", "A name is required.")
    return null
  }

  const person: LinkedInProfile = { name: name.slice(0, MAX_PROFILE_NAME_LENGTH) }

  const headline = personHeadlineInput.value.trim()
  if (headline) person.headline = headline.slice(0, MAX_PROFILE_HEADLINE_LENGTH)

  const company = personCompanyInput.value.trim()
  if (company) person.company = company.slice(0, MAX_PROFILE_COMPANY_LENGTH)

  const about = personAboutInput.value.trim()
  if (about) person.about = about.slice(0, MAX_PROFILE_ABOUT_LENGTH)

  // The server rejects a malformed URL for the whole request, so drop a too-long one
  // rather than trade a draft for a validation error.
  const profileUrl = personProfileUrlInput.value.trim()
  if (profileUrl && profileUrl.length <= MAX_PROFILE_URL_LENGTH) person.profileUrl = profileUrl

  const instructions = instructionsInput.value.trim()
  return {
    person,
    instructions: instructions ? instructions.slice(0, MAX_INSTRUCTIONS_LENGTH) : undefined,
  }
}

async function onGenerateEmail(event: SubmitEvent) {
  event.preventDefault()
  clearEmailStatus()

  if (!hasCredentials(settings)) {
    showEmailStatus("error", "Add your App URL and API token first.")
    setup.hidden = false
    return
  }

  const form = readEmailForm()
  if (!form) return

  const messageType = selectedMessageType()
  const payload: ColdEmailRequest = { ...form, messageType }

  // The server already defaults to professional, so the default is left off the wire
  // entirely — an older build of the server sees the same body it always saw.
  const tone = selectedEmailTone()
  if (tone !== "professional") payload.tone = tone

  const resumeId = selectedResumeId(emailResumeSelect)
  if (resumeId) payload.resumeId = resumeId

  generateButton.disabled = true
  generateButton.textContent = "Writing…"
  showEmailStatus(
    "info",
    `Writing the ${MESSAGE_TYPE_LABELS[messageType]} — this can take up to a minute.`,
  )

  const result = await generateColdEmail(settings, payload)

  generateButton.disabled = false
  generateButton.textContent = generateButtonLabel()

  if (result.ok) {
    // A connection note and a DM have no subject line, so the row would only ever
    // show an empty readonly box.
    emailSubjectOutput.value = result.subject
    emailSubjectRow.hidden = result.subject.length === 0
    emailBodyOutput.value = result.body
    if (messageType === "connection_note") {
      emailBodyCount.textContent = `${result.body.length}/${MAX_CONNECTION_NOTE_LENGTH}`
      emailBodyCount.classList.toggle("over", result.body.length > MAX_CONNECTION_NOTE_LENGTH)
      emailBodyCount.hidden = false
    } else {
      emailBodyCount.hidden = true
    }
    emailResult.hidden = false
    const warning = groundingSentence(result.grounding) + signatureSentence(result.signature)
    showEmailStatus(
      result.grounding.claimed.length > 0 || result.signature ? "warn" : "ok",
      `Draft ready. Nothing was saved to RoleSpec.${warning}`,
    )
    return
  }

  if (result.kind === "unauthorized") {
    showEmailStatus("error", `${result.message} Use Sign in to RoleSpec above.`)
    setup.hidden = false
    return
  }
  showEmailStatus("error", result.message)
}

async function copyToClipboard(button: HTMLButtonElement, value: string) {
  if (!value) return
  const original = button.textContent
  try {
    await navigator.clipboard.writeText(value)
    button.textContent = "Copied"
  } catch {
    button.textContent = "Copy failed"
  }
  setTimeout(() => {
    button.textContent = original
  }, 1500)
}

// ── Reply assist ─────────────────────────────────────────────────────────────

function showReplyStatus(kind: StatusKind, message: string, link?: { href: string; label: string }) {
  replyStatus.textContent = message
  replyStatus.className = `notice${kind === "error" ? " notice-error" : kind === "ok" ? " notice-ok" : kind === "warn" ? " notice-warn" : ""}`
  replyStatus.hidden = false
  if (link) {
    replyStatus.append(" ")
    const anchor = document.createElement("a")
    anchor.className = "link"
    anchor.href = link.href
    anchor.target = "_blank"
    anchor.rel = "noreferrer"
    anchor.textContent = link.label
    replyStatus.append(anchor)
  }
}

function updateReceivedCounter() {
  const length = receivedEmailInput.value.length
  receivedCount.textContent = `${length} / ${MAX_RECEIVED_EMAIL_LENGTH}`
  receivedCount.classList.toggle("over", length >= MAX_RECEIVED_EMAIL_LENGTH)
}

function updatePriorThreadCounter() {
  const length = replyPriorThreadInput.value.length
  priorThreadCount.textContent = `${length} / ${MAX_PRIOR_THREAD_LENGTH}`
  priorThreadCount.classList.toggle("over", length >= MAX_PRIOR_THREAD_LENGTH)
}

function selectedReplyTone(): ReplyTone {
  const value = replyToneSelect.value
  return (REPLY_TONES as readonly string[]).includes(value)
    ? (value as ReplyTone)
    : "professional"
}

function selectedReplyLength(): ReplyLength {
  const value = replyLengthSelect.value
  return (REPLY_LENGTHS as readonly string[]).includes(value)
    ? (value as ReplyLength)
    : "standard"
}

/**
 * The last successful draft, kept so a second run on the *same* received email can
 * ask the model to rewrite rather than start over. Cleared implicitly by comparing
 * `receivedEmail`: edit the pasted email and it stops being a regenerate.
 */
let lastReply: { receivedEmail: string; body: string } | null = null

function canRegenerateReply(): boolean {
  return lastReply !== null && lastReply.receivedEmail === receivedEmailInput.value.trim()
}

function syncReplyButtonLabel() {
  replyButton.textContent = canRegenerateReply() ? "Regenerate reply" : "Generate reply"
}

function readReplyForm(): EmailReplyRequest | null {
  const receivedEmail = receivedEmailInput.value.trim()
  if (!receivedEmail) {
    showReplyStatus("error", "Paste the email you received first.")
    return null
  }

  const payload: EmailReplyRequest = {
    receivedEmail: receivedEmail.slice(0, MAX_RECEIVED_EMAIL_LENGTH),
  }

  // The server already defaults to professional/standard, so the defaults are left
  // off the wire entirely — an older build of the server sees the same body it
  // always saw.
  const tone = selectedReplyTone()
  if (tone !== "professional") payload.tone = tone

  const length = selectedReplyLength()
  if (length !== "standard") payload.length = length

  // Empty means "newest resume", which is what the server does without a `resumeId`.
  const resumeId = selectedResumeId(replyResumeSelect)
  if (resumeId) payload.resumeId = resumeId

  const companyName = replyCompanyInput.value.trim()
  const jobTitle = replyJobTitleInput.value.trim()
  const jobDescription = replyJobDescriptionInput.value.trim()
  if (companyName || jobTitle || jobDescription) {
    payload.job = {}
    if (companyName) payload.job.companyName = companyName.slice(0, MAX_JOB_CONTEXT_LENGTH)
    if (jobTitle) payload.job.jobTitle = jobTitle.slice(0, MAX_JOB_CONTEXT_LENGTH)
    if (jobDescription) {
      payload.job.jobDescription = jobDescription.slice(0, MAX_JOB_DESCRIPTION_CONTEXT_LENGTH)
    }
  }

  const priorThread = replyPriorThreadInput.value.trim()
  if (priorThread) payload.priorThread = priorThread.slice(0, MAX_PRIOR_THREAD_LENGTH)

  const instructions = replyInstructionsInput.value.trim()
  if (instructions) payload.instructions = instructions.slice(0, MAX_INSTRUCTIONS_LENGTH)

  // Only a rerun on an unchanged received email counts as a regenerate.
  if (canRegenerateReply() && lastReply?.body) {
    payload.previousDraft = lastReply.body.slice(0, MAX_PREVIOUS_DRAFT_LENGTH)
  }

  return payload
}

async function onGenerateReply(event: SubmitEvent) {
  event.preventDefault()
  replyStatus.hidden = true

  if (!hasCredentials(settings)) {
    showReplyStatus("error", "Add your App URL and API token first.")
    setup.hidden = false
    return
  }

  const payload = readReplyForm()
  if (!payload) return

  replyButton.disabled = true
  replyButton.textContent = "Writing…"
  showReplyStatus("info", "Writing the reply — this can take up to a minute.")

  const result = await generateEmailReply(settings, payload)

  replyButton.disabled = false
  if (result.ok) {
    lastReply = { receivedEmail: payload.receivedEmail, body: result.body }
  }
  syncReplyButtonLabel()

  if (result.ok) {
    replySubjectOutput.value = result.subject
    replyBodyOutput.value = result.body
    replyResult.hidden = false
    const warning = groundingSentence(result.grounding) + signatureSentence(result.signature)
    showReplyStatus(
      result.grounding.claimed.length > 0 || result.signature ? "warn" : "ok",
      `${
        payload.previousDraft
          ? "Rewritten draft ready. Nothing was saved to RoleSpec."
          : "Draft ready. Nothing was saved to RoleSpec."
      }${warning}`
    )
    return
  }

  if (result.kind === "unauthorized") {
    showReplyStatus("error", `${result.message} Use Sign in to RoleSpec above.`)
    setup.hidden = false
    return
  }
  showReplyStatus("error", result.message)
}

function readForm(): ClippedJob | null {
  const companyName = companyInput.value.trim()
  const jobTitle = titleInput.value.trim()
  if (!companyName || !jobTitle) {
    showStatus("error", "Company and job title are required.")
    return null
  }

  const job: ClippedJob = { companyName, jobTitle }

  const jobLink = linkInput.value.trim()
  if (jobLink) job.jobLink = jobLink

  const location = locationInput.value.trim()
  if (location) job.location = location

  const salary = Number.parseInt(salaryInput.value.trim(), 10)
  if (Number.isFinite(salary) && salary > 0) job.salary = salary

  const salaryCurrency = salaryCurrencySelect.value
  if ((SALARY_CURRENCIES as readonly string[]).includes(salaryCurrency)) {
    job.salaryCurrency = salaryCurrency as SalaryCurrency
  }

  const salaryPeriod = salaryPeriodSelect.value
  if ((SALARY_PERIODS as readonly string[]).includes(salaryPeriod)) {
    job.salaryPeriod = salaryPeriod as SalaryPeriod
  }

  const jobType = jobTypeSelect.value
  if (jobType) job.jobType = jobType as JobType

  const workType = workTypeSelect.value
  if ((WORK_TYPES as readonly string[]).includes(workType)) {
    job.workType = workType as WorkType
  }

  const jobDescription = descriptionInput.value.trim()
  if (jobDescription) job.jobDescription = jobDescription.slice(0, MAX_DESCRIPTION_LENGTH)

  // Only ever set by the extractor, and only from a date the posting published;
  // the server re-validates the format and drops the clip's dates if it cannot.
  const postedAt = postedAtInput.value.trim()
  if (postedAt) job.postedAt = postedAt

  const deadline = deadlineInput.value.trim()
  if (deadline) job.deadline = deadline

  return job
}

async function onSubmit(event: SubmitEvent) {
  event.preventDefault()
  clearStatus()

  if (!hasCredentials(settings)) {
    showStatus("error", "Add your App URL and API token first.")
    setup.hidden = false
    return
  }

  const job = readForm()
  if (!job) return

  saveButton.disabled = true
  saveButton.textContent = "Saving…"
  showStatus("info", "Saving to RoleSpec…")

  const result = await postJob(settings, job)

  saveButton.disabled = false
  saveButton.textContent = "Save to RoleSpec"

  if (result.ok && result.kind === "duplicate") {
    // Not an error and not a second save: the job is already there.
    showStatus("info", "Already saved in RoleSpec —", {
      href: `${settings.appUrl}/jobs/${result.id}`,
      label: "open it",
    })
    dirty = false
    saveButton.hidden = true
    clipAnotherButton.hidden = false
    return
  }

  if (result.ok) {
    showStatus("ok", "Saved.", { href: `${settings.appUrl}/jobs`, label: "View in RoleSpec" })
    if (result.risk) showRisk(result.risk)
    showQualification(result.qualification, result.requirements, {
      ...(result.marketFit && { marketFit: result.marketFit }),
      ...(result.confidence && { confidence: result.confidence }),
    })
    // The panel stays open, so instead of locking the form for good, offer a fresh clip.
    dirty = false
    saveButton.hidden = true
    clipAnotherButton.hidden = false
    return
  }

  if (result.kind === "unauthorized") {
    showStatus("error", result.message)
    setup.hidden = false
    return
  }
  showStatus("error", result.message)
}

async function onClipAnother() {
  clearForm()
  resetToClipState()
  await extractNow({ clearFirst: true })
}

// ── Resume pickers ───────────────────────────────────────────────────────────

const RESUME_SELECTS = [emailResumeSelect, replyResumeSelect]

/** The picked resume, or undefined for "let the server use the newest one". */
function selectedResumeId(select: HTMLSelectElement): string | undefined {
  const value = select.value.trim()
  return value ? value : undefined
}

function fillResumeSelect(select: HTMLSelectElement, resumes: ResumeSummary[]) {
  const keep = preservedSelection(select.value, resumes)
  const fallback = document.createElement("option")
  fallback.value = ""
  fallback.textContent = "Latest resume"
  const options = [fallback]
  for (const resume of resumes) {
    const option = document.createElement("option")
    option.value = resume.id
    option.textContent = resumeOptionLabel(resume)
    options.push(option)
  }
  select.replaceChildren(...options)
  select.value = keep
}

/**
 * Fills both pickers from GET /api/extension/resumes. Every failure is swallowed: the
 * list is a convenience, and both draft routes fall back to the newest resume without
 * a `resumeId`, so a missing list must never stop anyone drafting.
 */
async function loadResumes() {
  if (!hasCredentials(settings)) return
  const result = await fetchResumes(settings)
  if (!result.ok) return
  for (const select of RESUME_SELECTS) fillResumeSelect(select, result.resumes)
}

function applySettings(next: Settings) {
  settings = next
  const ready = hasCredentials(settings)
  setup.hidden = ready
  if (ready) {
    saveButton.title = ""
    generateButton.title = ""
    replyButton.title = ""
    if (!saveButton.textContent?.startsWith("Saving")) saveButton.disabled = false
    if (!generateButton.textContent?.startsWith("Writing")) generateButton.disabled = false
    if (!replyButton.textContent?.startsWith("Writing")) replyButton.disabled = false
  } else {
    // A settings change that still leaves us unconnected clears any stale sign-in result.
    if (!setupSignInButton.disabled) setupText.textContent = SETUP_PROMPT
    saveButton.disabled = true
    saveButton.title = "Set your App URL and API token in options first"
    generateButton.disabled = true
    generateButton.title = "Set your App URL and API token in options first"
    replyButton.disabled = true
    replyButton.title = "Set your App URL and API token in options first"
  }
}

/** A persistent panel would otherwise keep serving a token the user just replaced. */
function watchSettings() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !(SETTINGS_STORAGE_KEY in changes)) return
    void loadSettings().then((next) => {
      const credentialsChanged =
        next.appUrl !== settings.appUrl || next.apiToken !== settings.apiToken
      applySettings(next)
      // A new token or a new App URL means a different resume list.
      if (credentialsChanged) {
        void loadResumes()
        // Links from the old account or App URL must not survive a re-sign-in.
        searchLoaded = false
        searchResults.replaceChildren()
      }
    })
  })
}

/** A grant can also land from chrome://extensions, so the panel reacts to any of them. */
function watchSitePermissions() {
  chrome.permissions.onAdded.addListener(() => {
    void refreshBadgeEnable()
    if (handledOwnGrant) {
      handledOwnGrant = false
      return
    }
    if (dirty) return
    void extractNow({ clearFirst: true })
  })
  // A revoke at chrome://extensions brings the badge button back.
  chrome.permissions.onRemoved.addListener(() => void refreshBadgeEnable())
}

function watchActiveTab() {
  chrome.tabs.onActivated.addListener((info) => {
    if (panelWindowId !== undefined && info.windowId !== panelWindowId) return
    void refreshBadgeEnable()
    void onActiveTabChanged()
  })
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab.active) return
    if (panelWindowId !== undefined && tab.windowId !== panelWindowId) return
    void refreshBadgeEnable()
    void onActiveTabChanged()
  })
}

async function init() {
  descriptionInput.addEventListener("input", updateCounter)
  optionsLink.addEventListener("click", openOptions)
  setupLink.addEventListener("click", openOptions)
  setupSignInButton.addEventListener("click", () => void onSetupSignIn())
  form.addEventListener("submit", onSubmit)
  form.addEventListener("input", () => {
    dirty = true
  })
  form.addEventListener("change", () => {
    dirty = true
  })
  clipAnotherButton.addEventListener("click", () => void onClipAnother())
  replacePageButton.addEventListener("click", () => void reExtractForClick())
  grantAccessButton.addEventListener("click", onGrantAccess)
  enableBadgesButton.addEventListener("click", onEnableBadges)
  clipTab.addEventListener("click", () => setMode("clip"))
  emailTab.addEventListener("click", () => setMode("email"))
  replyTab.addEventListener("click", () => setMode("reply"))
  searchTab.addEventListener("click", () => setMode("search"))
  refreshSearchButton.addEventListener("click", () => void loadSearchLinks())
  messageTypeSelect.addEventListener("change", syncGenerateButtonLabel)
  personAboutInput.addEventListener("input", updateAboutCounter)
  readProfileButton.addEventListener("click", () => void readProfileFromPage())
  emailForm.addEventListener("submit", (event) => void onGenerateEmail(event))
  copySubjectButton.addEventListener(
    "click",
    () => void copyToClipboard(copySubjectButton, emailSubjectOutput.value),
  )
  copyBodyButton.addEventListener(
    "click",
    () => void copyToClipboard(copyBodyButton, emailBodyOutput.value),
  )
  receivedEmailInput.addEventListener("input", () => {
    updateReceivedCounter()
    syncReplyButtonLabel()
  })
  replyPriorThreadInput.addEventListener("input", updatePriorThreadCounter)
  replyForm.addEventListener("submit", (event) => void onGenerateReply(event))
  copyReplySubjectButton.addEventListener(
    "click",
    () => void copyToClipboard(copyReplySubjectButton, replySubjectOutput.value),
  )
  copyReplyBodyButton.addEventListener(
    "click",
    () => void copyToClipboard(copyReplyBodyButton, replyBodyOutput.value),
  )
  updateCounter()
  updateAboutCounter()
  updateReceivedCounter()
  updatePriorThreadCounter()
  syncGenerateButtonLabel()
  syncReplyButtonLabel()
  // Registered before the first await so a click landing during startup is not missed.
  watchBackgroundMessages()

  applySettings(await loadSettings())
  watchSettings()
  // Not awaited: the pickers hold a usable default until the list lands.
  void loadResumes()

  panelWindowId = (await chrome.windows.getCurrent()).id
  watchActiveTab()
  watchSitePermissions()
  void refreshBadgeEnable()

  await extractNow({ clearFirst: false, retryOnBlocked: true })
}

void init()
