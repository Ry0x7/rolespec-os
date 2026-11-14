"use client"

import { useEffect } from "react"
import { useResumeStore } from "./use-resume-store"

export function useUnsavedGuard() {
  const isDirty = useResumeStore((s) => s.isDirty)

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault()
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isDirty])
}
