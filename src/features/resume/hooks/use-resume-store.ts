"use client"

import { create } from "zustand"
import type { SectionType } from "@/generated/prisma/enums"
import type { KeywordEvidence } from "@/shared/lib/evidence-grounding"
import { skillsToText } from "../lib/enhance-targets"
import {
  clearEnhanceState,
  loadEnhanceState,
  saveEnhanceState,
  type PersistedEnhanceState,
} from "../lib/enhance-persistence"
import {
  DEFAULT_CUSTOMIZATION,
  loadCustomization,
  saveCustomization,
  type ResumeCustomization,
} from "../types/customization"

export interface SectionItem {
  id: string
  sectionId: string
  content: Record<string, unknown>
  metadata?: Record<string, unknown> | null
  order: number
}

export interface Section {
  id: string
  resumeId: string
  type: SectionType
  title: string
  order: number
  visible: boolean
  items: SectionItem[]
}

export interface ATSScores {
  formatting: number
  /**
   * `null` for a quality analysis: with no job description there is nothing to
   * match keywords against, so the analyzer returns no keyword sub-score.
   */
  keywords: number | null
  impact: number
  completeness: number
  readability: number
}

export interface ATSIssue {
  severity: "critical" | "warning" | "info"
  category: string
  message: string
  section?: string
  suggestion?: string
}

export interface ATSSuggestion {
  category: string
  title: string
  description: string
  priority: "high" | "medium" | "low"
}

/**
 * Which question the analysis answered — `job-match` against a specific job
 * description, or job-independent `quality`. Mirrors the service's
 * `AnalysisMode`. Optional because rows written before quality mode existed
 * carry no marker; absent reads as job-match, which is what they were.
 */
export type ATSAnalysisMode = "quality" | "job-match"

export interface ATSResults {
  overallScore: number
  scores: ATSScores
  issues: ATSIssue[]
  suggestions: ATSSuggestion[]
  missingKeywords?: string[]
  mode?: ATSAnalysisMode
}

/** Which kind of text a global enhance suggestion rewrites. */
export type EnhanceField = "summary" | "bullet" | "skills"

export interface EnhanceSuggestion {
  id: string
  sectionId: string
  itemId: string
  field: EnhanceField
  /** Rewrite the text, or drop the bullet entirely. Removals are bullets only. */
  action: "rewrite" | "remove"
  /** Only set for `field: "bullet"` — the index inside `content.bullets`. */
  bulletIndex?: number
  original: string
  /** The replacement text — set for a rewrite, absent for a removal. */
  suggested?: string
  reason: string
  status: "pending" | "applied"
  /**
   * Hidden from the list by the user without touching the resume. Only a
   * pending suggestion can be dismissed; a new suggestion set clears it.
   */
  dismissed?: boolean
}

/**
 * Outcome of apply/revert. The store stays pure — the panel turns `reason`
 * into a toast.
 */
export type EnhanceMutationResult =
  | { ok: true }
  /** The suggestion, its section or its item is gone. */
  | { ok: false; reason: "missing" }
  /** The text the suggestion targets has since changed. */
  | { ok: false; reason: "stale" }

export interface ResumeData {
  id: string
  title: string
  targetRole: string | null
  targetCompany: string | null
  template: string
  sections: Section[]
  atsScore: number | null
  jobDescription: string | null
  latestAnalysis: ATSResults | null
  /**
   * Server-computed: the resume was saved after `latestAnalysis` ran, so the
   * editor opens with the analysis already marked outdated. Optional: only the
   * editor page computes it.
   */
  latestAnalysisOutdated?: boolean
  /**
   * Which kind of resume this is, and its role family's name, so the editor
   * header can say so. Optional: only the editor page loads them.
   */
  variant?: "MASTER" | "ROLE_FAMILY" | "JOB_TAILORED"
  roleFamilyName?: string | null
  /**
   * The resume this one was derived from (Role Family or Job-Tailored). Null
   * for masters and for rows created before lineage was recorded. An archived
   * source is named but not linked.
   */
  sourceResume?: ResumeSource | null
  /**
   * "profile" when a MASTER resume records the Career Profile it was built
   * from. Null otherwise, including every pre-lineage master: origin is never
   * inferred.
   */
  origin?: ResumeOrigin | null
}

export type ResumeOrigin = "profile"

