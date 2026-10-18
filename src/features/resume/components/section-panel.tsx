"use client"

import { useState, useRef, useEffect } from "react"
import { AnimatePresence, motion, Reorder, useDragControls, useReducedMotion } from "framer-motion"
import { toast } from "sonner"
import { ChevronDown, ChevronUp, Plus, Trash2, GripVertical } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { ConfirmDialog } from "@/shared/ui/confirm-dialog"
import { useResumeStore, type Section } from "../hooks/use-resume-store"
import {
  addResumeSection,
  removeResumeSection,
  reorderResumeSections,
} from "../actions/sections"
import { ContactEditor } from "./editors/contact-editor"
import { SummaryEditor } from "./editors/summary-editor"
import { ExperienceEditor } from "./editors/experience-editor"
import { EducationEditor } from "./editors/education-editor"
import { SkillsEditor } from "./editors/skills-editor"
import { ProjectsEditor } from "./editors/projects-editor"
import { CertificationsEditor } from "./editors/certifications-editor"
import { CustomEditor } from "./editors/custom-editor"
import { cn } from "@/shared/lib/utils"
import type { SectionType } from "@/generated/prisma/enums"

const ALL_TYPED_SECTIONS: { type: SectionType; label: string }[] = [
  { type: "SUMMARY", label: "Summary" },
  { type: "EXPERIENCE", label: "Experience" },
  { type: "EDUCATION", label: "Education" },
  { type: "SKILLS", label: "Skills" },
  { type: "PROJECTS", label: "Projects" },
  { type: "CERTIFICATIONS", label: "Certifications" },
]

