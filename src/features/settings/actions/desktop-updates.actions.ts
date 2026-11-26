"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"

import { auth } from "@/features/auth/config"

import {
  isDesktopRuntime,
  readDesktopUpdateStatus,
  writeDesktopUpdateRequest,
  writeDesktopUpdateSettings,
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
    await writeDesktopUpdateSettings({ autoCheck: input.autoCheck })
    revalidatePath("/settings/preferences")
    return { success: true as const }
  } catch {
    return { error: "Could not save the update setting." }
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
