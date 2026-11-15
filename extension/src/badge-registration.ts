/**
 * Keeps the fit-badge content script registered for exactly the supported job boards the
 * user has granted. Takes the few `chrome.*` calls it needs as a dependency object, so
 * the grant / revoke paths are unit-testable; background.ts passes the real `chrome`.
 */
import { isSupportedOriginPattern } from "./badge-sites"

export const BADGE_SCRIPT_ID = "rolespec-badge"
export const BADGE_SCRIPT_FILE = "assets/badge.js"

/** The slice of the `chrome` API this module touches. */
export interface BadgeRegistrationDeps {
  permissions: { getAll(): Promise<{ origins?: string[] }> }
  scripting: {
    getRegisteredContentScripts(filter: { ids: string[] }): Promise<Array<{ id: string }>>
    registerContentScripts(scripts: chrome.scripting.RegisteredContentScript[]): Promise<void>
    updateContentScripts(scripts: chrome.scripting.RegisteredContentScript[]): Promise<void>
    unregisterContentScripts(filter: { ids: string[] }): Promise<void>
    executeScript(injection: { target: { tabId: number; allFrames?: boolean }; files: string[] }): Promise<unknown>
  }
  tabs: { query(query: { url: string[] }): Promise<Array<{ id?: number }>> }
  log?: { error(...args: unknown[]): void; warn(...args: unknown[]): void }
}

export function createBadgeRegistration(deps: BadgeRegistrationDeps) {
  const log = deps.log ?? console
  let queue: Promise<void> = Promise.resolve()

  async function syncNow(): Promise<void> {
    const granted = await deps.permissions.getAll()
    const matches = (granted.origins ?? []).filter(isSupportedOriginPattern)
    const existing = await deps.scripting.getRegisteredContentScripts({ ids: [BADGE_SCRIPT_ID] })
    if (matches.length === 0) {
      if (existing.length > 0) await deps.scripting.unregisterContentScripts({ ids: [BADGE_SCRIPT_ID] })
      return
    }
    const script: chrome.scripting.RegisteredContentScript = {
      id: BADGE_SCRIPT_ID,
      js: [BADGE_SCRIPT_FILE],
      matches,
      runAt: "document_idle",
      allFrames: false,
      persistAcrossSessions: true,
    }
    if (existing.length > 0) await deps.scripting.updateContentScripts([script])
    else await deps.scripting.registerContentScripts([script])
  }

  /**
   * Registers, updates or unregisters to match the current grants. Serialised, because
   * onInstalled / onStartup / onAdded can overlap and a second `register` of the same id
   * throws.
   */
  function syncBadgeScripts(): Promise<void> {
    queue = queue.then(syncNow, syncNow).catch((error: unknown) => {
      log.error("[rolespec] syncBadgeScripts failed", error)
    })
    return queue
  }

  /**
   * `permissions.onAdded`: a grant on a supported board registers the script and runs it
   * once in the tabs already open there, so no reload is needed (badge.ts ignores a
   * second copy). A grant on any other site does nothing.
   */
  async function onPermissionsAdded(permissions: { origins?: string[] }): Promise<void> {
    const supported = (permissions.origins ?? []).filter(isSupportedOriginPattern)
    if (supported.length === 0) return
    await syncBadgeScripts()
    const tabs = await deps.tabs.query({ url: supported })
    for (const tab of tabs) {
      if (tab.id === undefined) continue
      await deps.scripting
        .executeScript({ target: { tabId: tab.id, allFrames: false }, files: [BADGE_SCRIPT_FILE] })
        .catch((error: unknown) => log.warn("[rolespec] badge inject failed", tab.id, error))
    }
  }

  /** `permissions.onRemoved`: shrink the registration, or drop it when nothing is left. */
  function onPermissionsRemoved(): Promise<void> {
    return syncBadgeScripts()
  }

  return { syncBadgeScripts, onPermissionsAdded, onPermissionsRemoved }
}
