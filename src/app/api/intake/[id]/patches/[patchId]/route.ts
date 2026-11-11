import { NextResponse } from "next/server"

import { resolveApiUserId } from "@/features/auth/api-auth"
import {
  applyIntakePatchSchema,
  correctIntakePatchSchema,
  rejectIntakePatchSchema,
} from "@/features/intake/schemas/intake.schema"
import {
  applyIntakePatch,
  correctIntakePatch,
  IntakeApplyError,
  rejectIntakePatch,
} from "@/features/intake/services/intake-apply.service"

export const dynamic = "force-dynamic"

function errorResponse(error: unknown) {
  if (error instanceof IntakeApplyError) {
    return NextResponse.json(
      {
        error: error.message,
        code:
          error.status === 404
            ? "PATCH_NOT_FOUND"
            : error.status === 409
              ? "CONFLICT"
              : "INVALID_INPUT",
      },
      { status: error.status }
    )
  }
  throw error
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

/** Applies the fact. A collision without `disposition` returns a conflict task. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; patchId: string }> }
) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }
  const { patchId } = await params
  const parsed = applyIntakePatchSchema.safeParse(await readJson(req))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request", code: "INVALID_INPUT" },
      { status: 400 }
    )
  }

  try {
    const result = await applyIntakePatch(userId, patchId, parsed.data.disposition)
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

/** Corrects the fact before or after it is applied; the audit keeps the old value. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; patchId: string }> }
) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }
  const { patchId } = await params
  const parsed = correctIntakePatchSchema.safeParse(await readJson(req))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid correction", code: "INVALID_INPUT" },
      { status: 400 }
    )
  }

  try {
    const result = await correctIntakePatch(
      userId,
      patchId,
      parsed.data.correction,
      parsed.data.note
    )
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

/** Rejects the proposed fact. Applied facts cannot be rejected retroactively. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; patchId: string }> }
) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }
  const { patchId } = await params
  const parsed = rejectIntakePatchSchema.safeParse(await readJson(req))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request", code: "INVALID_INPUT" },
      { status: 400 }
    )
  }

  try {
    const result = await rejectIntakePatch(userId, patchId, parsed.data.reason)
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
