"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"

import { auth } from "@/features/auth/config"

import {
  isDesktopRuntime,
  readDesktopUpdateSettings,
  readDesktopUpdateStatus,
  writeDesktopUpdateRequest,
  writeDesktopUpdateSettings,
  type DesktopUpdateChannel,
} from "../services/desktop-updates"

/**
 * Saves the desktop shell's startup update-check preference.
 *
 * This is deliberately separate from `updatePreferences`: that column is
 * per-user application data, while the updater runs before the app server is
 * ready and reads a file next to the managed database instead.
 */
export async function updateDesktopAutoCheck(input: { autoCheck: boolean }) {
  if (!isDesktopRuntime()) {
    return { error: "Update settings are only available in the desktop app." }
  }

  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  if (typeof input?.autoCheck !== "boolean") {
    return { error: "Invalid input" }
  }

  try {
    const current = await readDesktopUpdateSettings()
    await writeDesktopUpdateSettings({ ...current, autoCheck: input.autoCheck })
    revalidatePath("/settings/preferences")
    return { success: true as const }
  } catch {
    return { error: "Could not save the update setting." }
  }
}

/**
 * Saves the release channel. The setting is intentionally separate from
 * `autoCheck`: turning automatic checks off must not silently move the user
 * back to stable, and selecting beta must not re-enable automatic checks.
 */
export async function updateDesktopChannel(input: { channel: DesktopUpdateChannel }) {
  if (!isDesktopRuntime()) {
    return { error: "Update settings are only available in the desktop app." }
  }

  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  if (input?.channel !== "stable" && input?.channel !== "beta") {
    return { error: "Invalid input" }
  }

  try {
    const current = await readDesktopUpdateSettings()
    await writeDesktopUpdateSettings({ ...current, channel: input.channel })
    revalidatePath("/settings/preferences")
    return { success: true as const }
  } catch {
    return { error: "Could not save the update channel." }
  }
}

/**
 * Requests an immediate check. The shell cannot be reached over HTTP, so the
 * request is a file next to the managed database; `getDesktopUpdateStatus`
 * polls the answer the shell writes back.
 */
export async function requestDesktopUpdateCheck(): Promise<
  { id: string } | { error: string }
> {
  if (!isDesktopRuntime()) {
    return { error: "Update settings are only available in the desktop app." }
  }

  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    const id = randomUUID()
    await writeDesktopUpdateRequest(id)
    return { id }
  } catch {
    return { error: "Could not start an update check." }
  }
}

export async function getDesktopUpdateStatus(): Promise<
  { status: Awaited<ReturnType<typeof readDesktopUpdateStatus>> } | { error: string }
> {
  if (!isDesktopRuntime()) {
    return { error: "Update settings are only available in the desktop app." }
  }

  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  try {
    return { status: await readDesktopUpdateStatus() }
  } catch {
    return { status: null }
  }
}
