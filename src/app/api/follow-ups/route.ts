import { NextResponse } from "next/server"

import { resolveApiUserId } from "@/features/auth/api-auth"
import { followUpTaskStatusSchema } from "@/features/jobs/schemas/follow-up-task.schema"
import { listFollowUpTasks } from "@/features/jobs/services/follow-up-task.service"
import { FOLLOW_UP_WRITE_RATE_LIMIT } from "@/features/settings/constants/data"
import type { FollowUpStatus } from "@/generated/prisma/enums"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

export const dynamic = "force-dynamic"

/**
 * Durable follow-ups, not advice. A row is a reminder the user can act on; the
 * app never sends the email or LinkedIn message itself.
 */
export async function GET(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }
  if (
    !(await consumeRateLimit(
      RATE_LIMIT_BUCKETS.FOLLOW_UP_WRITE,
      userId,
      FOLLOW_UP_WRITE_RATE_LIMIT
    ))
  ) {
    return NextResponse.json(
      { error: "Too many follow-up requests. Try again shortly.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  const url = new URL(req.url)
  const rawStatus = url.searchParams.get("status")
  const status = rawStatus ? followUpTaskStatusSchema.safeParse(rawStatus) : null
  if (status && !status.success) {
    return NextResponse.json(
      { error: "Unknown follow-up status filter.", code: "INVALID_INPUT" },
      { status: 400 }
    )
  }
  const rawLimit = Number(url.searchParams.get("limit") ?? 50)
  const items = await listFollowUpTasks(userId, {
    ...(status?.success ? { status: status.data as FollowUpStatus } : {}),
    ...(url.searchParams.get("jobApplicationId")
      ? { jobApplicationId: url.searchParams.get("jobApplicationId")! }
      : {}),
    dueOnly: url.searchParams.get("due") === "1",
    limit: Number.isFinite(rawLimit) ? rawLimit : 50,
  })

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "private, no-store" } }
  )
}
