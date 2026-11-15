import type { ClippedJob } from "./types"

export const PENDING_CLIPS_KEY = "rolespec.pending-clips"
export const MAX_PENDING_CLIPS = 20

export interface PendingClip extends ClippedJob {
  /** `companyName` + `jobTitle` are required by `ClippedJob`. */
  queuedAt: string
  attempts: number
}

/** Type guard for one entry read back out of `chrome.storage.local`. */
export function isPendingClip(value: unknown): value is PendingClip {
  if (typeof value !== "object" || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.companyName === "string" &&
    row.companyName.trim().length > 0 &&
    typeof row.jobTitle === "string" &&
    row.jobTitle.trim().length > 0
  )
}

/** Coerces untrusted storage back into a list; drops malformed rows. */
export function coercePendingClips(value: unknown): PendingClip[] {
  if (!Array.isArray(value)) return []
  const clips: PendingClip[] = []
  for (const entry of value) {
    if (!isPendingClip(entry)) continue
    const row = entry as PendingClip
    clips.push({
      ...row,
      queuedAt: typeof row.queuedAt === "string" ? row.queuedAt : new Date().toISOString(),
      attempts: typeof row.attempts === "number" ? row.attempts : 0,
    })
  }
  return clips.slice(0, MAX_PENDING_CLIPS)
}

/** Oldest-first insert with a hard cap; newest wins when the queue is full. */
export function withQueuedClip(existing: PendingClip[], job: ClippedJob): PendingClip[] {
  const next: PendingClip[] = [
    ...existing,
    { ...job, queuedAt: new Date().toISOString(), attempts: 0 },
  ]
  return next.slice(-MAX_PENDING_CLIPS)
}

export function withoutQueuedClip(existing: PendingClip[], index: number): PendingClip[] {
  return existing.filter((_, i) => i !== index)
}

export function pendingLabel(count: number): string {
  return count === 1 ? "1 job waiting to retry" : `${count} jobs waiting to retry`
}

async function readQueue(): Promise<PendingClip[]> {
  const stored = await chrome.storage.local.get(PENDING_CLIPS_KEY)
  return coercePendingClips(stored[PENDING_CLIPS_KEY])
}

async function writeQueue(clips: PendingClip[]): Promise<void> {
  await chrome.storage.local.set({ [PENDING_CLIPS_KEY]: clips })
}

export async function loadPendingClips(): Promise<PendingClip[]> {
  try {
    return await readQueue()
  } catch {
    return []
  }
}

export async function queuePendingClip(job: ClippedJob): Promise<PendingClip[]> {
  const next = withQueuedClip(await loadPendingClips(), job)
  try {
    await writeQueue(next)
  } catch {
    // Storage full/blocked: the in-memory list is still returned for the UI.
  }
  return next
}

export async function removePendingClip(index: number): Promise<PendingClip[]> {
  const next = withoutQueuedClip(await loadPendingClips(), index)
  try {
    await writeQueue(next)
  } catch {
    // Keep the in-memory list; the banner just re-reads on next open.
  }
  return next
}

export async function clearPendingClips(): Promise<void> {
  try {
    await chrome.storage.local.remove(PENDING_CLIPS_KEY)
  } catch {
    // Best effort: a stale queue is filtered by the coercer anyway.
  }
}