export interface ResumeSource {
  id: string
  title: string
  status: "DRAFT" | "ACTIVE" | "ARCHIVED"
}

export type SaveStatus = "idle" | "saving" | "saved" | "error"
export type GenerateStatus = "idle" | "generating" | "success" | "error"

/** Which contextual drawer is open. One field, not three booleans, so opening
 * one closes another by construction — there is only ever one true value. */
export type InspectorId = "job" | "ats" | "enhance" | "preview"

export interface TemplateExportUrls {
  pdfUrl: string
}

export interface LastExport {
  templateUrls: Record<string, TemplateExportUrls>
}

interface ResumeStore {
  resume: ResumeData | null
  activeSection: string | null
  isDirty: boolean
  saveStatus: SaveStatus
  generateStatus: GenerateStatus
  lastExport: LastExport | null
  /**
   * The files behind `lastExport` were generated before the current content, so
   * they no longer match the editor. The URLs stay valid and downloadable — we
   * only label them, never withhold them.
   */
  exportStale: boolean
  /** When the last successful save landed. Drives the header's "Saved HH:MM". */
  lastSavedAt: Date | null
  atsResults: ATSResults | null
  /**
   * True once the resume changed after `atsResults` was computed. Only
   * meaningful (and only surfaced) when `atsResults` is non-null, so it is
   * safe to set unconditionally alongside `exportStale` at every mutation
   * site rather than checking for an existing analysis first.
   */
  atsStale: boolean
  /**
   * The overall score of the analysis the current `atsResults` replaced, when
   * both answered the same question (same mode). Read by the ATS and Enhance
   * drawers to narrate "was M, +Δ" after a re-analysis. Null when there is no
   * comparable earlier run, or after a fresh Enhance run.
   */
  atsPreviousScore: number | null
  isAnalyzing: boolean
  atsError: string | null
  jobDescription: string
  missingKeywords: string[]
  enhanceSuggestions: EnhanceSuggestion[] | null
  /**
   * Job requirements the last enhance run refused to claim, with the reason.
   * Only the user can resolve these — by adding the real evidence to the
   * resume, or by leaving the gap alone.
   */
  enhanceGrounding: KeywordEvidence[]
  isEnhancing: boolean
  enhanceError: string | null
  /**
   * The section the latest Enhance run was limited to ("Fix with Enhance" on
   * an ATS issue), or null for a whole-resume run.
   */
  enhanceFocus: { sectionId: string } | null
  /**
   * The single open contextual drawer (Job Target / ATS / Enhance), or none.
   * Lives here rather than as local state because the trigger (toolbar) and
   * the panel (drawer) are different components, and a later slice opens the
   * ATS inspector from `use-ats-trigger.ts` when an analysis lands.
   */
  openInspector: InspectorId | null

  setResume: (resume: ResumeData) => void
  setActiveSection: (sectionId: string | null) => void
  updateSectionItem: (sectionId: string, itemId: string, content: Record<string, unknown>) => void
  addSectionItem: (sectionId: string, content: Record<string, unknown>) => void
  removeSectionItem: (sectionId: string, itemId: string) => void
  addSection: (section: Section) => void
  removeSection: (sectionId: string) => void
  reorderSection: (sectionId: string, direction: "up" | "down") => void
  reorderSections: (orderedSectionIds: string[]) => void
  reorderSectionItems: (sectionId: string, orderedItemIds: string[]) => void
  updateTemplate: (template: string) => void
  setSaveStatus: (status: SaveStatus) => void
  markClean: () => void
  setGenerateStatus: (status: GenerateStatus) => void
  setLastExport: (lastExport: LastExport | null) => void
  /**
   * Seeds staleness from the server on mount — the flag itself is client state,
   * so a reload would otherwise show freshly-hydrated stale files as current.
   */
  setExportStale: (exportStale: boolean) => void
  /**
   * `stale` is for a run whose content changed while it was in flight: the
   * result still lands, labelled as no longer matching the editor.
   */
  setAtsResults: (results: ATSResults | null, stale?: boolean) => void
  clearAtsPreviousScore: () => void
  setIsAnalyzing: (analyzing: boolean) => void
  setAtsError: (error: string | null) => void
  setJobDescription: (jd: string) => void
  setMissingKeywords: (keywords: string[]) => void
  setEnhanceSuggestions: (suggestions: EnhanceSuggestion[] | null) => void
  setEnhanceGrounding: (grounding: KeywordEvidence[]) => void
  setIsEnhancing: (enhancing: boolean) => void
  setEnhanceError: (error: string | null) => void
  setEnhanceFocus: (focus: { sectionId: string } | null) => void
  setOpenInspector: (inspector: InspectorId | null) => void
  applyEnhanceSuggestion: (id: string) => EnhanceMutationResult
  revertEnhanceSuggestion: (id: string) => EnhanceMutationResult
  /** Hides a pending suggestion. Never touches resume content. */
  dismissEnhanceSuggestion: (id: string) => void
  /** Brings a dismissed suggestion back into the list. */
  undismissEnhanceSuggestion: (id: string) => void
  clearEnhanceSuggestions: () => void
  clearEnhanceError: () => void
  reconcileTempIds: (idMap: Record<string, string>) => void
  groupAdditional: boolean
  groupAdditionalTitle: string
  setGroupAdditional: (v: boolean) => void
  setGroupAdditionalTitle: (title: string) => void

