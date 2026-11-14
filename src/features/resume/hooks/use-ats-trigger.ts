"use client"

import { useCallback } from "react"
import { toast } from "sonner"
import { useResumeStore } from "./use-resume-store"
import { analyzeATS } from "../actions/analyze-ats"

export function useATSTrigger() {
  const resume = useResumeStore((s) => s.resume)
  const isAnalyzing = useResumeStore((s) => s.isAnalyzing)
  const jobDescription = useResumeStore((s) => s.jobDescription)
  const setIsAnalyzing = useResumeStore((s) => s.setIsAnalyzing)
  const setAtsResults = useResumeStore((s) => s.setAtsResults)
  const setAtsError = useResumeStore((s) => s.setAtsError)
  const setMissingKeywords = useResumeStore((s) => s.setMissingKeywords)

  const trigger = useCallback(async () => {
    if (!resume || isAnalyzing) return
    const capturedResumeId = resume.id

    setIsAnalyzing(true)
    setAtsError(null)

    try {
      // Send the editor's current sections — the DB copy can be up to one
      // autosave debounce behind, which would score pre-edit text.
      // No job target means there is nothing to match against, so the run is a
      // job-independent resume-quality check rather than an error.
      const scoredSections = useResumeStore.getState().resume?.sections ?? []
      const result = await analyzeATS(
        capturedResumeId,
        scoredSections,
        jobDescription || undefined,
        jobDescription?.trim() ? "job-match" : "quality"
      )

      if (useResumeStore.getState().resume?.id !== capturedResumeId) return

      if (result.error) {
        setAtsError(result.error)
        if (result.code === "MISSING_JOB_DESCRIPTION") {
          toast.error("Add a job description in the Job Target panel, then analyze.")
        } else if (result.code === "RATE_LIMITED") {
          toast.error(result.error)
        }
      } else if (result.data) {
        // Edits made during the run were not scored, so the result lands stale.
        setAtsResults(
          result.data,
          useResumeStore.getState().resume?.sections !== scoredSections
        )
        setMissingKeywords(result.data.missingKeywords ?? [])
      }
    } catch {
      if (useResumeStore.getState().resume?.id !== capturedResumeId) return
      setAtsError("Analysis failed. Please try again.")
    } finally {
      if (useResumeStore.getState().resume?.id === capturedResumeId) {
        setIsAnalyzing(false)
      }
    }
  }, [resume, isAnalyzing, jobDescription, setIsAnalyzing, setAtsResults, setAtsError, setMissingKeywords])

  return { trigger }
}
