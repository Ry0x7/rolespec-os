import { NextResponse } from "next/server"

import { resolveApiUserId } from "@/features/auth/api-auth"
import { INTAKE_UPLOAD_RATE_LIMIT } from "@/features/intake/constants/limits"
import {
  createIntakeRun,
  getIntakeRun,
} from "@/features/intake/services/intake-run.service"
import { scheduleIntakeRun } from "@/features/intake/services/schedule"
import {
  readIntakeUpload,
  type IntakeUploadSource,
} from "@/features/intake/services/intake-upload.service"
import { logger } from "@/shared/lib/logger"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

const log = logger("api/intake/upload")

export const dynamic = "force-dynamic"
export const maxDuration = 60

function uploadSource(value: string | null): IntakeUploadSource | null {
  return value === "RESUME" || value === "LINKEDIN" ? value : null
}

/**
 * A file upload is extracted synchronously because the extracted text is what
 * the run persists — retrying a failed document source then needs no file
 * retention. Audio is never uploaded; voice arrives as a client transcript.
 */
export async function POST(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }

  const url = new URL(req.url)
  const source = uploadSource(url.searchParams.get("source"))
  if (!source) {
    return NextResponse.json(
      { error: "Choose RESUME or LINKEDIN as the upload source.", code: "INVALID_SOURCE" },
      { status: 400 }
    )
  }

  if (
    !(await consumeRateLimit(RATE_LIMIT_BUCKETS.INTAKE_UPLOAD, userId, INTAKE_UPLOAD_RATE_LIMIT))
  ) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait a few minutes.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  const upload = await readIntakeUpload(req, source)
  if (!upload.ok) {
    return NextResponse.json({ error: upload.error, code: upload.code }, { status: upload.status })
  }

  try {
    const useAi = url.searchParams.get("useAi") === "1"
    const runId = await createIntakeRun(userId, [
      {
        source,
        input: {
          text: upload.text,
          fileName: upload.fileName,
          ...(source === "LINKEDIN" ? { useAi } : {}),
        },
      },
    ])
    const run = await getIntakeRun(userId, runId)
    await scheduleIntakeRun(runId)
    return NextResponse.json({ run }, { status: 202 })
  } catch (error) {
    log.error("Could not create upload intake", { err: error, source })
    return NextResponse.json(
      { error: "Could not start intake. Please try again.", code: "INTAKE_FAILED" },
      { status: 500 }
    )
  }
}