  /** Presentation settings; persisted per resume in localStorage, never the DB. */
  customization: ResumeCustomization
  setCustomization: (partial: Partial<ResumeCustomization>) => void
  resetCustomization: () => void

  /**
   * Swaps in the AI-optimized sections a successful Generate already
   * persisted, so the open editor and its preview show the content that was
   * actually exported. Skipped when the editor holds unsaved edits: Generate
   * ran against the last-saved content, so applying over a dirty store would
   * silently discard whatever the user typed while it ran.
   */
  applyGeneratedSections: (sections: Section[]) => void
}

/**
 * Live text as Enhance targets trim it, but deliberately not capped: text
 * longer than the target cap must never equal its truncated `original`, or
 * Apply would replace the whole text on the strength of a prefix match.
 */
function trimmedText(text: unknown): string {
  return typeof text === "string" ? text.trim() : ""
}

/**
 * Locates the bullet a suggestion points at. `bulletIndex` is only a hint —
 * deleting or dragging bullets while suggestions are open shifts it — so the
 * slot has to still hold `expected` before we overwrite it. Falls back to a
 * search, then gives up rather than clobbering the wrong bullet. Both sides are
 * compared trimmed, so a bullet with stray padding still matches the `original`
 * its target was made from.
 */
function findBulletIndex(bullets: unknown[], hint: number, expected: string): number {
  const want = trimmedText(expected)
  const holds = (bullet: unknown) => trimmedText(bullet) === want
  if (hint >= 0 && hint < bullets.length && holds(bullets[hint])) return hint
  return bullets.findIndex(holds)
}

/**
 * Comma-separated list → trimmed, case-insensitively de-duplicated skills.
 * Used both to write a skills rewrite back and to canonicalise either side of
 * the staleness comparison, so re-rendering a list never reads as a change.
 */
function parseSkillsText(text: string): string[] {
  const skills: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(",")) {
    const skill = raw.trim()
    if (!skill) continue
    const key = skill.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    skills.push(skill)
  }
  return skills
}

/**
 * Writes `text` into the slot a suggestion points at, replacing `expected`.
 * Returns null when the summary, bullet or skills list holding `expected` no
 * longer exists so callers can report a stale suggestion instead of overwriting
 * unrelated text. Revert passes `checkSummary: false`: putting the original
 * summary back is allowed to overwrite a later hand edit.
 */
function contentWithEnhancedText(
  item: SectionItem,
  suggestion: EnhanceSuggestion,
  expected: string,
  text: string,
  checkSummary = true
): Record<string, unknown> | null {
  if (suggestion.field === "summary") {
    const current = trimmedText((item.content as { text?: unknown }).text)
    if (checkSummary && current !== trimmedText(expected)) return null
    return { ...item.content, text }
  }
  if (suggestion.field === "skills") {
    // A skills target's "current text" is the category's list joined with ", ".
    const current = parseSkillsText(skillsToText((item.content as { skills?: unknown }).skills))
    if (current.join(", ") !== parseSkillsText(expected).join(", ")) return null
    const skills = parseSkillsText(text)
    if (skills.length === 0) return null
    return { ...item.content, skills }
  }
  const bullets = (item.content as { bullets?: unknown }).bullets
  if (!Array.isArray(bullets)) return null
  const index = findBulletIndex(bullets, suggestion.bulletIndex ?? -1, expected)
  if (index === -1) return null
  const next = [...(bullets as unknown[])]
  next[index] = text
  return { ...item.content, bullets: next }
}

