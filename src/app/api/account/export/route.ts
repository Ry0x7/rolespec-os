import { NextResponse } from "next/server"

import { auth } from "@/features/auth/config"
import { exportFilename, exportUserData } from "@/features/settings/services/export-user-data"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"
import { DATA_EXPORT_RATE_LIMIT } from "@/features/settings/constants/data"

/**
 * Downloads everything the app holds about the signed-in user, as JSON.
 *
 * A route handler rather than a server action because the result is a file: this
 * way the browser's own download machinery sets the filename and the response
 * never has to be marshalled through React.
 *
 * Reads a large fan-out of tables, so it is rate limited — the query is expensive
 * and nobody needs their own data twice a minute.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  const exportAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.DATA_EXPORT,
    userId,
    DATA_EXPORT_RATE_LIMIT
  )
  if (!exportAllowed) {
    return NextResponse.json(
      {
        error: "You have requested several exports recently. Try again in a few minutes.",
        code: "RATE_LIMITED",
      },
      { status: 429 }
    )
  }

  const data = await exportUserData(userId)
  if (!data) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 })
  }

  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename()}"`,
      // Contains the user's full résumé data — must never be cached by a shared
      // proxy or written to the browser's disk cache.
      "cache-control": "no-store, private",
    },
  })
}
