"use client"

import { useId, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ChevronDown } from "lucide-react"
import { Card } from "@/shared/ui/card"
import { cn } from "@/shared/lib/utils"

const PREVIEW_LENGTH = 160

interface JobDescriptionPanelProps {
  jobDescription: string
  /**
   * Job Detail keeps the posting collapsed — it is the reference material the
   * page is measured against, not a step in the workflow. Callers that show the
   * posting as the main content can opt back into an open panel.
   */
  defaultOpen?: boolean
}

/** One line of the posting, so a collapsed panel still says which posting it is. */
function previewOf(jobDescription: string) {
  const flattened = jobDescription.replace(/\s+/g, " ").trim()
  return flattened.length > PREVIEW_LENGTH
    ? `${flattened.slice(0, PREVIEW_LENGTH).trimEnd()}…`
    : flattened
}

/**
 * The job description is what every AI action on this page is measured against,
 * so it is readable here instead of only inside the Edit dialog. Collapsible
 * because a pasted posting can be thousands of characters.
 */
export function JobDescriptionPanel({
  jobDescription,
  defaultOpen = false,
}: JobDescriptionPanelProps) {
  const shouldReduceMotion = useReducedMotion()
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const preview = previewOf(jobDescription)

  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 rounded-lg px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold text-foreground">
            Job Description
          </span>
          {!open && preview && (
            <span className="mt-0.5 block truncate text-sm text-muted-foreground">
              {preview}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            !open && "-rotate-90"
          )}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="job-description-body"
            id={bodyId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.22, ease: [0.4, 0, 0.2, 1] }
            }
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-4 sm:px-6">
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {jobDescription}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
