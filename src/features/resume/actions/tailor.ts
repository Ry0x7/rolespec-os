"use server"

import { auth } from "@/features/auth/config"
import { findCareerProfileId } from "@/features/career-profile/services/career-profile.service"
import { prisma } from "@/shared/lib/prisma"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import {
  findIntroducedKeywords,
  groundKeywords,
} from "@/shared/lib/evidence-grounding"
import { rateLimited } from "@/shared/lib/errors"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"
import { logger } from "@/shared/lib/logger"
import { extractJobTerms } from "../lib/job-terms"
import { serializeSections } from "../lib/serialize-sections"
import { resumeEditorHref } from "../lib/resume-editor-href"
import type { Section } from "../hooks/use-resume-store"
import {
  generateJobTailorSuggestions,
  MAX_TAILOR_BULLET_LENGTH,
  MAX_TAILOR_SKILLS_LENGTH,
  MAX_TAILOR_SUMMARY_LENGTH,
  type JobTailorSuggestions,
  type TailorTarget,
} from "../services/tailor-resume"
import { createJobTailoredResumeSchema } from "../schemas/resume.schema"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

const log = logger("resume-tailor")

const NO_PROFILE_ERROR =
  "Your career profile is not ready yet. Reload the page and try again."

/** Sliding window for the per-user tailoring rate limit — one AI call per run. */
const TAILOR_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }

/** Leading list glyphs the model sometimes prefixes bullets with. */
const LEADING_GLYPHS = /^[\s\-–—•*·▪◦]+/

/** Target ids are positional against the copied sections: s0::i2 / s0::i2::b1. */
const TARGET_ID = /^s(\d+)::i(\d+)(?:::b(\d+))?$/

const MAX_SUGGESTED_LENGTH = {
  summary: MAX_TAILOR_SUMMARY_LENGTH,
  bullet: MAX_TAILOR_BULLET_LENGTH,
  skills: MAX_TAILOR_SKILLS_LENGTH,
} as const

interface SourceItem {
  content: Record<string, unknown>
  metadata: unknown
  order: number
}

interface SourceSection {
  type: string
  title: string
  order: number
  visible: boolean
  items: SourceItem[]
}

/**
 * The tailorable text of the copied sections, addressed positionally. The ids
 * are indices into the same arrays `applied` below mutates, so a resolved id
 * can never land on the wrong text.
 */
function buildTargets(sections: SourceSection[]): TailorTarget[] {
  const targets: TailorTarget[] = []

  sections.forEach((section, si) => {
    section.items.forEach((item, ii) => {
      const content = item.content
      if (section.type === "SUMMARY") {
        const text = typeof content.text === "string" ? content.text.trim() : ""
        if (text) {
          targets.push({ targetId: `s${si}::i${ii}`, field: "summary", text, label: "Summary" })
        }
        return
      }
      if (section.type === "SKILLS") {
        const skills = Array.isArray(content.skills)
          ? (content.skills as unknown[]).filter((s): s is string => typeof s === "string")
          : []
        const text = skills.join(", ").trim()
        if (text) {
          const category = typeof content.category === "string" ? content.category : undefined
          targets.push({
            targetId: `s${si}::i${ii}`,
            field: "skills",
            text,
            label: category ? `Skills — ${category}` : "Skills",
          })
        }
        return
      }
      if (section.type === "EXPERIENCE" || section.type === "PROJECTS") {
        const bullets = Array.isArray(content.bullets)
          ? (content.bullets as unknown[]).filter((b): b is string => typeof b === "string")
          : []
        const label =
          section.type === "EXPERIENCE"
            ? [content.role, content.company].filter((v) => typeof v === "string" && v).join(" at ")
            : typeof content.name === "string"
              ? content.name
              : ""
        // An experience item is addressable as a whole so a role that has
        // nothing to do with this posting can be dropped outright. It carries
        // no length rule: `remove-item` is the only action allowed on it.
        if (section.type === "EXPERIENCE" && label) {
          targets.push({
            targetId: `s${si}::i${ii}`,
            field: "experience",
            text: label,
            label: `${section.title} — whole item: ${label}`,
          })
        }
        bullets.forEach((bullet, bi) => {
          const text = bullet.trim()
          if (!text) return
          targets.push({
            targetId: `s${si}::i${ii}::b${bi}`,
            field: "bullet",
            text,
            label: `${section.title}${label ? ` — ${label}` : ""}`,
          })
        })
      }
    })
  })

  return targets
}

/** Comma-list entries, trimmed and lowercased, as a multiset key. */
function skillEntries(list: string): string[] {
  return list
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .sort()
}

