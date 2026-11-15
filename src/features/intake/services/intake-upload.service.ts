import { extractResumeText } from "@/features/resume/services/parse-resume"
import { checkZipSanity, sniffUploadKind } from "@/shared/lib/upload-validation"

const RESUME_MAX_BYTES = 10 * 1024 * 1024
const LINKEDIN_MAX_BYTES = 5 * 1024 * 1024
const MIN_TEXT_LENGTH = 20

export type IntakeUploadSource = "RESUME" | "LINKEDIN"

export type IntakeUploadResult =
  | { ok: true; text: string; fileName: string }
  | {
      ok: false
      status: 400 | 413 | 415
      code:
        | "INVALID_BODY"
        | "NO_FILE"
        | "INVALID_TYPE"
        | "TOO_LARGE"
        | "PARSE_FAILED"
        | "EMPTY_FILE"
      error: string
    }

/**
 * Reads an uploaded resume or LinkedIn export. The browser-declared MIME type is
 * ignored in favour of the leading bytes; DOCX is a zip and gets the existing
 * structural sanity check before the parser sees it.
 */
export async function readIntakeUpload(
  req: Request,
  source: IntakeUploadSource
): Promise<IntakeUploadResult> {
  const maxBytes = source === "LINKEDIN" ? LINKEDIN_MAX_BYTES : RESUME_MAX_BYTES
  // `formData()` buffers the whole body, so reject an obviously oversized
  // request from its declared length before parsing multipart. The exact file
  // size is checked again below; this is the cheap first line of defence.
  const declaredLength = Number(req.headers.get("content-length") ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes + 1024 * 1024) {
    return {
      ok: false,
      status: 413,
      code: "TOO_LARGE",
      error: `File is too large. Maximum ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    }
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return { ok: false, status: 400, code: "INVALID_BODY", error: "Invalid request body" }
  }

  const file = formData.get("file")
  if (!file || !(file instanceof File)) {
    return { ok: false, status: 400, code: "NO_FILE", error: "No file provided" }
  }

  if (file.size > maxBytes) {
    return {
      ok: false,
      status: 413,
      code: "TOO_LARGE",
      error: `File is too large. Maximum ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    }
  }
  if (file.size === 0) {
    return { ok: false, status: 400, code: "EMPTY_FILE", error: "File is empty" }
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  const kind = sniffUploadKind(buffer)
  if (!kind) {
    return {
      ok: false,
      status: 415,
      code: "INVALID_TYPE",
      error:
        source === "LINKEDIN"
          ? "Only PDF files are supported — use LinkedIn's 'Save to PDF' export."
          : "Only PDF and DOCX files are supported.",
    }
  }
  if (source === "LINKEDIN" && kind !== "pdf") {
    return {
      ok: false,
      status: 415,
      code: "INVALID_TYPE",
      error: "Only PDF files are supported — use LinkedIn's 'Save to PDF' export.",
    }
  }
  if (kind === "zip") {
    const sanity = checkZipSanity(buffer)
    if (!sanity.ok) {
      return {
        ok: false,
        status: 415,
        code: "INVALID_TYPE",
        error: "That file is not a valid DOCX document.",
      }
    }
  }

  const mimeType =
    kind === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

  let text: string
  try {
    text = await extractResumeText(buffer, mimeType)
  } catch {
    return {
      ok: false,
      status: 400,
      code: "PARSE_FAILED",
      error: "That file could not be read. Try another export, or paste the text.",
    }
  }

  if (text.trim().length < MIN_TEXT_LENGTH) {
    return {
      ok: false,
      status: 400,
      code: "PARSE_FAILED",
      error:
        "No readable text was found. If this is a scanned PDF, paste the text instead.",
    }
  }

  return { ok: true, text, fileName: file.name.slice(0, 255) }
}
