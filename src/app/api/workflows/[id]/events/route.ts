import { NextResponse } from "next/server"

import { resolveApiUserId } from "@/features/auth/api-auth"
import {
  WorkflowError,
  getWorkflowEvents,
} from "@/features/workflows/services/workflow.service"

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
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50)

  try {
    const events = await getWorkflowEvents(userId, id, Number.isFinite(limit) ? limit : 50)
    return NextResponse.json({ events })
  } catch (error) {
    if (error instanceof WorkflowError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 })
    }
    throw error
  }
}
