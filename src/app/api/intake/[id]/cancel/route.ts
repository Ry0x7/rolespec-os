import { NextResponse } from "next/server"

import { resolveApiUserId } from "@/features/auth/api-auth"
import {
  cancelIntakeRun,
  IntakeRunError,
} from "@/features/intake/services/intake-run.service"

export const dynamic = "force-dynamic"

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
    const run = await cancelIntakeRun(userId, id)
    return NextResponse.json({ run })
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
