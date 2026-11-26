import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
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
export const DESKTOP_UPDATE_REQUEST_FILE = "update-check.json"
export const DESKTOP_UPDATE_STATUS_FILE = "update-status.json"

export type DesktopUpdateChannel = "stable" | "beta"

export interface DesktopUpdateSettings {
  autoCheck: boolean
  channel: DesktopUpdateChannel
}

export type DesktopUpdateState =
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "installing"
  | "declined"
  | "error"
  | "unavailable"
  | "busy"

/**
 * Result the Tauri shell writes while answering a manual check. The state
 * names are shared with `desktop/src-tauri/src/update.rs`; changing one side
 * without the other silently breaks the button.
 */
export interface DesktopUpdateStatus {
  id: string
  state: DesktopUpdateState
  currentVersion?: string
  version?: string
  progress?: number
  message?: string
  checkedAt?: string
}

const DEFAULT_SETTINGS: DesktopUpdateSettings = { autoCheck: true, channel: "stable" }

const UPDATE_STATES = new Set<DesktopUpdateState>([
  "checking",
  "upToDate",
  "available",
  "downloading",
  "installing",
  "declined",
  "error",
  "unavailable",
  "busy",
])

export function isDesktopRuntime(): boolean {
  return process.env.ROLSPEC_DESKTOP === "1"
}

function desktopDataRoot(): string | null {
  const root = process.env.ROLSPEC_DATA_DIR?.trim()
  return root ? root : null
}

function desktopConfigPath(fileName: string): string | null {
  const root = desktopDataRoot()
  return root ? path.join(root, "config", fileName) : null
}

/** Absolute path of `config/updates.json`, or null outside the desktop app. */
export function desktopUpdatesFilePath(): string | null {
  return desktopConfigPath(DESKTOP_UPDATE_SETTINGS_FILE)
}

/** Absolute path of `config/update-check.json`, or null outside the desktop app. */
export function desktopUpdateRequestPath(): string | null {
  return desktopConfigPath(DESKTOP_UPDATE_REQUEST_FILE)
}

/** Absolute path of `config/update-status.json`, or null outside the desktop app. */
export function desktopUpdateStatusPath(): string | null {
  return desktopConfigPath(DESKTOP_UPDATE_STATUS_FILE)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

/**
 * Missing, malformed or partially-written files keep checks enabled. A bad
 * preference must not silently stop security updates; the shell logs the same
 * fallback when it reads the file.
 */
export function parseDesktopUpdateChannel(value: unknown): DesktopUpdateChannel {
  return value === "beta" ? "beta" : "stable"
}

export function parseDesktopUpdateSettings(contents: string): DesktopUpdateSettings {
  try {
    const parsed: unknown = JSON.parse(contents)
    if (typeof parsed === "object" && parsed !== null) {
      const candidate = parsed as { autoCheck?: unknown; channel?: unknown }
      return {
        autoCheck: typeof candidate.autoCheck === "boolean" ? candidate.autoCheck : true,
        channel: parseDesktopUpdateChannel(candidate.channel),
      }
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

/**
 * Asks the shell to check immediately. The shell watches this file while the
 * app is running, deletes it after reading, and reports progress through
 * `update-status.json`.
 */
export async function writeDesktopUpdateRequest(id: string): Promise<void> {
  const file = desktopUpdateRequestPath()
  if (!file) throw new Error("The desktop data directory is not configured.")

  await mkdir(path.dirname(file), { recursive: true })
  // A rename keeps the shell from reading a half-written request. The temp
  // name is unique so two rapid clicks cannot clobber each other.
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temp, `${JSON.stringify({ id }, null, 2)}\n`, "utf8")
  await rename(temp, file)
}

/**
 * Validates a status written by the shell. Unknown states and malformed
 * documents are treated as "no answer yet" rather than shown to the user;
 * the next poll usually replaces them.
 */
export function parseDesktopUpdateStatus(contents: string): DesktopUpdateStatus | null {
  try {
    const parsed: unknown = JSON.parse(contents)
    if (typeof parsed !== "object" || parsed === null) return null

    const candidate = parsed as Record<string, unknown>
    const id = nonEmptyString(candidate.id)
    const state = candidate.state
    if (!id || typeof state !== "string" || !UPDATE_STATES.has(state as DesktopUpdateState)) {
      return null
    }

    const status: DesktopUpdateStatus = { id, state: state as DesktopUpdateState }

    const currentVersion = nonEmptyString(candidate.currentVersion)
    if (currentVersion) status.currentVersion = currentVersion

    const version = nonEmptyString(candidate.version)
    if (version) status.version = version

    const message = nonEmptyString(candidate.message)
    if (message) status.message = message

    const checkedAt = nonEmptyString(candidate.checkedAt)
    if (checkedAt) status.checkedAt = checkedAt

    if (
      typeof candidate.progress === "number" &&
      Number.isInteger(candidate.progress) &&
      candidate.progress >= 0 &&
      candidate.progress <= 100
    ) {
      status.progress = candidate.progress
    }

    return status
  } catch {
    return null
  }
}

export async function readDesktopUpdateStatus(): Promise<DesktopUpdateStatus | null> {
  const file = desktopUpdateStatusPath()
  if (!file) return null

  try {
    return parseDesktopUpdateStatus(await readFile(file, "utf8"))
  } catch {
    return null
  }
}
