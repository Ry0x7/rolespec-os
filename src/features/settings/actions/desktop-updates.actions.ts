"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/features/auth/config"

import {
  isDesktopRuntime,
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
