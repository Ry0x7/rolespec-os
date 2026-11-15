"use client"

import { useCallback, useMemo, useState, type ReactNode } from "react"
import { EditJobDialog } from "./edit-job-dialog"
import type { JobFormApplication } from "./job-form-application"
import { JobEditContext, type JobEditFocusField } from "./job-edit-context"

/**
 * Owns the one edit dialog for a job detail page, so the header button and the
 * "Add job description" affordances inside the AI panels all open the same
 * form. Without this the panels are dead ends: they name the missing input but
 * offer no way to supply it.
 */
export function JobEditProvider({
  application,
  children,
}: {
  application: JobFormApplication
  children: ReactNode
}) {
  const [focusField, setFocusField] = useState<JobEditFocusField | null>(null)
  const [open, setOpen] = useState(false)

  const openEdit = useCallback((field?: JobEditFocusField) => {
    setFocusField(field ?? null)
    setOpen(true)
  }, [])

  const value = useMemo(() => ({ openEdit }), [openEdit])

  return (
    <JobEditContext.Provider value={value}>
      {children}
      {open ? (
        <EditJobDialog
          application={application}
          focusField={focusField}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </JobEditContext.Provider>
  )
}
