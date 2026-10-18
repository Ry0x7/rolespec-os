"use server"

import { z } from "zod"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import {
  analyzeResumeATS,
  type AnalysisMode,
  type ATSAnalysisResult,
} from "../services/ats-analyze"
import { rateLimited } from "@/shared/lib/errors"
import type { Section } from "../hooks/use-resume-store"
import { analysisModeToDb } from "../lib/ats-score"
import {
  ATS_RATE_LIMIT_WINDOW_MS,
  ATS_RATE_LIMIT_MAX,
  MAX_ATS_JOB_DESCRIPTION_LENGTH,
} from "../constants/ats"
import { logger } from "@/shared/lib/logger"

const log = logger("analyze-ats")

// ── Client payload validation ───────────────────────────────────────────────
// The analysis scores the sections the editor currently holds, not the DB copy,
// so unsaved edits (and freshly applied enhance suggestions) are what gets
// scored. That payload is untrusted, hence the caps below.

const MAX_SECTIONS = 40
const MAX_ITEMS_PER_SECTION = 100
const MAX_ID_LENGTH = 200
const MAX_SECTION_TYPE_LENGTH = 60
const MAX_TITLE_LENGTH = 300
/** The prompt only keeps the first 6000 serialized characters anyway. */
const MAX_SECTIONS_PAYLOAD_CHARS = 200_000

const jsonObjectSchema = z.record(z.string(), z.unknown())

const sectionItemSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
  sectionId: z.string().max(MAX_ID_LENGTH),
  content: jsonObjectSchema,
  metadata: jsonObjectSchema.nullable().optional(),
  order: z.number(),
})

const sectionSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
  resumeId: z.string().max(MAX_ID_LENGTH),
  type: z.string().max(MAX_SECTION_TYPE_LENGTH),
  title: z.string().max(MAX_TITLE_LENGTH),
  order: z.number(),
  visible: z.boolean(),
  items: z.array(sectionItemSchema).max(MAX_ITEMS_PER_SECTION),
})

const sectionsSchema = z.array(sectionSchema).max(MAX_SECTIONS)

/** The job description is caller-supplied too, so it gets the same treatment. */
const jobDescriptionSchema = z.string().max(MAX_ATS_JOB_DESCRIPTION_LENGTH).optional()

const modeSchema = z.enum(["quality", "job-match"]).optional()

export async function analyzeATS(
  resumeId: string,
  currentSections: Section[],
  jobDescription?: string,
  mode?: AnalysisMode
): Promise<{
  success?: boolean
  error?: string
  code?: "RATE_LIMITED" | "MISSING_JOB_DESCRIPTION" | "VALIDATION"
  data?: ATSAnalysisResult
}> {
  const session = await auth()
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  // ── Validate the client-supplied sections ─────────────────────────────────
  if (JSON.stringify(currentSections ?? null).length > MAX_SECTIONS_PAYLOAD_CHARS) {
    return { error: "Resume content is too large to analyze.", code: "VALIDATION" }
  }
  const parsedSections = sectionsSchema.safeParse(currentSections)
  if (!parsedSections.success) {
    return { error: "Invalid resume content.", code: "VALIDATION" }
  }
  const parsedJobDescription = jobDescriptionSchema.safeParse(jobDescription)
  if (!parsedJobDescription.success) {
    return { error: "Job description is too long.", code: "VALIDATION" }
  }
  const parsedMode = modeSchema.safeParse(mode)
  if (!parsedMode.success) {
    return { error: "Invalid analysis mode.", code: "VALIDATION" }
  }
  const requestedMode = parsedMode.data

  // ── Fetch resume with sections and items ──────────────────────────────────
  // Archived (soft-deleted) resumes are treated as gone, same as a foreign id.
  const resume = await prisma.resume.findUnique({
    where: { id: resumeId, userId: session.user.id, status: { not: "ARCHIVED" } },
    include: {
      sections: {
        include: { items: true },
        orderBy: { order: "asc" },
      },
    },
  })

  if (!resume) {
    return { error: "Resume not found" }
  }

  // ── Which question are we answering? ──────────────────────────────────────
  // A quality run is job-independent, so it never touches the job description
  // — not the caller's, not the one retained on an earlier analysis.
  const retainedJobDescription =
    requestedMode === "quality"
      ? undefined
      : parsedJobDescription.data ?? (
          await prisma.aTSAnalysis.findFirst({
            where: { resumeId, userId: session.user.id, jobDescription: { not: null } },
            orderBy: { createdAt: "desc" },
            select: { jobDescription: true },
          })
        )?.jobDescription

  const hasJobDescription = !!retainedJobDescription?.trim()

  // Only an explicit job-match request can fail for want of a job description:
  // a resume with no job target (a Master Resume) falls through to a quality
  // analysis instead of being refused.
  if (requestedMode === "job-match" && !hasJobDescription) {
    return {
      error: "Add a job description before analyzing.",
      code: "MISSING_JOB_DESCRIPTION",
    }
  }

  const analysisMode: AnalysisMode = hasJobDescription ? "job-match" : "quality"

  // ── Rate limit: max 5 scans per user per 10 minutes ───────────────────────
  // The sliding window is measured against ATSAnalysis rows, which carry
  // createdAt and are indexed on [userId, createdAt].
  const recentScans = await prisma.aTSAnalysis.count({
    where: {
      userId: session.user.id,
      createdAt: { gte: new Date(Date.now() - ATS_RATE_LIMIT_WINDOW_MS) },
    },
  })
  if (recentScans >= ATS_RATE_LIMIT_MAX) {
    const err = rateLimited("Too many ATS scans. Please wait a few minutes and try again.")
    return { error: err.message, code: "RATE_LIMITED" }
  }

  // ── Run ATS analysis ──────────────────────────────────────────────────────
  let result: ATSAnalysisResult
  try {
    // Scores the editor's current sections, so an analysis run right after an
    // edit or an applied enhance suggestion reflects that text — the DB copy
    // can lag behind by a full autosave debounce.
    result = await analyzeResumeATS(parsedSections.data as unknown as Section[], {
      targetRole: resume.targetRole,
      jobDescription: retainedJobDescription,
      mode: analysisMode,
      userId: session.user.id,
    })
  } catch (err) {
    log.error("AI analysis failed", { err })
    // The key and daily-limit messages are actionable and safe to show; anything
    // else could carry provider/infra detail, so it stays in the log above.
    if (err instanceof AiKeyRequiredError || err instanceof AiDailyLimitError) {
      return { error: err.message }
    }
    return { error: "ATS analysis failed. Please try again." }
  }

  // ── Persist results in transaction ────────────────────────────────────────
  try {
    await prisma.$transaction([
      prisma.aTSAnalysis.create({
        data: {
          resumeId,
          userId: session.user.id,
          overallScore: result.overallScore,
          scores: result.scores,
          issues: result.issues,
          suggestions: {
            items: result.suggestions,
            missingKeywords: result.missingKeywords,
          },
          jobDescription: retainedJobDescription ?? null,
          // The same mode the analysis was run with — persisted so readers
          // never have to infer it from the job description.
          mode: analysisModeToDb(analysisMode),
        },
      }),
      prisma.resume.update({
        where: { id: resumeId },
        data: { atsScore: result.overallScore },
      }),
    ])
  } catch (err) {
    log.error("persisting analysis failed", { err })
    return { error: "ATS analysis failed. Please try again." }
  }

  return { success: true, data: result }
}