/**
 * Creates a job-tailored copy of an owned master or role-family resume for one
 * tracked application. The copy is assembled deterministically first; the AI
 * pass may only select (drop bullets), reorder and rephrase that existing
 * content, with the posting passed strictly as untrusted context and every
 * rewrite re-checked against the source text before it is kept. Nothing is
 * written unless the whole pipeline succeeds, and the source is never touched.
 */
export async function createJobTailoredResume(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const parsed = createJobTailoredResumeSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() }
  }

  const profileId = await findCareerProfileId(session.user.id)
  if (!profileId) return { error: NO_PROFILE_ERROR }

  // Foreign and missing applications are one indistinguishable boundary so
  // callers cannot probe another user's tracker.
  const application = await prisma.jobApplication.findFirst({
    where: { id: parsed.data.jobApplicationId, userId: session.user.id },
    select: {
      id: true,
      job: { select: { title: true, companyName: true, description: true } },
      // The current choice rides along so the carry-over below can tell an
      // explicit earlier tailored pick from a default master/role-family one.
      resumeId: true,
      submittedResume: { select: { variant: true, jobApplicationId: true } },
    },
  })
  if (!application) return { error: "That job application does not exist." }

  // The posting fields live on the `job` relation now; the shape below is what
  // the rest of this action already consumed.
  const job = {
    id: application.id,
    jobTitle: application.job.title,
    companyName: application.job.companyName,
    jobDescription: application.job.description,
  }

  // Ownership, source kind, and soft-delete state are one indistinguishable
  // not-found boundary so callers cannot probe another user's resumes.
  const source = await prisma.resume.findFirst({
    where: {
      id: parsed.data.sourceResumeId,
      userId: session.user.id,
      variant: { in: ["MASTER", "ROLE_FAMILY"] },
      status: { not: "ARCHIVED" },
    },
    select: {
      id: true,
      targetRole: true,
      template: true,
      roleFamilyId: true,
      sections: {
        select: {
          type: true,
          title: true,
          order: true,
          visible: true,
          items: {
            select: { content: true, metadata: true, order: true },
            orderBy: { order: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  })
  if (!source) return { error: "Resume not found" }

  // Checked after validation and ownership so a request that was going to fail
  // anyway never spends an attempt.
  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.AI_RESUME_TAILOR,
    session.user.id,
    TAILOR_RATE_LIMIT
  )
  if (!allowed) {
    const err = rateLimited(
      "Too many tailoring runs. Please wait a few minutes and try again."
    )
    return { error: err.message }
  }

  // Deep-copied working set: suggestions are applied here, never to the source.
  const sections = source.sections.map((section) => ({
    type: section.type,
    title: section.title,
    order: section.order,
    visible: section.visible,
    items: section.items.map((item) => ({
      content: structuredClone(item.content) as Record<string, unknown>,
      metadata: item.metadata,
      order: item.order,
    })),
  }))

  const targets = buildTargets(sections)

  if (targets.length > 0) {
    // ── Evidence grounding ──────────────────────────────────────────────────
    // The posting's own terms are classified against the candidate's text; a
    // term the resume cannot back is barred from every rewrite, first in the
    // prompt and then by the deterministic post-check below. Job-description
    // text is never evidence of the candidate's qualifications.
    const evidenceText = [
      serializeSections(sections as unknown as Section[]),
      ...targets.map((target) => target.text),
    ].join("\n")
    const terms = extractJobTerms(
      [job.jobTitle, job.jobDescription ?? ""].join("\n")
    )
    const grounded = groundKeywords(terms, evidenceText)
    const barredKeywords = [...grounded.unsupported, ...grounded.ambiguous]

    // No summary target means the source resume has no summary text at all, so
    // the model is asked to write one from the candidate's own targets.
    const hasSummaryTarget = targets.some((target) => target.field === "summary")

    let raw: JobTailorSuggestions
    try {
      raw = await generateJobTailorSuggestions({
        userId: session.user.id,
        targets,
        jobTitle: job.jobTitle,
        companyName: job.companyName,
        jobDescription: job.jobDescription ?? undefined,
        targetRole: source.targetRole ?? undefined,
        groundedKeywords: grounded,
        needsSummary: !hasSummaryTarget,
      })
    } catch (err) {
      log.error("AI tailoring generation failed", { err })
      return {
        // The key and daily-limit messages are actionable and safe to show;
        // anything else could carry provider detail, so it stays in the log.
        error:
          err instanceof AiKeyRequiredError || err instanceof AiDailyLimitError
            ? err.message
            : "AI tailoring failed. Please try again.",
      }
    }

    // ── Apply: resolve ids, cap lengths, enforce grounding, then mutate ─────
    const targetsById = new Map(targets.map((target) => [target.targetId, target]))
    const seen = new Set<string>()
    const removals: string[] = []
    /** `si::ii` keys of whole experience items the model wants dropped. */
    const itemExclusions: string[] = []

    for (const candidate of raw.suggestions) {
      const target = targetsById.get(candidate.targetId)
      if (!target) continue
      if (seen.has(candidate.targetId)) continue
      const match = TARGET_ID.exec(candidate.targetId)
      if (!match) continue
      const [, si, ii, bi] = match
      const item = sections[Number(si)]?.items[Number(ii)]
      if (!item) continue

      // ── Removals: bullets only ────────────────────────────────────────────
      if (candidate.action === "remove") {
        if (target.field !== "bullet" || bi === undefined) continue
        seen.add(candidate.targetId)
        removals.push(candidate.targetId)
        continue
      }

      // ── Item exclusions: whole experience items only ──────────────────────
      // Recorded here, applied last, and never allowed to empty the section.
      if (candidate.action === "remove-item") {
        if (target.field !== "experience" || bi !== undefined) continue
        seen.add(candidate.targetId)
        itemExclusions.push(`${si}::${ii}`)
        continue
      }

      // An experience-item target exists only so it can be excluded; a rewrite
      // aimed at one has no field to land in.
      if (target.field === "experience") continue

      let suggested = (candidate.suggested ?? "").trim()
      if (target.field === "bullet") suggested = suggested.replace(LEADING_GLYPHS, "")
      suggested = suggested.slice(0, MAX_SUGGESTED_LENGTH[target.field]).trim()
      if (!suggested) continue
      if (suggested === target.text) continue

      // ── Enforce the grounding rule, do not merely request it ──────────────
      // Skills lists are reorder-only, so anything but a permutation of the
      // original entries is discarded outright. Prose that smuggled in a
      // barred posting term is likewise dropped whole — the original text
      // stays in the copy instead.
      if (target.field === "skills") {
        const original = skillEntries(target.text)
        const proposed = skillEntries(suggested)
        if (
          original.length !== proposed.length ||
          original.some((entry, index) => entry !== proposed[index])
        ) {
          log.warn("Discarded a tailoring suggestion that altered the skill set", {
            targetId: candidate.targetId,
          })
          continue
        }
      } else if (barredKeywords.length > 0) {
        const introduced = findIntroducedKeywords(target.text, suggested, barredKeywords)
        if (introduced.length > 0) {
          log.warn("Discarded a tailoring suggestion that claimed ungrounded terms", {
            targetId: candidate.targetId,
            field: target.field,
            introduced,
          })
          continue
        }
      }

      seen.add(candidate.targetId)
      if (target.field === "summary") {
        item.content.text = suggested
      } else if (target.field === "skills") {
        item.content.skills = suggested
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      } else if (bi !== undefined && Array.isArray(item.content.bullets)) {
        ;(item.content.bullets as unknown[])[Number(bi)] = suggested
      }
    }

    // Removals last, in one pass per item, so rewrite indices stay valid while
    // suggestions are applied above.
    if (removals.length > 0) {
      const removedByItem = new Map<string, Set<number>>()
      for (const targetId of removals) {
        const match = TARGET_ID.exec(targetId)
        if (!match || match[3] === undefined) continue
        const key = `${match[1]}::${match[2]}`
        const set = removedByItem.get(key) ?? new Set<number>()
        set.add(Number(match[3]))
        removedByItem.set(key, set)
      }
      for (const [key, removed] of removedByItem) {
        const [si, ii] = key.split("::").map(Number)
        const item = sections[si]?.items[ii]
        if (!item || !Array.isArray(item.content.bullets)) continue
        item.content.bullets = (item.content.bullets as unknown[]).filter(
          (_, index) => !removed.has(index)
        )
      }
    }

    // Whole-item exclusions after the bullet passes, so every index above was
    // still valid while it was used. A section is never emptied: if the model
    // asked for every item, the first (most recent) one is kept regardless.
    if (itemExclusions.length > 0) {
      const excludedBySection = new Map<number, Set<number>>()
      for (const key of itemExclusions) {
        const [si, ii] = key.split("::").map(Number)
        const set = excludedBySection.get(si) ?? new Set<number>()
        set.add(ii)
        excludedBySection.set(si, set)
      }
      for (const [si, excluded] of excludedBySection) {
        const section = sections[si]
        if (!section) continue
        if (excluded.size >= section.items.length) {
          const keep = Math.min(...excluded)
          excluded.delete(keep)
          log.warn("Refused to exclude every experience item from a tailored copy", {
            sectionIndex: si,
            keptItemIndex: keep,
          })
        }
        if (excluded.size === 0) continue
        section.items = section.items.filter((_, index) => !excluded.has(index))
        // Item order stays contiguous, the way the rest of the app writes it.
        section.items.forEach((item, index) => {
          item.order = index
        })
      }
    }

    // ── Generated summary ───────────────────────────────────────────────────
    // Only when the source had none. It is held to the same barred-term check
    // as every rewrite, against an empty "original": the summary is new text,
    // so any barred posting term in it is an introduced claim. A summary that
    // fails is dropped — no summary beats an ungrounded one.
    if (!hasSummaryTarget && raw.generatedSummary) {
      const summary = raw.generatedSummary
        .trim()
        .slice(0, MAX_TAILOR_SUMMARY_LENGTH)
        .trim()
      const introduced =
        summary && barredKeywords.length > 0
          ? findIntroducedKeywords("", summary, barredKeywords)
          : []
      if (summary && introduced.length > 0) {
        log.warn("Discarded a generated summary that claimed ungrounded terms", {
          introduced,
        })
      } else if (summary) {
        const existing = sections.find((section) => section.type === "SUMMARY")
        if (existing) {
          // The section was there but empty — that is why it had no target.
          const item = existing.items[0]
          if (item) item.content.text = summary
          else existing.items.push({ content: { text: summary }, metadata: null, order: 0 })
        } else {
          // Summary sits directly under Contact, as `assembleMasterResume`
          // orders it; section order is renumbered so it stays contiguous.
          const contactIndex = sections.findIndex((section) => section.type === "CONTACT")
          sections.splice(contactIndex + 1, 0, {
            type: "SUMMARY",
            title: "Summary",
            order: 0,
            visible: true,
            items: [{ content: { text: summary }, metadata: null, order: 0 }],
          })
          sections.forEach((section, index) => {
            section.order = index
          })
        }
      }
    }
  }

  // One nested create makes the resume, sections, and items atomic. Only the
  // tailored section payload (existing facts, selected/reordered/rephrased)
  // crosses this boundary; the company target comes from the user's own
  // tracker entry, never from generated text.
  const resume = await prisma.resume.create({
    data: {
      userId: session.user.id,
      careerProfileId: profileId,
      roleFamilyId: source.roleFamilyId,
      jobApplicationId: job.id,
      // Lineage: the owner-verified master or role-family resume tailored here.
      sourceResumeId: source.id,
      variant: "JOB_TAILORED",
      title: parsed.data.title,
      targetRole: source.targetRole,
      targetCompany: job.companyName,
      template: source.template,
      sections: {
        create: sections.map((section) => ({
          type: section.type,
          title: section.title,
          order: section.order,
          visible: section.visible,
          items: {
            create: section.items.map((item) => ({
              content: item.content as object,
              metadata: item.metadata === null ? undefined : item.metadata,
              order: item.order,
            })),
          },
        })),
      },
    },
  })

  // Tailoring a resume for a job is the user saying "this is the one this job
  // gets", so it becomes the chosen resume — otherwise the new resume sits
  // unused until the picker is touched. The one exception is an explicit
  // earlier choice of a resume already tailored to THIS application: that is a
  // deliberate pick between tailored runs and outranks the newest one.
  const keepsExistingChoice =
    application.submittedResume?.variant === "JOB_TAILORED" &&
    application.submittedResume.jobApplicationId === application.id

  if (!keepsExistingChoice) {
    try {
      await prisma.jobApplication.update({
        // Scoped to the session user like every other write on this row; the
        // application was already read back under the same user above.
        where: { id: application.id, userId: session.user.id },
        data: { resumeId: resume.id },
      })
    } catch (error) {
      // The resume itself is already written — losing the chosen-resume
      // carry-over must not lose the tailoring run with it.
      log.warn("Could not set the tailored resume as the chosen resume", {
        jobApplicationId: application.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  revalidatePath("/resumes")
  revalidatePath("/jobs")
  revalidatePath(`/jobs/${application.id}`)
  // Carry the job into the editor so Job Target, ATS and Enhance open aimed at
  // it, instead of the user re-picking the job they just tailored for.
  redirect(resumeEditorHref(resume.id, application.id))
}
