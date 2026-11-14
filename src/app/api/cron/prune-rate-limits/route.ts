import { NextResponse } from "next/server"

import { pruneAttempts } from "@/shared/lib/rate-limit"

/** Attempts older than a week are useless: every window in use is 15-60 minutes. */
const PRUNE_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Housekeeping cron for `rate_limit_attempts`, which otherwise grows forever.
 * Scheduled daily in `vercel.json`; Vercel sends the `CRON_SECRET` as a bearer
 * token, and the route is useless without it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pruned = await pruneAttempts(PRUNE_OLDER_THAN_MS)
  return NextResponse.json({ pruned })
}
