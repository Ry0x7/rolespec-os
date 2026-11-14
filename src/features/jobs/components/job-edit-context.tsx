"use client"

import { createContext, useContext } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/shared/ui/button"

/** Which field the dialog should land on once it opens. */
export type JobEditFocusField = "jobDescription"

export interface JobEditContextValue {
  openEdit: (focusField?: JobEditFocusField) => void
}

/**
 * Deliberately split from `job-edit-provider`: the provider pulls in
 * `EditJobDialog` and, through it, the server actions. Panels only need the
 * handle, so importing it from here keeps them out of that module graph.
 */
export const JobEditContext = createContext<JobEditContextValue | null>(null)

/**
 * Returns null outside a provider — panels are also rendered in contexts that
 * own no dialog, so consumers must degrade rather than throw.
 */
export function useJobEdit(): JobEditContextValue | null {
  return useContext(JobEditContext)
}

/**
 * The one-click way out of "Add a job description to…". Renders nothing without
 * a provider, so a panel used elsewhere just keeps its message.
 */
export function AddJobDescriptionButton() {
  const jobEdit = useJobEdit()
  if (!jobEdit) return null

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => jobEdit.openEdit("jobDescription")}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      Add job description
    </Button>
  )
}
