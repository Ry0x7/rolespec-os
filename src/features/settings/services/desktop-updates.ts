import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * Desktop-only update preference.
 *
 * The Tauri shell reads this file directly before it schedules its startup
 * update check; the settings page writes it. It is intentionally not part of
 * the Prisma preferences column: the shell has no database access at that
 * point, and a self-hosted web deployment has no updater to configure.
 */

export const DESKTOP_UPDATE_SETTINGS_FILE = "updates.json"

export interface DesktopUpdateSettings {
  autoCheck: boolean
}

const DEFAULT_SETTINGS: DesktopUpdateSettings = { autoCheck: true }

export function isDesktopRuntime(): boolean {
  return process.env.ROLSPEC_DESKTOP === "1"
}

function desktopDataRoot(): string | null {
  const root = process.env.ROLSPEC_DATA_DIR?.trim()
  return root ? root : null
}

/** Absolute path of `config/updates.json`, or null outside the desktop app. */
export function desktopUpdatesFilePath(): string | null {
  const root = desktopDataRoot()
  return root ? path.join(root, "config", DESKTOP_UPDATE_SETTINGS_FILE) : null
}

/**
 * Missing, malformed or partially-written files keep checks enabled. A bad
 * preference must not silently stop security updates; the shell logs the same
 * fallback when it reads the file.
 */
export function parseDesktopUpdateSettings(contents: string): DesktopUpdateSettings {
  try {
    const parsed: unknown = JSON.parse(contents)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { autoCheck?: unknown }).autoCheck === "boolean"
    ) {
      return { autoCheck: (parsed as DesktopUpdateSettings).autoCheck }
    }
  } catch {
    // Fall through to the default.
  }
  return { ...DEFAULT_SETTINGS }
}

export async function readDesktopUpdateSettings(): Promise<DesktopUpdateSettings> {
  const file = desktopUpdatesFilePath()
  if (!file) return { ...DEFAULT_SETTINGS }

  try {
    return parseDesktopUpdateSettings(await readFile(file, "utf8"))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function writeDesktopUpdateSettings(
  settings: DesktopUpdateSettings
): Promise<void> {
  const file = desktopUpdatesFilePath()
  if (!file) throw new Error("The desktop data directory is not configured.")

  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8")
}
