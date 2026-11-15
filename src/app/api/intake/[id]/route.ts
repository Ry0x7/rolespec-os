import { NextResponse } from "next/server"

import { resolveApiUserId } from "@/features/auth/api-auth"
import {
  getIntakeRun,
  IntakeRunError,
} from "@/features/intake/services/intake-run.service"

export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }

  const { id } = await params
  try {
    return NextResponse.json({ run: await getIntakeRun(userId, id) })
  } catch (error) {
    if (error instanceof IntakeRunError) {
      return NextResponse.json(
        { error: error.message, code: "INTAKE_NOT_FOUND" },
        { status: error.status }
      )
    }
    throw error
  }
}
