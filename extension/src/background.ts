/**
 * Minimal MV3 service worker. It owns the toolbar-icon click (there is no
 * `action.default_popup`): open the side panel if it is closed, and either way tell an
 * open panel that the user just clicked, because that click is what re-grants
 * `activeTab` for the tab and the panel has no other way to learn about it.
 * It also serves the in-page fit badges (see the end of this file); that part imports
 * shared modules, which the module worker (`"type": "module"`) resolves as chunks.
 */
import { MAX_QUALIFY_POSTINGS, qualifyPostings, type QualifyPosting } from "./api"
import { BADGE_CACHE_KEY, mergeCache, readCache, type BadgeCache, type BadgeVerdict } from "./badge-cache"
import { createBadgeRegistration } from "./badge-registration"
import { hasCredentials, loadSettings, SETTINGS_STORAGE_KEY } from "./settings"
import { MAX_DESCRIPTION_LENGTH, WORK_TYPES, type WorkType } from "./types"

const ACTION_CLICKED_MESSAGE = "rolespec:action-clicked"

/** Sent for every context-menu click. See `src/sidepanel.ts` for the handlers. */
const CONTEXT_MENU_MESSAGE = "rolespec:context-menu"

/** A cold-opened panel needs a beat to boot before it can hear the broadcast. */
const BROADCAST_RETRY_MS = 400

const MENU_CLIP_JOB = "clip-job"
const MENU_CLIP_SELECTION = "clip-selection"
const MENU_COLD_EMAIL = "cold-email-person"
const MENU_REPLY_EMAIL = "reply-email"

/**
 * Re-creating a menu id that already exists throws, and `onInstalled` fires again on
 * every update and on every "Reload" in chrome://extensions — so clear first.
 */
function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    // Reading lastError marks it handled; a failed removeAll must not block creation.
    void chrome.runtime.lastError
    const menus: chrome.contextMenus.CreateProperties[] = [
      { id: MENU_CLIP_JOB, title: "Clip this job to RoleSpec", contexts: ["page"] },
      {
        id: MENU_CLIP_SELECTION,
        title: "Use selection as job description",
        contexts: ["selection"],
      },
      {
        id: MENU_COLD_EMAIL,
        title: "Cold email this person with RoleSpec",
        contexts: ["page", "selection"],
        documentUrlPatterns: [
          "https://www.linkedin.com/in/*",
          "https://*.linkedin.com/in/*",
        ],
      },
      {
        // Any URL: the email being answered can sit in any webmail client.
        id: MENU_REPLY_EMAIL,
        title: "Draft a reply with RoleSpec",
        contexts: ["selection"],
      },
    ]
    for (const menu of menus) {
      chrome.contextMenus.create(menu, () => {
        const error = chrome.runtime.lastError
        // Duplicate ids are survivable: the menu the user needs is already there.
        if (error) console.warn("[rolespec] contextMenus.create", menu.id, error.message)
      })
    }
  })
}

/**
 * The click is handled explicitly below, so Chrome must not swallow it by toggling the
 * panel itself — with `openPanelOnActionClick: true`, `action.onClicked` never fires.
 */
function takeOverActionClick(): void {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error: unknown) => {
      console.error("[rolespec] setPanelBehavior failed", error)
    })
}

chrome.runtime.onInstalled.addListener(() => {
  takeOverActionClick()
  createMenus()
})
chrome.runtime.onStartup.addListener(takeOverActionClick)
takeOverActionClick()

chrome.action.onClicked.addListener((tab) => {
  // `sidePanel.open` needs the user gesture, which is lost across an `await`, so it must
  // be the first call in this listener. It is a no-op when the panel is already open.
  const target = tab.id !== undefined ? { tabId: tab.id } : { windowId: tab.windowId }
  const opened = chrome.sidePanel.open(target).catch((error: unknown) => {
    console.error("[rolespec] sidePanel.open failed", error)
  })

  void opened.then(() =>
    chrome.runtime
      .sendMessage({
        type: ACTION_CLICKED_MESSAGE,
        tabId: tab.id,
        windowId: tab.windowId,
      })
      // No panel document is listening yet on a cold open — it runs its own extraction
      // when it loads, so a failed send is expected and not an error.
      .catch(() => undefined),
  )
})

/**
 * Context-menu commands carry instructions the panel cannot reconstruct on its own
 * (which menu, what was selected), so unlike the action click there is no
 * "the panel figures it out on load" path — retry once for a panel that is still
 * booting. Failures stay silent: there may simply be no panel.
 */
