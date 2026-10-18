import { NextResponse } from "next/server"

import { pruneExpiredExports } from "@/features/export/services/store-export"

/**
 * Retention sweep for generated resume exports, which hold a full copy of the
 * resume's personal data outside the database. Deletes `ResumeExport` rows and
 * the stored PDFs (blob and disk) older than EXPORT_RETENTION_DAYS.
 *
 * Scheduled daily in `vercel.json`; Vercel sends the `CRON_SECRET` as a bearer
 * token, and the route is useless without it. A self-hosted deployment with no
 * scheduler must call this endpoint itself, or exports are kept indefinitely.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pruned = await pruneExpiredExports()
  return NextResponse.json({ pruned })
}