/**
 * Drops the bullet a removal suggestion points at. Same staleness contract as
 * `contentWithEnhancedText`: null when the slot no longer holds `expected`, so
 * an edited bullet is reported stale instead of the wrong one being deleted.
 */
function contentWithBulletRemoved(
  item: SectionItem,
  suggestion: EnhanceSuggestion,
  expected: string
): Record<string, unknown> | null {
  // Removals are bullets only — skills stay append-only, summaries are never dropped.
  if (suggestion.field !== "bullet") return null
  const bullets = (item.content as { bullets?: unknown }).bullets
  if (!Array.isArray(bullets)) return null
  const index = findBulletIndex(bullets, suggestion.bulletIndex ?? -1, expected)
  if (index === -1) return null
  const next = [...(bullets as unknown[])]
  next.splice(index, 1)
  return { ...item.content, bullets: next }
}

/**
 * Puts a removed bullet back. Undoing a removal cannot reuse the symmetric
 * swap — the text is gone, so there is nothing to match on. The original index
 * is only a hint and gets clamped into the list's current bounds.
 */
function contentWithBulletReinserted(
  item: SectionItem,
  suggestion: EnhanceSuggestion,
  text: string
): Record<string, unknown> | null {
  if (suggestion.field !== "bullet") return null
  const bullets = (item.content as { bullets?: unknown }).bullets
  if (!Array.isArray(bullets)) return null
  const next = [...(bullets as unknown[])]
  const hint = suggestion.bulletIndex ?? next.length
  const index = Math.min(Math.max(hint, 0), next.length)
  next.splice(index, 0, text)
  return { ...item.content, bullets: next }
}

/**
 * The Enhance state persisted for this resume, minus rows whose section or item
 * no longer exists (deleted elsewhere). Rows whose text has since changed stay;
 * Apply/Revert report them as stale at click time.
 */
function restoreEnhanceState(resume: ResumeData): PersistedEnhanceState | null {
  const stored = loadEnhanceState(resume.id)
  if (!stored) return null
  const suggestions = stored.suggestions.filter((suggestion) =>
    resume.sections.some(
      (section) =>
        section.id === suggestion.sectionId &&
        section.items.some((item) => item.id === suggestion.itemId)
    )
  )
  if (suggestions.length === 0) {
    clearEnhanceState(resume.id)
    return null
  }
  return { ...stored, suggestions }
}

