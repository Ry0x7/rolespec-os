import { NextResponse } from "next/server"

import { resolveApiUserId } from "@/features/auth/api-auth"
import { getWorkflow } from "@/features/workflows/services/workflow.service"

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
  const workflow = await getWorkflow(userId, id)
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found", code: "NOT_FOUND" }, { status: 404 })
  }
  return NextResponse.json({ workflow })
}
