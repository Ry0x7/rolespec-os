import type { Settings } from "./types"

const STORAGE_KEY = "rolespec.settings"

/** Exported so the side panel can watch `chrome.storage.onChanged` for this key. */
export const SETTINGS_STORAGE_KEY = STORAGE_KEY

export const DEFAULT_APP_URL = "http://localhost:3100"

export function normalizeAppUrl(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const raw = stored[STORAGE_KEY] as Partial<Settings> | undefined
  return {
    appUrl: normalizeAppUrl(raw?.appUrl ?? DEFAULT_APP_URL),
    apiToken: (raw?.apiToken ?? "local").trim(),
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      appUrl: normalizeAppUrl(settings.appUrl),
      apiToken: settings.apiToken.trim() || "local",
    } satisfies Settings,
  })
}

export function hasCredentials(settings: Settings): boolean {
  return settings.appUrl.length > 0
}
