"use client"

import { useCallback } from "react"
import { toast } from "sonner"
import { useResumeStore, type EnhanceSuggestion } from "./use-resume-store"
import { collectEnhanceTargets } from "../lib/enhance-targets"
import { MAX_ENHANCE_JOB_DESCRIPTION_LENGTH } from "../constants/enhance"
import { enhanceResumeFromATS } from "../actions/enhance"

export function useEnhanceTrigger() {
  const isEnhancing = useResumeStore((s) => s.isEnhancing)
  const setIsEnhancing = useResumeStore((s) => s.setIsEnhancing)
  const setEnhanceError = useResumeStore((s) => s.setEnhanceError)
  const setEnhanceSuggestions = useResumeStore((s) => s.setEnhanceSuggestions)
  const setEnhanceGrounding = useResumeStore((s) => s.setEnhanceGrounding)
  const setEnhanceFocus = useResumeStore((s) => s.setEnhanceFocus)

  /**
   * Runs Enhance over the whole resume, or — with `focus` — over one section's
   * text only. A focused run records its focus; an unfocused run clears it.
   */
  const trigger = useCallback(async (focus?: { sectionId: string }) => {
    const state = useResumeStore.getState()
    if (!state.resume || state.isEnhancing) return
    // Defence in depth: the header already disables the Enhance button until an
    // analysis exists, so this only fires if the trigger is called elsewhere.
    const ats = state.atsResults
    if (!ats) {
      toast.error("Run Analyze first.")
      return
    }

    const capturedResumeId = state.resume.id
    const targets = collectEnhanceTargets(state.resume.sections).filter(
      (target) => !focus || target.sectionId === focus.sectionId
    )
    if (targets.length === 0) {
      toast.error(
        focus
          ? "Nothing to enhance in that section yet."
          : "Nothing to enhance yet — write a summary or some bullets first."
      )
      return
    }

    setIsEnhancing(true)
    setEnhanceError(null)
    setEnhanceFocus(focus ? { sectionId: focus.sectionId } : null)

    try {
      const result = await enhanceResumeFromATS({
        resumeId: capturedResumeId,
        targets: targets.map((target) => ({
          targetId: target.targetId,
          field: target.field,
          text: target.text,
          label: target.label,
        })),
        ats: {
          overallScore: ats.overallScore,
          scores: ats.scores,
          issues: ats.issues,
          suggestions: ats.suggestions,
          missingKeywords: state.missingKeywords,
        },
        jobDescription:
          state.jobDescription.trim().slice(0, MAX_ENHANCE_JOB_DESCRIPTION_LENGTH) ||
          undefined,
        ...(focus ? { focus: { sectionId: focus.sectionId } } : {}),
      })

      if (useResumeStore.getState().resume?.id !== capturedResumeId) return

      if (!result.success) {
        setEnhanceError(result.error)
        toast.error(result.error)
        return
      }

      const targetsById = new Map(targets.map((target) => [target.targetId, target]))
      const suggestions = result.suggestions.flatMap<EnhanceSuggestion>((suggestion) => {
        const target = targetsById.get(suggestion.targetId)
        if (!target) return []
        return [
          {
            id: suggestion.targetId,
            sectionId: target.sectionId,
            itemId: target.itemId,
            field: target.field,
            action: suggestion.action,
            bulletIndex: target.bulletIndex,
            original: target.text,
            suggested: suggestion.suggested,
            reason: suggestion.reason,
            status: "pending",
          },
        ]
      })

      // Rewrites the user already applied live in the resume text; dropping their
      // rows would strand them with no way back, so keep the ones this run did
      // not replace.
      const orphanedApplied = (useResumeStore.getState().enhanceSuggestions ?? []).filter(
        (previous) =>
          previous.status === "applied" &&
          !suggestions.some((next) => next.id === previous.id)
      )

      setEnhanceSuggestions([...orphanedApplied, ...suggestions])
      // Requirements the run refused to claim are reported, never silently
      // dropped — the gap is the user's to close, with real evidence.
      setEnhanceGrounding(result.grounding ?? [])
      if (suggestions.length === 0) {
        toast.info("No rewrites needed — your resume already covers the ATS findings.")
      }
    } catch {
      if (useResumeStore.getState().resume?.id !== capturedResumeId) return
      setEnhanceError("Enhance failed. Please try again.")
      toast.error("Enhance failed. Please try again.")
    } finally {
      if (useResumeStore.getState().resume?.id === capturedResumeId) {
        setIsEnhancing(false)
      }
    }
  }, [
    setIsEnhancing,
    setEnhanceError,
    setEnhanceSuggestions,
    setEnhanceGrounding,
    setEnhanceFocus,
  ])

  return { trigger, isEnhancing }
}
