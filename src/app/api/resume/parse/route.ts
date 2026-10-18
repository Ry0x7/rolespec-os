import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { parseResumeFile } from "@/features/resume/services/parse-resume"
import { analyzeResumeATS } from "@/features/resume/services/ats-analyze"
import {
  ATS_RATE_LIMIT_MAX,
  ATS_RATE_LIMIT_WINDOW_MS,
  MAX_ATS_JOB_DESCRIPTION_LENGTH,
} from "@/features/resume/constants/ats"
import { rateLimited } from "@/shared/lib/errors"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import { logger } from "@/shared/lib/logger"
import {
  checkZipSanity,
  sanitizeUploadTitle,
  sniffUploadKind,
} from "@/shared/lib/upload-validation"

const log = logger("resume/parse")

/**
 * The longest request in the app: text extraction, then a full-resume
 * `generateObject` parse, then an optional second bullet pass, then a
 * multi-step transaction, then a further `analyzeResumeATS` call when a job
 * description was supplied. Two to three sequential model round trips. See the
 * note in ../../linkedin/assist/route.ts on the 60s value.
 */
export const maxDuration = 60

const MAX_TARGET_ROLE_LENGTH = 200

/** Sliding window for the per-user upload/parse rate limit. */
const PARSE_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }

/** The text fields alongside the upload — untrusted, so capped. */
const textFieldsSchema = z.object({
  targetRole: z.string().max(MAX_TARGET_ROLE_LENGTH).optional(),
  jobDescription: z.string().max(MAX_ATS_JOB_DESCRIPTION_LENGTH).optional(),
})

const PDF_TYPE = "application/pdf"
const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
// `application/msword` (legacy binary .doc) is deliberately absent: mammoth
// cannot read that format, so accepting it only produced a parse failure later.
const ALLOWED_TYPES = [PDF_TYPE, DOCX_TYPE]
const ALLOWED_EXTENSIONS = /\.(pdf|docx)$/i
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
/** Multipart framing costs a little more than the file itself. */
const CONTENT_LENGTH_SLACK = 1024
const UNSUPPORTED_TYPE_ERROR = "Only PDF and DOCX files are supported"
const TOO_LARGE_ERROR = "File size must be 5 MB or less"