function broadcastMenuClick(message: Record<string, unknown>): void {
  // `sendMessage` rejects with "Receiving end does not exist" when no panel document
  // is listening yet, which is exactly the case worth retrying — and only that case,
  // so an already-open panel never handles the same click twice.
  const send = () =>
    chrome.runtime
      .sendMessage(message)
      .then(() => true)
      .catch(() => false)

  void send().then((delivered) => {
    if (delivered) return
    setTimeout(() => void send(), BROADCAST_RETRY_MS)
  })
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Same gesture rule as the toolbar click: `sidePanel.open` must run before any
  // await, and this click is also what grants `activeTab` for the page.
  const target =
    tab?.id !== undefined ? { tabId: tab.id } : tab?.windowId !== undefined ? { windowId: tab.windowId } : undefined
  if (target) {
    void chrome.sidePanel.open(target).catch((error: unknown) => {
      console.error("[rolespec] sidePanel.open failed", error)
    })
  }

  broadcastMenuClick({
    type: CONTEXT_MENU_MESSAGE,
    // The retry can land after a slow first delivery, so every click is stamped and
    // the panel drops a repeat of the same one.
    clickId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    menuId: info.menuItemId,
    tabId: tab?.id,
    windowId: tab?.windowId,
    selectionText: info.selectionText,
  })
})

// ---------------------------------------------------------------------------
// In-page fit badges
// ---------------------------------------------------------------------------

const QUALIFY_MESSAGE = "rolespec:qualify"

type QualifyReply =
  | { ok: true; profileComplete: boolean; results: BadgeVerdict[] }
  | { ok: false; reason: string }

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

/** The message comes from our own content script, but it is still shaped defensively. */
function toPostings(value: unknown): QualifyPosting[] {
  if (!Array.isArray(value)) return []
  const postings: QualifyPosting[] = []
  for (const entry of value.slice(0, MAX_QUALIFY_POSTINGS)) {
    if (typeof entry !== "object" || entry === null) continue
    const row = entry as Record<string, unknown>
    const key = str(row.key, 512)
    const title = str(row.title, 300)
    if (!key || !title) continue
    const url = str(row.url, 2048)
    const workType = (WORK_TYPES as readonly unknown[]).includes(row.workType) ? (row.workType as WorkType) : null
    postings.push({
      key,
      title,
      ...(url && /^https?:\/\//i.test(url) ? { url } : {}),
      companyName: str(row.companyName, 200),
      location: str(row.location, 200),
      workType,
      description: str(row.description, MAX_DESCRIPTION_LENGTH),
    })
  }
  return postings
}

async function handleQualify(raw: unknown): Promise<QualifyReply> {
  const postings = toPostings(raw)
  const settings = await loadSettings()
  if (!hasCredentials(settings)) return { ok: false, reason: "signed-out" }
  if (postings.length === 0) return { ok: true, profileComplete: true, results: [] }

  const stored = await chrome.storage.session.get(BADGE_CACHE_KEY)
  const cache = stored[BADGE_CACHE_KEY] as BadgeCache | undefined
  const { hits, misses } = readCache(cache, postings.map((posting) => posting.key), Date.now())
  // Only verdicts from a complete profile are ever cached, so a full hit implies one.
  if (misses.length === 0) return { ok: true, profileComplete: true, results: hits }

  const missing = new Set(misses)
  const result = await qualifyPostings(settings, postings.filter((posting) => missing.has(posting.key)))
  if (!result.ok) return { ok: false, reason: result.reason }
  if (!result.profileComplete) return { ok: true, profileComplete: false, results: [] }

  const fresh: BadgeVerdict[] = result.results
    .filter((row) => missing.has(row.key))
    .map(({ key, verdict, riskLevel, matched }) => ({ key, verdict, riskLevel, matched }))
  // Re-read right before writing: another tab may have merged in the meantime.
  const latest = (await chrome.storage.session.get(BADGE_CACHE_KEY))[BADGE_CACHE_KEY] as BadgeCache | undefined
  await chrome.storage.session.set({ [BADGE_CACHE_KEY]: mergeCache(latest, fresh, Date.now()) })
  return { ok: true, profileComplete: true, results: [...hits, ...fresh] }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const payload = message as { type?: unknown; postings?: unknown } | null
  if (payload?.type !== QUALIFY_MESSAGE || sender.id !== chrome.runtime.id) return false
  void handleQualify(payload.postings)
    .catch((): QualifyReply => ({ ok: false, reason: "unknown" }))
    .then(sendResponse)
  return true
})

// Verdicts belong to one account: a new App URL or token must not show the old ones.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && SETTINGS_STORAGE_KEY in changes) {
    void chrome.storage.session.remove(BADGE_CACHE_KEY)
  }
})

const badgeRegistration = createBadgeRegistration(chrome)

chrome.runtime.onInstalled.addListener(() => void badgeRegistration.syncBadgeScripts())
chrome.runtime.onStartup.addListener(() => void badgeRegistration.syncBadgeScripts())
chrome.permissions.onAdded.addListener((permissions) => void badgeRegistration.onPermissionsAdded(permissions))
chrome.permissions.onRemoved.addListener(() => void badgeRegistration.onPermissionsRemoved())
