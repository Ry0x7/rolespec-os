"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { GENERIC_ERROR, isNoisyCode } from "@/shared/lib/rating/constants"
import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"
import { LINKEDIN_PDF_MAX_BYTES } from "../constants/linkedin"
import type { LinkedinSuggestionData } from "../services/linkedin.service"

/** Inline copy for the `POST /api/linkedin/rating` error codes. */
export const LINKEDIN_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Your session expired — sign in again to run a rating.",
  INVALID_BODY: "That upload couldn't be read. Try again.",
  NO_FILE: "Choose your LinkedIn PDF export first.",
  INVALID_TYPE: "Only PDF files are supported — use LinkedIn's “Save to PDF” export.",
  TOO_LARGE: "That file is over 5 MB. Upload the PDF LinkedIn exports.",
  PARSE_FAILED: "We couldn't read that PDF. Export it from LinkedIn again.",
  EMPTY_PDF:
    "That PDF has no readable text — export it from LinkedIn's “Save to PDF” option.",
  RATE_LIMITED: "Too many LinkedIn ratings. Wait a few minutes and try again.",
  RATING_FAILED: "The rating failed. Please try again.",
  INVALID_RESUME: "That resume couldn't be found. Pick another one and try again.",
}

/** Which optional context the server actually used on the latest rating run. */
export interface LinkedinContextUsed {
  resume: boolean
}

/**
 * Inline copy for `POST /api/linkedin/assist`. Shares the upload codes with the
 * rating route — only the throttle and failure copy differ.
 */
export const LINKEDIN_ASSIST_ERROR_MESSAGES: Record<string, string> = {
  ...LINKEDIN_ERROR_MESSAGES,
  RATE_LIMITED: "Too many suggestion runs. Wait a few minutes and try again.",
  ASSIST_FAILED: "Generating suggestions failed. Please try again.",
}

/**
 * Client-side guard shared by both LinkedIn actions, mirroring the server checks
 * so an obviously bad file never costs a request. Returns the message to show.
 */
export function validateLinkedinFile(file: File | null): string | null {
  if (!file) return LINKEDIN_ERROR_MESSAGES.NO_FILE
  if (file.type !== "application/pdf") return LINKEDIN_ERROR_MESSAGES.INVALID_TYPE
  if (file.size > LINKEDIN_PDF_MAX_BYTES) return LINKEDIN_ERROR_MESSAGES.TOO_LARGE
  return null
}

export interface UseLinkedinInitial {
  linkedin: ProfileRatingData | null
  linkedinSuggestions?: LinkedinSuggestionData | null
}