export async function POST(req: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  // ── Rate limit: max 10 uploads per user per 10 minutes ──────────────────
  // Checked before the body is read or the PDF is parsed, so a throttled caller
  // never burns AI compute.
  const parseAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.RESUME_PARSE,
    userId,
    PARSE_RATE_LIMIT
  )
  if (!parseAllowed) {
    return NextResponse.json(
      {
        error: "Too many resume uploads. Please wait a few minutes and try again.",
        code: "RATE_LIMITED",
      },
      { status: 429 }
    )
  }

  // ── File validation ─────────────────────────────────────────────────────
  // Cheap first pass on the declared body size: `req.formData()` buffers the
  // whole request, so an obviously oversized upload is refused before that.
  // The header is advisory, hence the exact `file.size` check further down.
  const declaredLength = Number(req.headers?.get("content-length") ?? "")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES + CONTENT_LENGTH_SLACK) {
    return NextResponse.json({ error: TOO_LARGE_ERROR }, { status: 413 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    )
  }

  const file = formData.get("file")

  // A FormData part can be a File, so the value has to be narrowed at runtime
  // before it is trusted as text.
  const targetRoleRaw = formData.get("targetRole")
  const jobDescriptionRaw = formData.get("jobDescription")
  const parsedFields = textFieldsSchema.safeParse({
    targetRole: targetRoleRaw === null ? undefined : targetRoleRaw,
    jobDescription: jobDescriptionRaw === null ? undefined : jobDescriptionRaw,
  })
  if (!parsedFields.success) {
    return NextResponse.json({ error: "Invalid form fields" }, { status: 400 })
  }
  const targetRole = parsedFields.data.targetRole ?? null
  const jobDescription = parsedFields.data.jobDescription ?? null
  // Opt-out for the second (bullet-polish) AI call. Absent means "on", so an
  // older client — or the extension — keeps the previous behaviour.
  const optimizeBullets = formData.get("optimizeBullets") !== "false"

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: UNSUPPORTED_TYPE_ERROR }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: TOO_LARGE_ERROR }, { status: 400 })
  }

  if (!ALLOWED_EXTENSIONS.test(file.name)) {
    return NextResponse.json({ error: UNSUPPORTED_TYPE_ERROR }, { status: 400 })
  }

  // ── Content checks ───────────────────────────────────────────────────────
  // Both `file.type` and `file.name` come from the client, so the bytes decide.
  const buffer = new Uint8Array(await file.arrayBuffer())
  const kind = sniffUploadKind(buffer)
  const expectedKind = file.type === PDF_TYPE ? "pdf" : "zip"

  if (kind !== expectedKind) {
    return NextResponse.json(
      { error: "File content does not match its type" },
      { status: 400 }
    )
  }

  if (file.type === DOCX_TYPE) {
    // A DOCX is a zip: refuse an archive that is malformed or declares an
    // implausible amount of uncompressed content before mammoth opens it.
    const zip = checkZipSanity(buffer)
    if (!zip.ok) {
      log.warn("Rejected DOCX upload", { reason: zip.reason })
      return NextResponse.json({ error: "Invalid DOCX file" }, { status: 400 })
    }
  }

  // ── Parse ────────────────────────────────────────────────────────────────
  let parsed
  try {
    parsed = await parseResumeFile(buffer, file.type, userId, { optimizeBullets })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    log.error("AI parse failed", { err })
    // Parsing is the first AI touchpoint for a new user, so the missing-key
    // message has to reach the upload dialog instead of a generic failure.
    if (err instanceof AiKeyRequiredError) {
      return NextResponse.json(
        { error: err.message, code: "AI_KEY_REQUIRED" },
        { status: 400 }
      )
    }
    if (err instanceof AiDailyLimitError) {
      return NextResponse.json(
        { error: err.message, code: "AI_DAILY_LIMIT" },
        { status: 429 }
      )
    }
    // The raw message can carry parser/provider/infra detail — it stays in the
    // server log above, never in the response.
    const isConnectionError = errMsg.includes("ECONNREFUSED") || errMsg.includes("fetch failed") || errMsg.includes("connect")
    return NextResponse.json(
      {
        error: isConnectionError
          ? "Could not reach the AI model. If using LM Studio, make sure it is running and the model is loaded."
          : "Failed to parse resume. Please try again.",
      },
      { status: 500 }
    )
  }

  // ── Build sections create input ───────────────────────────────────────────
  // Using Prisma's nested create type inferred from the transaction below
  const sectionDefs: Array<{
    type: string
    title: string
    order: number
    visible: boolean
    items: { create: Array<{ content: object; order: number }> }
  }> = []

  let idx = 0

  // Contact is always first (order 0)
  sectionDefs.push({
    type: "CONTACT",
    title: "Contact",
    order: idx++,
    visible: true,
    items: { create: [{ content: parsed.contact ?? {}, order: 0 }] },
  })

  // Summary
  if (parsed.summary?.text) {
    sectionDefs.push({
      type: "SUMMARY",
      title: "Summary",
      order: idx++,
      visible: true,
      items: { create: [{ content: parsed.summary, order: 0 }] },
    })
  }

  // Experience
  if (parsed.experience?.length) {
    sectionDefs.push({
      type: "EXPERIENCE",
      title: "Experience",
      order: idx++,
      visible: true,
      items: {
        create: parsed.experience.map((exp, i) => ({ content: exp, order: i })),
      },
    })
  }

  // Education
  if (parsed.education?.length) {
    sectionDefs.push({
      type: "EDUCATION",
      title: "Education",
      order: idx++,
      visible: true,
      items: {
        create: parsed.education.map((edu, i) => ({ content: edu, order: i })),
      },
    })
  }

  // Skills
  if (parsed.skills?.length) {
    sectionDefs.push({
      type: "SKILLS",
      title: "Skills",
      order: idx++,
      visible: true,
      items: {
        create: parsed.skills.map((skill, i) => ({ content: skill, order: i })),
      },
    })
  }

  // Projects
  if (parsed.projects?.length) {
    sectionDefs.push({
      type: "PROJECTS",
      title: "Projects",
      order: idx++,
      visible: true,
      items: {
        create: parsed.projects.map((proj, i) => ({ content: proj, order: i })),
      },
    })
  }

  // Certifications
  if (parsed.certifications?.length) {
    sectionDefs.push({
      type: "CERTIFICATIONS",
      title: "Certifications",
      order: idx++,
      visible: true,
      items: {
        create: parsed.certifications.map((cert, i) => ({
          content: cert,
          order: i,
        })),
      },
    })
  }

  // Fallback: if only Contact was extracted, add empty defaults
  const createdTypes = sectionDefs.map((s) => s.type)
  if (
    !createdTypes.includes("SUMMARY") &&
    !createdTypes.includes("EXPERIENCE") &&
    !createdTypes.includes("EDUCATION") &&
    !createdTypes.includes("SKILLS")
  ) {
    sectionDefs.push(
      { type: "SUMMARY", title: "Summary", order: idx++, visible: true, items: { create: [] } },
      { type: "EXPERIENCE", title: "Experience", order: idx++, visible: true, items: { create: [] } },
      { type: "EDUCATION", title: "Education", order: idx++, visible: true, items: { create: [] } },
      { type: "SKILLS", title: "Skills", order: idx++, visible: true, items: { create: [] } }
    )
  }

  // ── Persist resume ───────────────────────────────────────────────────────
  const resume = await prisma.$transaction(async (tx) => {
    const created = await tx.resume.create({
      data: {
        userId,
        title:
          parsed.title || sanitizeUploadTitle(file.name) || "Uploaded Resume",
        targetRole: targetRole || undefined,
        template: "MINIMAL",
      },
      select: { id: true },
    })

    for (const section of sectionDefs) {
      const createdSection = await tx.resumeSection.create({
        data: {
          resumeId: created.id,
          type: section.type as Parameters<typeof tx.resumeSection.create>[0]["data"]["type"],
          title: section.title,
          order: section.order,
          visible: section.visible,
        },
        select: { id: true },
      })

      if (section.items.create.length > 0) {
        await tx.resumeSectionItem.createMany({
          data: section.items.create.map((item) => ({
            sectionId: createdSection.id,
            content: item.content,
            order: item.order,
          })),
        })
      }
    }

    return created
  })

  // ── Auto-trigger ATS analysis if job description was provided ─────────────
  // Set when the analysis is skipped for the scan limit; the upload itself
  // still succeeds.
  let ats: { error: string; code: "RATE_LIMITED" } | undefined
  if (jobDescription?.trim()) {
    try {
      // Same window as the analyze action: max 5 scans per user per 10 minutes,
      // counted against ATSAnalysis rows.
      const recentScans = await prisma.aTSAnalysis.count({
        where: {
          userId,
          createdAt: { gte: new Date(Date.now() - ATS_RATE_LIMIT_WINDOW_MS) },
        },
      })
      if (recentScans >= ATS_RATE_LIMIT_MAX) {
        const err = rateLimited("Too many ATS scans. Please wait a few minutes and try again.")
        ats = { error: err.message, code: "RATE_LIMITED" }
      }

      // Fetch the created resume with sections for ATS analysis
      const fullResume = ats
        ? null
        : await prisma.resume.findUnique({
            where: { id: resume.id },
            include: {
              sections: {
                include: { items: true },
                orderBy: { order: "asc" },
              },
            },
          })

      if (fullResume) {
        const result = await analyzeResumeATS(
          fullResume.sections as unknown as Section[],
          {
            targetRole: targetRole || null,
            jobDescription,
            // Only reached when a job description was supplied.
            mode: "job-match",
            userId,
          }
        )

        // Persist ATS results
        await prisma.$transaction([
          prisma.aTSAnalysis.create({
            data: {
              resumeId: resume.id,
              userId,
              overallScore: result.overallScore,
              scores: result.scores,
              issues: result.issues,
              suggestions: {
                items: result.suggestions,
                missingKeywords: result.missingKeywords,
              },
              jobDescription,
              mode: "JOB_MATCH",
            },
          }),
          prisma.resume.update({
            where: { id: resume.id },
            data: { atsScore: result.overallScore },
          }),
        ])
      }
    } catch (err) {
      // ATS analysis failure is non-critical — resume was already created
      log.error("Auto ATS analysis failed", { err })
    }
  }

  return NextResponse.json(
    ats ? { resumeId: resume.id, ats } : { resumeId: resume.id },
    { status: 201 }
  )
}
