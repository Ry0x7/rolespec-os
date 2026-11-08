"use server"

import { timingSafeEqual } from "node:crypto"
import { redirect } from "next/navigation"

import { extractClientIp } from "@/shared/lib/client-ip"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"
import { headers } from "next/headers"

import {
  clearOwnerUnlockCookie,
  getAccessKey,
  requestAccessState,
  safeReturnPath,
  setOwnerUnlockCookie,
} from "./config"

const UNLOCK_RATE_LIMIT = { max: 8, windowMs: 15 * 60 * 1000 }

export type UnlockState = { error: string } | null

function secureEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function clientIp(): Promise<string> {
  try {
    return extractClientIp(await headers())
  } catch {
    return "unknown"
  }
}

export async function unlockWorkspace(
  _previous: UnlockState,
  formData: FormData
): Promise<UnlockState> {
  const next = safeReturnPath(
    typeof formData.get("next") === "string" ? String(formData.get("next")) : null
  )
  const state = await requestAccessState()

  if (state === "owner") redirect(next)
  if (state === "blocked") {
    return { error: "Remote access is not configured on this server." }
  }

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.OWNER_UNLOCK,
    await clientIp(),
    UNLOCK_RATE_LIMIT
  )
  if (!allowed) {
    return { error: "Too many attempts. Wait a few minutes and try again." }
  }

  const provided = String(formData.get("key") ?? "").trim()
  if (!provided) return { error: "Enter the owner access key." }

  const configured = getAccessKey()
  if (!configured) {
    return { error: "Remote access is not configured on this server." }
  }
  if (!secureEqual(provided, configured)) {
    return { error: "That key is not correct." }
  }

  const stored = await setOwnerUnlockCookie()
  if (!stored) {
    return { error: "Could not start a session. Check the server logs and retry." }
  }

  redirect(next)
}

/** Clears the remote access cookie. Only shown when the key gate is in use. */
export async function lockWorkspaceAction(): Promise<void> {
  await clearOwnerUnlockCookie()
  redirect("/unlock")
}
