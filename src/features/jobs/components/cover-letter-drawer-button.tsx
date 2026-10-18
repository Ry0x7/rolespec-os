"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Drawer, DrawerBody, DrawerHeader } from "@/shared/ui/drawer"
import { CoverLetterForm } from "./cover-letter-form"
import type {
  CoverLetterApplicationOption,
  CoverLetterResumeOption,
} from "../services/cover-letter-form-options"

interface Props {
  resumes: CoverLetterResumeOption[]
  /** The application this letter is for — always locked on Job Detail. */
  application: CoverLetterApplicationOption
  defaultResumeId?: string
  resumeHint?: string | null
}

/**
 * Cover-letter creation without leaving the job. The form is the same
 * props-only component `/jobs/cover-letter/new` mounts; only the navigation
 * differs — the action returns the new id, this closes and refreshes so the
 * letter shows up in the list behind the drawer.
 */
export function CoverLetterDrawerButton({
  resumes,
  application,
  defaultResumeId,
  resumeHint,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  function handleGenerated(id: string) {
    setOpen(false)
    toast.success("Cover letter created", {
      action: {
        label: "Open",
        onClick: () => router.push(`/jobs/cover-letter/${id}`),
      },
    })
    router.refresh()
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        New cover letter
      </Button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width="max-w-lg"
        fullHeight
        aria-labelledby="cover-letter-drawer-title"
      >
        <DrawerHeader>
          <h2 id="cover-letter-drawer-title" className="text-sm font-semibold">
            New cover letter — {application.jobTitle} at {application.companyName}
          </h2>
        </DrawerHeader>
        <DrawerBody>
          <CoverLetterForm
            resumes={resumes}
            // The picker is replaced by the locked application, so the full
            // application list this form takes is not needed here.
            applications={[application]}
            lockedApplication={application}
            defaultResumeId={defaultResumeId}
            resumeHint={resumeHint}
            redirect={false}
            onGenerated={handleGenerated}
            // The drawer header already names the job and the panel is its own
            // surface, so the form drops its card chrome here.
            variant="bare"
          />
        </DrawerBody>
      </Drawer>
    </>
  )
}
