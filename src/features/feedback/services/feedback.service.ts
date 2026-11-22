import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"

import type { FeedbackMap } from "../types"

const log = logger("feedback")

/** Postgres parameter limits stay far away when keys are read in chunks. */
const KEY_CHUNK_SIZE = 200

/**
 * The caller's explicit verdicts for these postings, keyed the same way the
 * discovery pipeline keys them. No text is interpreted here: a row exists only
 * because the user set one.
 */
export async function loadFeedbackByKeys(
  userId: string,
  keys: readonly string[]
): Promise<FeedbackMap> {
  const unique = [...new Set(keys.filter((key) => key.trim().length > 0))]
  if (unique.length === 0) return {}

  try {
    const rows: Array<{ postingKey: string; verdict: FeedbackMap[string] }> = []
    for (let index = 0; index < unique.length; index += KEY_CHUNK_SIZE) {
      const chunk = unique.slice(index, index + KEY_CHUNK_SIZE)
      const found = await prisma.jobFeedback.findMany({
        where: { userId, postingKey: { in: chunk } },
        select: { postingKey: true, verdict: true },
      })
      rows.push(...found)
    }
    return Object.fromEntries(rows.map((row) => [row.postingKey, row.verdict]))
  } catch (err) {
    // Feedback is an overlay on factual ranking, never a reason to fail the
    // ranking or a discovery run. The next request will read it again.
    log.warn("Could not read feedback; ranking will use factual scores only", {
      err,
      userId,
      keys: unique.length,
    })
    return {}
  }
}