export function SectionPanel() {
  const resume = useResumeStore((s) => s.resume)
  const activeSection = useResumeStore((s) => s.activeSection)
  const setActiveSection = useResumeStore((s) => s.setActiveSection)
  const addSection = useResumeStore((s) => s.addSection)
  const removeSection = useResumeStore((s) => s.removeSection)
  const reorderSections = useResumeStore((s) => s.reorderSections)
  const reorderSection = useResumeStore((s) => s.reorderSection)

  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customTitle, setCustomTitle] = useState("")
  const [isAdding, setIsAdding] = useState(false)
  /** The section awaiting a delete confirmation, if any. */
  const [pendingRemoval, setPendingRemoval] = useState<Section | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false)
        setShowCustomInput(false)
        setCustomTitle("")
      }
    }
    if (showAddMenu) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [showAddMenu])

  if (!resume) return null

  const sorted = [...resume.sections].sort((a, b) => a.order - b.order)
  const contactSection = sorted.find((s) => s.type === "CONTACT")
  const draggableSections = sorted.filter((s) => s.type !== "CONTACT")
  const presentTypes = new Set(resume.sections.map((s) => s.type))
  const availableTyped = ALL_TYPED_SECTIONS.filter((s) => !presentTypes.has(s.type))

  async function handleAdd(type: SectionType, title?: string) {
    if (!resume) return
    setIsAdding(true)
    try {
      const result = await addResumeSection(resume.id, type, title)
      if (result.error) {
        toast.error(result.error)
        return
      }
      const newSection: Section = {
        id: result.id,
        resumeId: resume.id,
        type,
        title: title ?? (ALL_TYPED_SECTIONS.find((s) => s.type === type)?.label ?? "Custom Section"),
        order: resume.sections.length,
        visible: true,
        items: [],
      }
      addSection(newSection)
      setActiveSection(result.id)
      setShowAddMenu(false)
      setShowCustomInput(false)
      setCustomTitle("")
    } catch {
      toast.error("Failed to add section")
    } finally {
      setIsAdding(false)
    }
  }

  /** A section with content asks first; an empty one just goes. */
  async function handleRemove(section: Section) {
    if (!resume) return
    if (section.items.length > 0) {
      setPendingRemoval(section)
      return
    }
    await removeSectionNow(section)
  }

  async function removeSectionNow(section: Section) {
    if (!resume) return
    try {
      const result = await removeResumeSection(resume.id, section.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      removeSection(section.id)
      if (activeSection === section.id) {
        setActiveSection(null)
      }
    } catch {
      toast.error("Failed to remove section")
    }
  }

  function handleDragReorder(newOrderIds: string[]) {
    const allOrderedIds = [
      ...(contactSection ? [contactSection.id] : []),
      ...newOrderIds,
    ]
    reorderSections(allOrderedIds)
  }

  // Read from the store rather than the render closure so callers can persist
  // immediately after dispatching a reorder action.
  async function persistSectionOrder() {
    const current = useResumeStore.getState().resume
    if (!current) return
    const currentSorted = [...current.sections].sort((a, b) => a.order - b.order)
    const orderedIds = currentSorted.map((s) => s.id)
    try {
      const result = await reorderResumeSections(current.id, orderedIds)
      if (result.error) {
        toast.error(result.error)
      }
    } catch {
      toast.error("Failed to save section order")
    }
  }

  async function handleMove(sectionId: string, direction: "up" | "down") {
    reorderSection(sectionId, direction)
    await persistSectionOrder()
  }

  return (
    <div className="space-y-2">
      {/* Contact section is always first and not draggable */}
      {contactSection && (
        <SectionAccordion
          section={contactSection}
          isActive={activeSection === contactSection.id}
          onToggle={() =>
            setActiveSection(activeSection === contactSection.id ? null : contactSection.id)
          }
        />
      )}

      {/* Draggable sections */}
      <Reorder.Group
        axis="y"
        values={draggableSections.map((s) => s.id)}
        onReorder={handleDragReorder}
        className="space-y-2"
      >
        {draggableSections.map((section, index) => (
          <DraggableSection
            key={section.id}
            section={section}
            isActive={activeSection === section.id}
            onToggle={() =>
              setActiveSection(activeSection === section.id ? null : section.id)
            }
            onRemove={() => handleRemove(section)}
            onDragEnd={persistSectionOrder}
            canMoveUp={index > 0}
            canMoveDown={index < draggableSections.length - 1}
            onMoveUp={() => handleMove(section.id, "up")}
            onMoveDown={() => handleMove(section.id, "down")}
          />
        ))}
      </Reorder.Group>

      {/* Add Section */}
      <div className="relative" ref={menuRef}>
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-1"
          onClick={() => {
            setShowAddMenu((prev) => !prev)
            setShowCustomInput(false)
            setCustomTitle("")
          }}
          disabled={isAdding || resume.sections.length >= 12}
        >
          <Plus className="h-4 w-4" />
          Add Section
        </Button>

        {showAddMenu && (
          <div className="absolute bottom-full left-0 right-0 mb-1 z-10 rounded-lg border border-border bg-card shadow-lg overflow-hidden">
            {availableTyped.map((item) => (
              <button
                key={item.type}
                onClick={() => handleAdd(item.type)}
                disabled={isAdding}
                className="w-full px-4 py-2 text-sm text-left hover:bg-muted transition-colors disabled:opacity-50"
              >
                {item.label}
              </button>
            ))}
            {!showCustomInput ? (
              <button
                onClick={() => setShowCustomInput(true)}
                className="w-full px-4 py-2 text-sm text-left hover:bg-muted transition-colors"
              >
                Custom Section
              </button>
            ) : (
              <div className="p-3 border-t border-border space-y-2">
                <Input
                  placeholder="Section title"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customTitle.trim()) {
                      handleAdd("CUSTOM", customTitle.trim())
                    }
                  }}
                  autoFocus
                />
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!customTitle.trim() || isAdding}
                  onClick={() => handleAdd("CUSTOM", customTitle.trim())}
                >
                  Add
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingRemoval !== null}
        title="Remove section?"
        description={`Removing "${pendingRemoval?.title ?? ""}" deletes all of its content. This cannot be undone.`}
        confirmLabel="Remove section"
        destructive
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          const section = pendingRemoval
          setPendingRemoval(null)
          if (section) void removeSectionNow(section)
        }}
      />
    </div>
  )
}

