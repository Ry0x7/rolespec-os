"use client"

import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import type { DuplicateJobApplicationResult } from "../actions/job-application.actions"

/**
 * The inline "you already track this" notice, shared by the create and edit
 * dialogs so a refused save reads the same wherever it happens: what the
 * posting is called, and a way to open the application already holding it.
 */
export function DuplicateJobNotice({
  duplicate,
}: {
  duplicate: DuplicateJobApplicationResult
}) {
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p>{duplicate.error}</p>
        <p className="text-xs">
          {duplicate.existing.title} — {duplicate.existing.companyName}
        </p>
        {duplicate.existing.applicationId ? (
          <Link
            href={`/jobs/${duplicate.existing.applicationId}`}
            className="inline-block text-xs font-medium underline underline-offset-2"
          >
            Open existing
          </Link>
        ) : null}
      </div>
    </div>
  )
}
