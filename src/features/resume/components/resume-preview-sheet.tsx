"use client"

import { Drawer } from "@/shared/ui/drawer"
import { useResumeStore } from "../hooks/use-resume-store"
import { ResumePreview } from "./resume-preview"

/**
 * Below `xl` the preview is a full-height sheet instead of an inline pane the
 * user had to scroll the entire editor to reach
 * (docs/resume-editor-qa.md's "five screens below the fold" finding). This is
 * the ONLY place `ResumePreview` mounts below `xl` — `resume-editor.tsx`
 * mounts the inline pane instead at `xl` and up, never both at once, so there
 * is always exactly one measurement mirror and one ResizeObserver pair alive.
 *
 * `data-preview-pane` is deliberately on a plain `flex-1 min-h-0` div, not a
 * second `overflow-y-auto` container: the Drawer panel itself already scrolls
 * (spec section 11 — avoid nested scroll containers), so this div only needs
 * a real measured height for the preview's fit-page zoom to read via
 * `clientHeight`, not its own scrollbar. The HORIZONTAL axis is the one
 * exception: the Drawer panel only scrolls vertically, so at 100% and above
 * the A4 page was wider than the sheet with no ancestor able to reach either
 * edge. `ResumePreview` owns that axis itself now (`data-preview-scroll`),
 * which is content-height and so never competes for the vertical one.
 * `sm:p-4` overrides the Drawer's
 * default `sm:p-6` — `ResumePreview`'s sticky toolbar cancels a `p-4` parent
 * with `-mx-4 -mt-4` below `xl` (there is no `sm:` step in its own math), so
 * the padding here has to stay p-4 the whole way down, not jump to p-6 at a
 * `sm` viewport this sheet still shows at.
 */
export function ResumePreviewSheet() {
  const openInspector = useResumeStore((s) => s.openInspector)
  const setOpenInspector = useResumeStore((s) => s.setOpenInspector)

  return (
    <Drawer
      open={openInspector === "preview"}
      onClose={() => setOpenInspector(null)}
      fullHeight
      width="max-w-lg"
      className="sm:p-4"
      aria-label="Resume preview"
    >
      <div data-preview-pane className="flex min-h-0 flex-1 flex-col pt-6">
        <ResumePreview />
      </div>
    </Drawer>
  )
}
