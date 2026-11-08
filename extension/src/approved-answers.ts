/**
 * Local, reusable answers for ATS questions that were not safe to fill from
 * the profile. The cache lives in `chrome.storage.local` on this browser
 * profile only; it never leaves the machine through RoleSpec.
 *
 * The cache is keyed by the normalized visible label (`answerKey`), so the same
 * question on a different vendor reuses the answer while a slightly different
 * question does not. Values are capped and the number of entries is bounded.
 */

import { answerKey, type ApprovedAnswers } from "./autofill-core"

export const ANSWER_CACHE_KEY = "rolespec.approvedAnswers"

const MAX_ANSWERS = 200
const MAX_ANSWER_LENGTH = 1000

function sanitize(input: unknown): ApprovedAnswers {
  if (typeof input !== "object" || input === null) return {}
  const clean: ApprovedAnswers = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalized = answerKey(key)
    if (!normalized) continue
    if (typeof value !== "string") continue
    const trimmed = value.trim().slice(0, MAX_ANSWER_LENGTH)
    if (!trimmed) continue
    clean[normalized] = trimmed
    if (Object.keys(clean).length >= MAX_ANSWERS) break
  }
  return clean
}

export async function loadApprovedAnswers(): Promise<ApprovedAnswers> {
  try {
    const stored = await chrome.storage.local.get(ANSWER_CACHE_KEY)
    return sanitize(stored[ANSWER_CACHE_KEY])
  } catch {
    return {}
  }
}

async function writeApprovedAnswers(answers: ApprovedAnswers): Promise<ApprovedAnswers> {
  const clean = sanitize(answers)
  await chrome.storage.local.set({ [ANSWER_CACHE_KEY]: clean })
  return clean
}

/** Saves (or replaces) one answer. Returns the updated, sanitized cache. */
export async function saveApprovedAnswer(
  label: string,
  value: string,
): Promise<ApprovedAnswers> {
  const key = answerKey(label)
  const trimmed = value.trim().slice(0, MAX_ANSWER_LENGTH)
  if (!key || !trimmed) return loadApprovedAnswers()
  const current = await loadApprovedAnswers()
  current[key] = trimmed
  return writeApprovedAnswers(current)
}

export async function deleteApprovedAnswer(label: string): Promise<ApprovedAnswers> {
  const key = answerKey(label)
  const current = await loadApprovedAnswers()
  if (key in current) delete current[key]
  return writeApprovedAnswers(current)
}

export async function clearApprovedAnswers(): Promise<void> {
  try {
    await chrome.storage.local.remove(ANSWER_CACHE_KEY)
  } catch {
    // A failed clear is harmless; the next save overwrites the cache.
  }
}

export { answerKey }
