import { extractLinkedInPdfText } from "./parse-linkedin-pdf"
import {
  LINKEDIN_PDF_MAX_BYTES,
  LINKEDIN_PDF_MIN_TEXT_LENGTH,
} from "../constants/linkedin"
import { logger } from "@/shared/lib/logger"
import { sniffUploadKind } from "@/shared/lib/upload-validation"

const log = logger("linkedin")

const ALLOWED_TYPES = ["application/pdf"]
/** One copy for every way an upload can fail to be a PDF. */
const INVALID_TYPE_ERROR =
  "Only PDF files are supported — use LinkedIn's 'Save to PDF' export"

/** Failure shape shared by both LinkedIn routes — maps 1:1 to the JSON body. */
export interface LinkedinUploadFailure {
  ok: false
  error: string
  code:
    | "INVALID_BODY"
    | "NO_FILE"
    | "INVALID_TYPE"
    | "TOO_LARGE"
    | "RATE_LIMITED"
    | "PARSE_FAILED"
    | "EMPTY_PDF"
  status: number
}

export interface LinkedinUploadSuccess {
  ok: true
  /** Plain text extracted from the export. */
  text: string
  /** Original upload name. */
  fileName: string
  /** Optional resume to attach as extra rating context. Absent when blank. */
  resumeId?: string
}

/** Reads an optional text field from the same parse — blank/non-string is absent. */
function optionalField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export type LinkedinUploadResult = LinkedinUploadSuccess | LinkedinUploadFailure

interface RateLimitGuard {
  /** Resolves true when the caller has used up its sliding window. */
  isLimited: () => Promise<boolean>
  /** User-facing copy for the 429. */
  error: string
}

/**
 * Reads the multipart body of a LinkedIn "Save profile as PDF" upload, validates
 * it (presence, type, 5 MB cap), applies the optional rate-limit guard, then
 * extracts its text.
 *
 * Runs before the AI call so a bad PDF costs no compute. Shared by
 * `POST /api/linkedin/rating` and `POST /api/linkedin/assist`
 * so both report identical error codes and copy.
 */
export async function readLinkedinPdfUpload(
  req: Request,
  rateLimit?: RateLimitGuard
): Promise<LinkedinUploadResult> {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return {
      ok: false,
      error: "Invalid request body",
      code: "INVALID_BODY",
      status: 400,
    }
  }

  const file = formData.get("file")

  if (!file || !(file instanceof File)) {
    return { ok: false, error: "No file provided", code: "NO_FILE", status: 400 }
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      ok: false,
      error: INVALID_TYPE_ERROR,
      code: "INVALID_TYPE",
      status: 400,
    }
  }

  // The name is caller-controlled too, but a mismatched extension is still the
  // cheapest signal that this is not the LinkedIn export.
  if (!/\.pdf$/i.test(file.name)) {
    return {
      ok: false,
      error: INVALID_TYPE_ERROR,
      code: "INVALID_TYPE",
      status: 400,
    }
  }

  if (file.size > LINKEDIN_PDF_MAX_BYTES) {
    return {
      ok: false,
      error: "File size must be 5 MB or less",
      code: "TOO_LARGE",
      status: 400,
    }
  }

  // Checked before parsing so a throttled caller never pays for PDF extraction.
  if (rateLimit && (await rateLimit.isLimited())) {
    return {
      ok: false,
      error: rateLimit.error,
      code: "RATE_LIMITED",
      status: 429,
    }
  }

  let text: string
  try {
    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)

    // `file.type` is whatever the client claimed, so the bytes get the last
    // word. Reading them means buffering the file, which is why this sits
    // after the size and rate-limit gates.
    if (sniffUploadKind(bytes) !== "pdf") {
      return {
        ok: false,
        error: INVALID_TYPE_ERROR,
        code: "INVALID_TYPE",
        status: 400,
      }
    }

    text = await extractLinkedInPdfText(bytes)
  } catch (err) {
    log.error("LinkedIn PDF parse failed", { err })
    return {
      ok: false,
      error: "Could not read that PDF. Please try exporting it again.",
      code: "PARSE_FAILED",
      status: 400,
    }
  }

  if (text.length < LINKEDIN_PDF_MIN_TEXT_LENGTH) {
    return {
      ok: false,
      error:
        "No readable text found in that PDF. Use LinkedIn's 'Save profile as PDF' export rather than a screenshot.",
      code: "EMPTY_PDF",
      status: 400,
    }
  }

  return {
    ok: true,
    text,
    fileName: file.name,
    resumeId: optionalField(formData, "resumeId"),
  }
}