function DraggableSection({
  section,
  isActive,
  onToggle,
  onRemove,
  onDragEnd,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  section: Section
  isActive: boolean
  onToggle: () => void
  onRemove: () => void
  onDragEnd: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const controls = useDragControls()
  const shouldReduceMotion = useReducedMotion()

  return (
    <Reorder.Item
      value={section.id}
      id={`resume-section-${section.id}`}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      className="rounded-lg border border-border bg-card"
    >
      {/* Sticky inside the left pane's scroll container (`xl:overflow-y-auto`
          in resume-editor.tsx), so an expanded section's header — and its
          collapse control — stays visible while the user scrolls deep into
          the form. One open Experience section makes the pane's scrollHeight
          ~2110px against a ~779px viewport, and before this every header
          (including the open section's own) was off-screen at that depth.

          Sticky is constrained to its containing block, which is this
          Reorder.Item, so a header only pins while its OWN section is in view
          — nothing to coordinate between sections. `bg-card` is the colour the
          row already inherited from the card, made explicit so content cannot
          show through it, and the rounding follows the card's corners because
          an opaque square background would otherwise paint over them.

          `z-10`, deliberately NOT `--z-sticky` (30): the editor toolbar owns
          that tier and this row must scroll UNDER it, never over it — same
          reasoning as the preview toolbar's own `z-10`. */}
      <div
        className={cn(
          // `hover:bg-muted`, not `hover:bg-muted/50`: the tint REPLACES the
          // opaque base colour, so at 50% alpha the form content scrolling
          // under a pinned header showed straight through it (observed at
          // 1440 with Experience expanded and the pane scrolled ~900px).
          // Gated to `xl`: only there is the left pane its own scroll
          // container. Below it the page scrolls, so the nearest scrollport is
          // the document — the row pinned at viewport y=0, inside the app
          // header (`bg-background/80 backdrop-blur`), and ghosted through it
          // (observed at 1100x800, scrollY 1400).
          "xl:sticky xl:top-0 z-10 flex w-full items-center justify-between bg-card px-4 py-2 hover:bg-muted transition-colors",
          isActive ? "rounded-t-lg" : "rounded-lg"
        )}
      >
        <div className="flex flex-1 items-center gap-2">
          <button
            onPointerDown={(e) => controls.start(e)}
            className="cursor-grab active:cursor-grabbing touch-none p-1 rounded hover:bg-muted"
            aria-label="Drag to reorder"
            title="Drag to reorder"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
          <button
            onClick={onToggle}
            aria-expanded={isActive}
            className="flex flex-1 items-center gap-2 text-left"
          >
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", isActive && "rotate-180")} />
            <span className="font-medium text-sm">{section.title}</span>
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 sm:h-7 sm:w-7"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            aria-label={`Move ${section.title} section up`}
            title={`Move ${section.title} section up`}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 sm:h-7 sm:w-7"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            aria-label={`Move ${section.title} section down`}
            title={`Move ${section.title} section down`}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 sm:h-7 sm:w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onRemove}
            aria-label={`Remove ${section.title} section`}
            title={`Remove ${section.title} section`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isActive && (
          <motion.div
            key="section-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-4">
              <SectionEditorSwitch section={section} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}

function SectionAccordion({
  section,
  isActive,
  onToggle,
}: {
  section: Section
  isActive: boolean
  onToggle: () => void
}) {
  const shouldReduceMotion = useReducedMotion()

  return (
    // Anchor the ATS inspector's "jump to section" control can scroll to.
    <div id={`resume-section-${section.id}`} className="rounded-lg border border-border">
      {/* Same sticky rule as `DraggableSection` — see the comment there.
          `bg-background` rather than `bg-card`: this container carries no
          `bg-card`, so the pane's own background is what the row has to stay
          opaque against. */}
      <div
        className={cn(
          // Opaque hover tint for the same reason as `DraggableSection`.
          "xl:sticky xl:top-0 z-10 flex w-full items-center justify-between bg-background px-4 py-2 hover:bg-muted transition-colors",
          isActive ? "rounded-t-lg" : "rounded-lg"
        )}
      >
        <button
          onClick={onToggle}
          aria-expanded={isActive}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", isActive && "rotate-180")} />
          <span className="font-medium text-sm">{section.title}</span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isActive && (
          <motion.div
            key="section-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-4">
              <SectionEditorSwitch section={section} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SectionEditorSwitch({ section }: { section: Section }) {
  switch (section.type) {
    case "CONTACT":
      return <ContactEditor section={section} />
    case "SUMMARY":
      return <SummaryEditor section={section} />
    case "EXPERIENCE":
      return <ExperienceEditor section={section} />
    case "EDUCATION":
      return <EducationEditor section={section} />
    case "SKILLS":
      return <SkillsEditor section={section} />
    case "PROJECTS":
      return <ProjectsEditor section={section} />
    case "CERTIFICATIONS":
      return <CertificationsEditor section={section} />
    case "CUSTOM":
      return <CustomEditor section={section} />
    default:
      return <p className="text-sm text-muted-foreground">Editor not available for this section type.</p>
  }
}