export const useResumeStore = create<ResumeStore>((set, get) => ({
  resume: null,
  activeSection: null,
  isDirty: false,
  saveStatus: "idle" as SaveStatus,
  generateStatus: "idle" as GenerateStatus,
  lastExport: null,
  exportStale: false,
  lastSavedAt: null,
  atsResults: null,
  atsStale: false,
  atsPreviousScore: null,
  isAnalyzing: false,
  atsError: null,
  jobDescription: "",
  missingKeywords: [],
  enhanceSuggestions: null,
  enhanceGrounding: [],
  isEnhancing: false,
  enhanceError: null,
  enhanceFocus: null,
  openInspector: null,
  groupAdditional: false,
  groupAdditionalTitle: "Skills & Certifications",
  customization: { ...DEFAULT_CUSTOMIZATION },

  setResume: (resume) => {
    const restored = restoreEnhanceState(resume)
    set({
      resume,
      customization: loadCustomization(resume.id),
      isDirty: false,
      saveStatus: "idle",
      exportStale: false,
      lastSavedAt: null,
      atsResults: resume.latestAnalysis ?? null,
      // Staleness is client state; a reload has to be told about it.
      atsStale: !!resume.latestAnalysis && !!resume.latestAnalysisOutdated,
      atsPreviousScore: null,
      jobDescription: resume.jobDescription ?? "",
      missingKeywords: resume.latestAnalysis?.missingKeywords ?? [],
      isAnalyzing: false,
      atsError: null,
      enhanceSuggestions: restored?.suggestions ?? null,
      enhanceGrounding: restored?.grounding ?? [],
      isEnhancing: false,
      enhanceError: null,
      enhanceFocus: restored?.focus ?? null,
      activeSection: null,
      generateStatus: "idle",
      // A drawer left open across a resume switch would show the wrong
      // resume's data underneath it.
      openInspector: null,
    })
  },
  setActiveSection: (sectionId) => set({ activeSection: sectionId }),

  updateSectionItem: (sectionId, itemId, content) =>
    set((state) => {
      if (!state.resume) return state
      const sections = state.resume.sections.map((s) => {
        if (s.id !== sectionId) return s
        return {
          ...s,
          items: s.items.map((item) =>
            item.id === itemId ? { ...item, content } : item
          ),
        }
      })
      return { resume: { ...state.resume, sections }, isDirty: true, exportStale: true, atsStale: true }
    }),

  addSectionItem: (sectionId, content) =>
    set((state) => {
      if (!state.resume) return state
      const sections = state.resume.sections.map((s) => {
        if (s.id !== sectionId) return s
        const newItem: SectionItem = {
          id: `temp-${Date.now()}`,
          sectionId,
          content,
          metadata: null,
          order: s.items.length,
        }
        return { ...s, items: [...s.items, newItem] }
      })
      return { resume: { ...state.resume, sections }, isDirty: true, exportStale: true, atsStale: true }
    }),

  removeSectionItem: (sectionId, itemId) =>
    set((state) => {
      if (!state.resume) return state
      const sections = state.resume.sections.map((s) => {
        if (s.id !== sectionId) return s
        return { ...s, items: s.items.filter((item) => item.id !== itemId) }
      })
      return { resume: { ...state.resume, sections }, isDirty: true, exportStale: true, atsStale: true }
    }),

  addSection: (section) =>
    set((state) => {
      if (!state.resume) return state
      return {
        resume: {
          ...state.resume,
          sections: [...state.resume.sections, section],
        },
        isDirty: true,
        exportStale: true,
        atsStale: true,
      }
    }),

  removeSection: (sectionId) =>
    set((state) => {
      if (!state.resume) return state
      return {
        resume: {
          ...state.resume,
          sections: state.resume.sections.filter((s) => s.id !== sectionId),
        },
        isDirty: true,
        exportStale: true,
        atsStale: true,
      }
    }),

  reorderSection: (sectionId, direction) =>
    set((state) => {
      if (!state.resume) return state
      const sorted = [...state.resume.sections].sort((a, b) => a.order - b.order)
      const idx = sorted.findIndex((s) => s.id === sectionId)
      if (idx === -1) return state
      // Contact is always at idx 0 — never allow swapping above it
      if (direction === "up" && idx <= 1) return state
      if (direction === "down" && idx >= sorted.length - 1) return state
      const swapIdx = direction === "up" ? idx - 1 : idx + 1
      const updatedSections = sorted
        .map((s) => {
          if (s.id === sorted[idx].id) return { ...s, order: sorted[swapIdx].order }
          if (s.id === sorted[swapIdx].id) return { ...s, order: sorted[idx].order }
          return s
        })
        // Consumers (e.g. the preview) render raw array order, so the array
        // itself has to reflect the new order — not just the `order` field.
        .sort((a, b) => a.order - b.order)
      return {
        resume: { ...state.resume, sections: updatedSections },
        isDirty: true,
        exportStale: true,
        atsStale: true,
      }
    }),

  reorderSections: (orderedSectionIds) =>
    set((state) => {
      if (!state.resume) return state
      const sections = state.resume.sections
        .map((s) => {
          const newOrder = orderedSectionIds.indexOf(s.id)
          if (newOrder === -1) return s
          return { ...s, order: newOrder }
        })
        // Consumers (e.g. the preview) render raw array order, so the array
        // itself has to reflect the new order — not just the `order` field.
        .sort((a, b) => a.order - b.order)
      return {
        resume: { ...state.resume, sections },
        isDirty: true,
        exportStale: true,
        atsStale: true,
      }
    }),

  reorderSectionItems: (sectionId, orderedItemIds) =>
    set((state) => {
      if (!state.resume) return state
      const sections = state.resume.sections.map((s) => {
        if (s.id !== sectionId) return s
        const items = s.items
          .map((item) => {
            const newOrder = orderedItemIds.indexOf(item.id)
            if (newOrder === -1) return item
            return { ...item, order: newOrder }
          })
          // Consumers (e.g. the preview) render raw array order, so the array
          // itself has to reflect the new order — not just the `order` field.
          .sort((a, b) => a.order - b.order)
        return { ...s, items }
      })
      return {
        resume: { ...state.resume, sections },
        isDirty: true,
        exportStale: true,
        atsStale: true,
      }
    }),

  updateTemplate: (template) =>
    set((state) => {
      if (!state.resume) return state
      return { resume: { ...state.resume, template }, isDirty: true, exportStale: true, atsStale: true }
    }),

  setSaveStatus: (saveStatus) => set({ saveStatus }),
  // Saving persists content; it does not regenerate the export files, so a
  // clean save deliberately leaves `exportStale` alone.
  markClean: () => set({ isDirty: false, saveStatus: "saved", lastSavedAt: new Date() }),
  setGenerateStatus: (generateStatus) => set({ generateStatus }),
  setLastExport: (lastExport) => set({ lastExport, exportStale: false }),
  setExportStale: (exportStale) => set({ exportStale }),
  // The replaced analysis becomes the "before" for the delta line — only when
  // both runs scored the same question, since a quality score and a job-match
  // score are not comparable. Captured on landing rather than on start, so a
  // failed re-run leaves the last real comparison in place.
  setAtsResults: (atsResults, stale = false) =>
    set((state) => {
      const previous = state.atsResults
      const comparable =
        previous !== null &&
        atsResults !== null &&
        (previous.mode ?? "job-match") === (atsResults.mode ?? "job-match")
      return {
        atsResults,
        atsStale: stale,
        atsPreviousScore: comparable ? previous.overallScore : null,
      }
    }),
  clearAtsPreviousScore: () => set({ atsPreviousScore: null }),
  setIsAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setAtsError: (atsError) => set({ atsError }),
  setJobDescription: (jobDescription) => set({ jobDescription }),
  setMissingKeywords: (missingKeywords) => set({ missingKeywords }),
  // A new suggestion set starts with nothing dismissed.
  setEnhanceSuggestions: (enhanceSuggestions) =>
    set({
      enhanceSuggestions:
        enhanceSuggestions?.map((s) => (s.dismissed ? { ...s, dismissed: false } : s)) ?? null,
    }),
  setEnhanceGrounding: (enhanceGrounding) => set({ enhanceGrounding }),
  setIsEnhancing: (isEnhancing) => set({ isEnhancing }),
  setEnhanceError: (enhanceError) => set({ enhanceError }),
  setEnhanceFocus: (enhanceFocus) => set({ enhanceFocus }),
  setOpenInspector: (openInspector) => set({ openInspector }),
  clearEnhanceSuggestions: () =>
    set({ enhanceSuggestions: null, enhanceError: null, enhanceGrounding: [] }),
  clearEnhanceError: () => set({ enhanceError: null }),

  applyEnhanceSuggestion: (id) => {
    const state = get()
    const suggestion = state.enhanceSuggestions?.find((s) => s.id === id)
    if (!suggestion || !state.resume) return { ok: false, reason: "missing" }

    const section = state.resume.sections.find((s) => s.id === suggestion.sectionId)
    const item = section?.items.find((i) => i.id === suggestion.itemId)
    if (!item) return { ok: false, reason: "missing" }

    // Apply drops the bullet a removal points at, or replaces the original text
    // with the rewrite.
    const content =
      suggestion.action === "remove"
        ? contentWithBulletRemoved(item, suggestion, suggestion.original)
        : suggestion.suggested === undefined
          ? null
          : contentWithEnhancedText(
              item,
              suggestion,
              suggestion.original,
              suggestion.suggested
            )
    if (!content) return { ok: false, reason: "stale" }

    get().updateSectionItem(suggestion.sectionId, suggestion.itemId, content)
    set((current) => ({
      enhanceSuggestions:
        current.enhanceSuggestions?.map((s) =>
          s.id === id ? { ...s, status: "applied" as const } : s
        ) ?? null,
    }))
    return { ok: true }
  },

  revertEnhanceSuggestion: (id) => {
    const state = get()
    const suggestion = state.enhanceSuggestions?.find((s) => s.id === id)
    if (!suggestion || !state.resume) return { ok: false, reason: "missing" }

    const section = state.resume.sections.find((s) => s.id === suggestion.sectionId)
    const item = section?.items.find((i) => i.id === suggestion.itemId)
    if (!item) return { ok: false, reason: "missing" }

    // Revert re-inserts a removed bullet, or puts the original back over the
    // rewrite.
    const content =
      suggestion.action === "remove"
        ? contentWithBulletReinserted(item, suggestion, suggestion.original)
        : suggestion.suggested === undefined
          ? null
          : contentWithEnhancedText(
              item,
              suggestion,
              suggestion.suggested,
              suggestion.original,
              false
            )
    if (!content) return { ok: false, reason: "stale" }

    get().updateSectionItem(suggestion.sectionId, suggestion.itemId, content)
    set((current) => ({
      enhanceSuggestions:
        current.enhanceSuggestions?.map((s) =>
          s.id === id ? { ...s, status: "pending" as const } : s
        ) ?? null,
    }))
    return { ok: true }
  },

  dismissEnhanceSuggestion: (id) =>
    set((state) => ({
      enhanceSuggestions:
        state.enhanceSuggestions?.map((s) =>
          s.id === id && s.status === "pending" ? { ...s, dismissed: true } : s
        ) ?? null,
    })),

  undismissEnhanceSuggestion: (id) =>
    set((state) => ({
      enhanceSuggestions:
        state.enhanceSuggestions?.map((s) =>
          s.id === id ? { ...s, dismissed: false } : s
        ) ?? null,
    })),

  setGroupAdditional: (groupAdditional) => set({ groupAdditional }),
  setGroupAdditionalTitle: (groupAdditionalTitle) => set({ groupAdditionalTitle }),

  setCustomization: (partial) =>
    set((state) => {
      const customization = { ...state.customization, ...partial }
      if (state.resume) saveCustomization(state.resume.id, customization)
      return { customization }
    }),

  resetCustomization: () =>
    set((state) => {
      const customization = { ...DEFAULT_CUSTOMIZATION }
      if (state.resume) saveCustomization(state.resume.id, customization)
      return { customization }
    }),

  applyGeneratedSections: (sections) =>
    set((state) => {
      // Content is already persisted server-side, so the store stays clean;
      // a dirty store means newer local edits, which win.
      if (!state.resume || state.isDirty) return state
      return { resume: { ...state.resume, sections } }
    }),

  reconcileTempIds: (idMap) =>
    set((state) => {
      if (!state.resume || Object.keys(idMap).length === 0) return state
      const sections = state.resume.sections.map((s) => ({
        ...s,
        items: s.items.map((item) =>
          idMap[item.id] ? { ...item, id: idMap[item.id] } : item
        ),
      }))
      // Open suggestions address items by id — both in `itemId` and inside the
      // "<sectionId>::<itemId>::<slot>" target id — so they have to follow the
      // rename or Apply/Revert would go permanently inert after a save.
      const enhanceSuggestions =
        state.enhanceSuggestions?.map((suggestion) => {
          const newItemId = idMap[suggestion.itemId]
          if (!newItemId) return suggestion
          const parts = suggestion.id.split("::")
          const id = parts.length === 3 ? [parts[0], newItemId, parts[2]].join("::") : suggestion.id
          return { ...suggestion, id, itemId: newItemId }
        }) ?? null
      return { resume: { ...state.resume, sections }, enhanceSuggestions }
    }),
}))

// Mirror the Enhance state to localStorage so the list (and the originals Revert
// needs) survives a reload. The id comes from the same snapshot as the
// suggestions, so a resume switch never writes one resume's list under another.
useResumeStore.subscribe((state, prev) => {
  if (
    state.enhanceSuggestions === prev.enhanceSuggestions &&
    state.enhanceGrounding === prev.enhanceGrounding &&
    state.enhanceFocus === prev.enhanceFocus
  ) {
    return
  }
  if (!state.resume) return
  if (state.enhanceSuggestions && state.enhanceSuggestions.length > 0) {
    saveEnhanceState(state.resume.id, {
      suggestions: state.enhanceSuggestions,
      grounding: state.enhanceGrounding,
      focus: state.enhanceFocus,
    })
  } else {
    clearEnhanceState(state.resume.id)
  }
})
