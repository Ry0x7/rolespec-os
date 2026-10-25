"use client"

import { useEffect, useRef, useCallback } from "react"
import { useResumeStore } from "./use-resume-store"
import { saveResume } from "../actions/save"
import { toast } from "sonner"

const AUTOSAVE_DELAY = 2500
/** One retry after a failed save instead of going silent until the next edit. */
const ERROR_RETRY_DELAY = 5000
let lastRetryAt = 0

/**
 * In-flight guard at module scope rather than in a ref: the unmount flush below
 * keeps running after the hook instance (and every ref it owned) is gone, and
 * the editor mounts exactly one autosave owner, so a module-level flag is the
 * only thing both paths can share.
 */
let isSaving = false
/**
 * A save asked for while another was in flight (the unmount flush, a manual
 * save). Run once the in-flight one lands, if anything is still unsaved.
 */
let saveRequested = false

/**
 * Saves straight from the store instead of from React state, so the same code
 * path works while mounted and during unmount — reading props or writing
 * component state after unmount is not an option, but Zustand reads and writes
 * outside React are safe.
 */
async function saveFromStore() {
  const resume = useResumeStore.getState().resume
  if (!resume) return
  if (isSaving) {
    saveRequested = true
    return
  }

  isSaving = true
  saveRequested = false
  useResumeStore.getState().setSaveStatus("saving")

  try {
    const result = await saveResume(resume.id, resume.sections)
    const store = useResumeStore.getState()
    if (result?.error) {
      store.setSaveStatus("error")
      toast.error(result.error)
    } else {
      // Only the sections that were sent are saved. Edits typed while the
      // request was out keep the store dirty, and the effect below re-arms the
      // debounce for them once the status leaves "saving".
      if (store.resume?.sections === resume.sections) {
        store.markClean()
      } else {
        store.setSaveStatus("idle")
      }
      if (result.idMap && Object.keys(result.idMap).length > 0) {
        store.reconcileTempIds(result.idMap)
      }
    }
  } catch {
    useResumeStore.getState().setSaveStatus("error")
    toast.error("Failed to save — will retry once")
    const now = Date.now()
    if (now - lastRetryAt > 30000) {
      lastRetryAt = now
      setTimeout(() => {
        if (useResumeStore.getState().isDirty) void saveFromStore()
      }, ERROR_RETRY_DELAY)
    }
  } finally {
    isSaving = false
    if (saveRequested && useResumeStore.getState().isDirty) {
      void saveFromStore()
    }
  }
}

export function useAutosave() {
  const isDirty = useResumeStore((s) => s.isDirty)
  const saveStatus = useResumeStore((s) => s.saveStatus)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const performSave = useCallback(() => saveFromStore(), [])

  // Re-runs when a save starts (dropping a pending timer, since that save
  // carries the same edits) and when one ends still dirty. A failed save does
  // not re-arm, so an error is not retried on a loop.
  useEffect(() => {
    if (!isDirty || saveStatus === "saving" || saveStatus === "error") return

    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(() => {
      saveFromStore()
    }, AUTOSAVE_DELAY)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [isDirty, saveStatus])

  // Client-side navigation (the header's back link) unmounts the editor without
  // firing `beforeunload`, which used to drop whatever the debounce timer still
  // owed. Flushing on unmount is fire-and-forget on purpose: nothing is left to
  // await it, and `saveFromStore` reports its own result through the store.
  // Empty deps so this cleanup runs on unmount only, not on every re-arm.
  useEffect(() => {
    function flushOnHide() {
      if (document.visibilityState === "hidden" && useResumeStore.getState().isDirty) {
        void saveFromStore()
      }
    }
    document.addEventListener("visibilitychange", flushOnHide)
    window.addEventListener("pagehide", flushOnHide)
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide)
      window.removeEventListener("pagehide", flushOnHide)
      if (!useResumeStore.getState().isDirty) return
      saveFromStore()
    }
  }, [])

  return { performSave }
}