export function useLinkedin(initial: UseLinkedinInitial) {

  const [linkedin, setLinkedin] = useState<ProfileRatingData | null>(
    initial.linkedin
  )
  const [linkedinSuggestions, setLinkedinSuggestions] =
    useState<LinkedinSuggestionData | null>(initial.linkedinSuggestions ?? null)
  const [isRatingLinkedIn, setIsRatingLinkedIn] = useState(false)
  const [isAssistingLinkedIn, setIsAssistingLinkedIn] = useState(false)
  const [linkedinError, setLinkedinError] = useState<string | null>(null)
  /** Name of the last successfully read export — shown so a re-run needs no re-pick. */
  const [lastFileName, setLastFileName] = useState<string | null>(null)
  /** Optional extra context, chosen per run — nothing is persisted server-side. */
  const [selectedResumeId, setSelectedResumeId] = useState("")
  const [contextUsed, setContextUsed] = useState<LinkedinContextUsed | null>(null)

  const runLinkedIn = useCallback(
    async (file: File | null) => {
      if (isRatingLinkedIn) return
      const invalid = validateLinkedinFile(file)
      if (invalid || !file) {
        setLinkedinError(invalid)
        return
      }

      setIsRatingLinkedIn(true)
      setLinkedinError(null)

      try {
        const formData = new FormData()
        formData.append("file", file)
        // Optional — only sent when the user actually picked a resume.
        const resumeId = selectedResumeId.trim()
        if (resumeId) formData.append("resumeId", resumeId)

        const res = await fetch("/api/linkedin/rating", {
          method: "POST",
          body: formData,
        })
        const payload: {
          data?: ProfileRatingData
          contextUsed?: LinkedinContextUsed
          error?: string
          code?: string
        } = await res.json().catch(() => ({}))

        if (res.ok && payload.data) {
          setLinkedin(payload.data)
          setContextUsed(payload.contextUsed ?? { resume: false })
          setLastFileName(file.name)
          toast.success("LinkedIn profile rated")
          return
        }

        const message =
          (payload.code && LINKEDIN_ERROR_MESSAGES[payload.code]) ||
          payload.error ||
          GENERIC_ERROR
        setLinkedinError(message)
        if (isNoisyCode(payload.code)) {
          toast.error(message)
        }
      } catch {
        setLinkedinError("LinkedIn rating failed. Please try again.")
      } finally {
        setIsRatingLinkedIn(false)
      }
    },
    [isRatingLinkedIn, selectedResumeId]
  )

  const runLinkedInAssist = useCallback(
    async (file: File | null) => {
      if (isAssistingLinkedIn) return
      const invalid = validateLinkedinFile(file)
      if (invalid || !file) {
        setLinkedinError(invalid)
        return
      }

      setIsAssistingLinkedIn(true)
      setLinkedinError(null)

      try {
        const formData = new FormData()
        formData.append("file", file)

        const res = await fetch("/api/linkedin/assist", {
          method: "POST",
          body: formData,
        })
        const payload: {
          data?: LinkedinSuggestionData
          error?: string
          code?: string
        } = await res.json().catch(() => ({}))

        if (res.ok && payload.data) {
          setLinkedinSuggestions(payload.data)
          setLastFileName(file.name)
          toast.success("Suggestions ready")
          return
        }

        const message =
          (payload.code && LINKEDIN_ASSIST_ERROR_MESSAGES[payload.code]) ||
          payload.error ||
          GENERIC_ERROR
        setLinkedinError(message)
        if (isNoisyCode(payload.code)) {
          toast.error(message)
        }
      } catch {
        setLinkedinError("Generating suggestions failed. Please try again.")
      } finally {
        setIsAssistingLinkedIn(false)
      }
    },
    [isAssistingLinkedIn]
  )

  /** One click: rate the export, then generate rewrite suggestions from it. */
  const runLinkedInBoth = useCallback(
    async (file: File | null) => {
      if (isRatingLinkedIn || isAssistingLinkedIn) return
      await runLinkedIn(file)
      // `runLinkedIn` sets state async — re-read via a fresh guard instead of
      // the stale closure: only continue when the rating left no error.
      // The panel calls the two actions in sequence; this helper keeps that
      // pairing in one place for the one-click button.
      await runLinkedInAssist(file)
    },
    [isRatingLinkedIn, isAssistingLinkedIn, runLinkedIn, runLinkedInAssist]
  )

  /** Applies a no-AI heuristic result as if it were a rating run. */
  const applyQuickCheck = useCallback((data: ProfileRatingData) => {
    setLinkedin(data)
    setContextUsed({ resume: false })
    setLinkedinError(null)
  }, [])

  /** Clears both result panels back to the pre-scan state. */
  const clearLinkedInResults = useCallback(() => {
    setLinkedin(null)
    setLinkedinSuggestions(null)
    setContextUsed(null)
    setLinkedinError(null)
  }, [])

  return {
    linkedin,
    linkedinSuggestions,
    isRatingLinkedIn,
    isAssistingLinkedIn,
    linkedinError,
    lastFileName,
    setLinkedinError,
    runLinkedIn,
    runLinkedInAssist,
    runLinkedInBoth,
    applyQuickCheck,
    clearLinkedInResults,
    selectedResumeId,
    setSelectedResumeId,
    contextUsed,
  }
}
