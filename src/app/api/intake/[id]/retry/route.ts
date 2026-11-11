import { NextResponse } from "next/server"

import { resolveApiUserId } from "@/features/auth/api-auth"
import {
  IntakeRunError,
  retryIntakeRun,
} from "@/features/intake/services/intake-run.service"
import { scheduleIntakeRun } from "@/features/intake/services/schedule"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }
  const { id } = await params
  try {
    const run = await retryIntakeRun(userId, id)
    await scheduleIntakeRun(id)
    return NextResponse.json({ run }, { status: 202 })
  } catch (error) {
    if (error instanceof IntakeRunError) {
      return NextResponse.json(
        { error: error.message, code: error.status === 404 ? "INTAKE_NOT_FOUND" : "INTAKE_STATE" },
        { status: error.status }
      )
    }
    throw error
  }
}
