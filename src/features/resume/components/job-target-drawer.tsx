"use client"

import { Drawer, DrawerBody, DrawerHeader } from "@/shared/ui/drawer"
import { useResumeStore } from "../hooks/use-resume-store"
import { JobTargetPanel, type JobOption } from "./job-target-panel"

interface Props {
  jobOptions?: JobOption[]
  initialJobId?: string
}

/**
 * The "Change" destination for the editor's compact Job Target summary.
 * `JobTargetPanel` mounts only while this is open (Drawer unmounts its
 * children when closed) — that is fine because the deep-link description
 * fetch itself runs from `ResumeEditor`, which stays mounted regardless, so
 * the description is already in the store by the time this ever opens.
 */
export function JobTargetDrawer({ jobOptions, initialJobId }: Props) {
  const openInspector = useResumeStore((s) => s.openInspector)
  const setOpenInspector = useResumeStore((s) => s.setOpenInspector)

  return (
    <Drawer
      open={openInspector === "job"}
      onClose={() => setOpenInspector(null)}
      // Wider than the ATS/Enhance inspectors on purpose: those present short
      // findings, this one is where a full job listing is pasted and read back.
      width="max-w-xl"
      aria-label="Job target"
    >
      <DrawerHeader>
        <h2 className="text-sm font-semibold">Job Target</h2>
      </DrawerHeader>
      {/* A flex column here is what lets the panel's description textarea claim
          the body's leftover height (the body itself is already the panel's
          `flex-1` scroll region) instead of ending in dead space. */}
      <DrawerBody className="flex flex-col">
        <JobTargetPanel jobOptions={jobOptions} initialJobId={initialJobId} bare />
      </DrawerBody>
    </Drawer>
  )
}
