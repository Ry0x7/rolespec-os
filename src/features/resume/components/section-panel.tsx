"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, Reorder, useDragControls, useReducedMotion } from "framer-motion"
import { toast } from "sonner"
import {
  AlignLeft,
  Award,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  FolderKanban,
  GraduationCap,
  GripVertical,
  LayoutList,
  Plus,
  Trash2,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { ConfirmDialog } from "@/shared/ui/confirm-dialog"
import { cn } from "@/shared/lib/utils"
import type { SectionType } from "@/generated/prisma/enums"
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

const ALL_TYPED_SECTIONS: { type: SectionType; label: string }[] = [
  { type: "SUMMARY", label: "Summary" },
  { type: "EXPERIENCE", label: "Experience" },
  { type: "EDUCATION", label: "Education" },
  { type: "SKILLS", label: "Skills" },
  { type: "PROJECTS", label: "Projects" },
  { type: "CERTIFICATIONS", label: "Certifications" },
]

/**
 * One icon and one plain-language explanation per section type. The copy says
 * what a person should type, not what the data model calls it.
 */
const SECTION_META: Record<SectionType, { icon: LucideIcon; hint: string }> = {
  CONTACT: {
    icon: UserRound,
    hint: "Your name, email, phone number and links — the details a recruiter needs to reach you.",
  },
  SUMMARY: {
    icon: AlignLeft,
    hint: "Two or three sentences about the work you do and the role you want. This is often the first thing a recruiter reads.",
  },
  EXPERIENCE: {
    icon: BriefcaseBusiness,
    hint: "Add each job with its company and dates, then two to four results. Start with an action and include a number where you can.",
  },
  EDUCATION: {
    icon: GraduationCap,
    hint: "Add your school, program and year. Keep honors or coursework only when they help this role.",
  },
  SKILLS: {
    icon: Wrench,
    hint: "List the tools and skills you actually use, grouped so they can be scanned in a few seconds.",
  },
  PROJECTS: {
    icon: FolderKanban,
    hint: "Describe what the project does, the part you owned, and the result. A link is a bonus, not a requirement.",
  },
  CERTIFICATIONS: {
    icon: Award,
    hint: "Add the certificate name, who issued it and the year. Skip expired or unrelated ones.",
  },
  CUSTOM: {
    icon: LayoutList,
    hint: "Use this for anything the job asks for — volunteering, languages, awards or speaking.",
  },
}

const ADD_MENU_ID = "resume-add-section-menu"

export function SectionPanel() {
  const resume = useResumeStore((s) => s.resume)
  const activeSection = useResumeStore((s) => s.activeSection)
  const setActiveSection = useResumeStore((s) => s.setActiveSection)
  const addSection = useResumeStore((s) => s.addSection)
  const removeSection = useResumeStore((s) => s.removeSection)
  const reorderSections = useResumeStore((s) => s.reorderSections)
  const reorderSection = useResumeStore((s) => s.reorderSection)
  const shouldReduceMotion = useReducedMotion()

  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customTitle, setCustomTitle] = useState("")
  const [isAdding, setIsAdding] = useState(false)
  /** The section awaiting a delete confirmation, if any. */
  const [pendingRemoval, setPendingRemoval] = useState<Section | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const firstMenuItemRef = useRef<HTMLButtonElement>(null)

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

  // Escape closes the menu wherever focus is inside it, not only in the custom
  // name field. Inline rather than absolute, so the list can never be clipped by
  // the editor pane or a section card.
  useEffect(() => {
    if (!showAddMenu) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.stopPropagation()
      setShowAddMenu(false)
      setShowCustomInput(false)
      setCustomTitle("")
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [showAddMenu])

  useEffect(() => {
    if (showAddMenu) firstMenuItemRef.current?.focus()
  }, [showAddMenu])

  // Declared before the empty-state return so the hook order never changes.
  const jumpToSection = useCallback(
    (sectionId: string) => {
      setActiveSection(sectionId)
      // Let the accordion commit its open state before scrolling, so the pane
      // measures the expanded card rather than the collapsed one.
      requestAnimationFrame(() => {
        const node = document.getElementById(`resume-section-${sectionId}`)
        if (!node) return
        node.scrollIntoView?.({
          behavior: shouldReduceMotion ? "auto" : "smooth",
          block: "start",
        })
        node.querySelector<HTMLButtonElement>("[data-section-toggle]")?.focus({
          preventScroll: true,
        })
      })
    },
    [setActiveSection, shouldReduceMotion],
  )

  if (!resume) return null

  const sorted = [...resume.sections].sort((a, b) => a.order - b.order)
  const contactSection = sorted.find((s) => s.type === "CONTACT")
  const draggableSections = sorted.filter((s) => s.type !== "CONTACT")
  const presentTypes = new Set(resume.sections.map((s) => s.type))
  const availableTyped = ALL_TYPED_SECTIONS.filter((s) => !presentTypes.has(s.type))
  const orderedSections = contactSection
    ? [contactSection, ...draggableSections]
    : draggableSections
  const atCap = resume.sections.length >= 12

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
    <div className="space-y-3">
      {/* Section overview: the same order the resume uses, with one-tap jumps.
          Wraps instead of scrolling, so a narrow phone never gets a sideways
          scrollbar and every section stays reachable. */}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Resume sections</h2>
            <p className="text-xs text-muted-foreground">
              {resume.sections.length} of 12 used · drag a card to change the order
            </p>
          </div>
          <span
            className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground"
            aria-label={`${resume.sections.length} of 12 sections used`}
          >
            {resume.sections.length}/12
          </span>
        </div>

        {orderedSections.length > 1 && (
          <ol
            className="mt-2 flex flex-wrap gap-1.5"
            aria-label="Jump to section"
          >
            {orderedSections.map((section, index) => {
              const meta = SECTION_META[section.type]
              const Icon = meta.icon
              const active = activeSection === section.id
              return (
                <li key={section.id} className="min-w-0 max-w-full">
                  <button
                    type="button"
                    onClick={() => jumpToSection(section.id)}
                    aria-label={`Jump to ${section.title}`}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {index + 1}
                    </span>
                    <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{section.title}</span>
                    {section.type !== "CONTACT" && (
                      <span className="shrink-0 rounded-full bg-muted px-1 text-[10px] text-muted-foreground">
                        {section.items.length}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {/* Contact section is always first and not draggable */}
      {contactSection && (
        <SectionAccordion
          section={contactSection}
          number={1}
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
            number={index + (contactSection ? 2 : 1)}
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

      {/* Add Section — the menu is inline, so it grows the page instead of
          being clipped by a card or the pane. */}
      <div className="relative" ref={menuRef}>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            setShowAddMenu((prev) => !prev)
            setShowCustomInput(false)
            setCustomTitle("")
          }}
          disabled={isAdding || atCap}
          aria-expanded={showAddMenu}
          aria-controls={showAddMenu ? ADD_MENU_ID : undefined}
          title={atCap ? "A resume can hold up to 12 sections" : "Add another section"}
        >
          <Plus className="h-4 w-4" />
          Add another section
        </Button>

        {atCap && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            You have reached the 12-section limit. Remove one to add another.
          </p>
        )}

        {showAddMenu && (
          <div
            id={ADD_MENU_ID}
            className="mt-2 rounded-lg border border-border bg-card p-2 shadow-sm"
          >
            <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
              Choose a section to add
            </p>
            {availableTyped.length > 0 ? (
              <div className="grid gap-1 sm:grid-cols-2">
                {availableTyped.map((item, index) => {
                  const meta = SECTION_META[item.type]
                  const Icon = meta.icon
                  return (
                    <button
                      key={item.type}
                      ref={index === 0 ? firstMenuItemRef : undefined}
                      type="button"
                      onClick={() => handleAdd(item.type)}
                      disabled={isAdding}
                      className="flex min-h-11 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      {item.label}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                Every standard section is already in this resume. Add a custom
                one below.
              </p>
            )}

            <div className="mt-1 border-t border-border pt-1">
              {!showCustomInput ? (
                <button
                  ref={availableTyped.length === 0 ? firstMenuItemRef : undefined}
                  type="button"
                  onClick={() => setShowCustomInput(true)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <LayoutList className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  Custom section
                </button>
              ) : (
                <div className="space-y-2 p-1">
                  <label className="block text-xs font-medium text-muted-foreground" htmlFor="resume-custom-section-title">
                    Section name
                  </label>
                  <Input
                    id="resume-custom-section-title"
                    placeholder="For example: Volunteering"
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
                    Add section
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {!showAddMenu && availableTyped.length > 0 && !atCap && (
        <div className="flex flex-wrap gap-1.5" aria-label="Quick add sections">
          {availableTyped.slice(0, 4).map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => handleAdd(item.type)}
              disabled={isAdding}
              aria-label={`Add ${item.label} section`}
              className="min-h-9 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
            >
              + {item.label}
            </button>
          ))}
        </div>
      )}

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

const HEADER_ROW =
  "xl:sticky xl:top-0 z-10 flex w-full items-center justify-between gap-2 bg-card px-2 py-1.5 transition-colors hover:bg-muted sm:px-3 sm:py-2"

const ICON_BUTTON =
  "h-11 w-8 shrink-0 sm:h-8 sm:w-8"

function SectionIdentity({
  section,
  number,
  isActive,
  onToggle,
}: {
  section: Section
  number: number
  isActive: boolean
  onToggle: () => void
}) {
  const meta = SECTION_META[section.type]
  const Icon = meta.icon
  return (
    <button
      type="button"
      data-section-toggle
      onClick={onToggle}
      aria-expanded={isActive}
      aria-controls={`section-body-${section.id}`}
      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
    >
      <ChevronDown
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
          isActive && "rotate-180",
        )}
      />
      <span
        className={cn(
          "hidden h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold sm:inline-flex",
          isActive
            ? "bg-primary/15 text-foreground"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {number}
      </span>
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {section.title}
      </span>
      {section.type !== "CONTACT" && (
        <span
          className="hidden shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline"
          title={`${section.items.length} ${section.items.length === 1 ? "entry" : "entries"}`}
        >
          {section.items.length}
        </span>
      )}
    </button>
  )
}

function EmptySectionHint({ section }: { section: Section }) {
  return (
    <div
      role="note"
      className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2.5"
    >
      <p className="text-xs font-medium">What goes here</p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        {SECTION_META[section.type].hint}
      </p>
    </div>
  )
}

function SectionBody({ section }: { section: Section }) {
  return (
    <div className="space-y-3" id={`section-body-${section.id}`}>
      {section.items.length === 0 && <EmptySectionHint section={section} />}
      <SectionEditorSwitch section={section} />
    </div>
  )
}

function DraggableSection({
  section,
  number,
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
  number: number
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
      className={cn(
        "scroll-mt-24 rounded-lg border bg-card transition-colors xl:scroll-mt-14",
        isActive
          ? "border-primary/40 shadow-sm ring-1 ring-primary/15"
          : "border-border",
      )}
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
          HEADER_ROW,
          isActive ? "rounded-t-lg" : "rounded-lg",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            onPointerDown={(e) => controls.start(e)}
            className="flex h-11 w-9 shrink-0 touch-none cursor-grab items-center justify-center rounded hover:bg-muted active:cursor-grabbing sm:h-8 sm:w-8"
            aria-label="Drag to reorder"
            title="Drag to reorder"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
          <SectionIdentity
            section={section}
            number={number}
            isActive={isActive}
            onToggle={onToggle}
          />
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn(ICON_BUTTON, "sm:h-8 sm:w-8")}
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
            className={cn(ICON_BUTTON, "sm:h-8 sm:w-8")}
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
            className={cn(
              ICON_BUTTON,
              "text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-8 sm:w-8",
            )}
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
            <div className="border-t border-border p-3 sm:p-4">
              <SectionBody section={section} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}

function SectionAccordion({
  section,
  number,
  isActive,
  onToggle,
}: {
  section: Section
  number: number
  isActive: boolean
  onToggle: () => void
}) {
  const shouldReduceMotion = useReducedMotion()

  return (
    // Anchor the ATS inspector's "jump to section" control can scroll to.
    <div
      id={`resume-section-${section.id}`}
      className={cn(
        "scroll-mt-24 rounded-lg border transition-colors xl:scroll-mt-14",
        isActive
          ? "border-primary/40 shadow-sm ring-1 ring-primary/15"
          : "border-border",
      )}
    >
      {/* Same sticky rule as `DraggableSection` — see the comment there.
          `bg-background` rather than `bg-card`: this container carries no
          `bg-card`, so the pane's own background is what the row has to stay
          opaque against. */}
      <div
        className={cn(
          "xl:sticky xl:top-0 z-10 flex w-full items-center justify-between gap-2 bg-background px-2 py-1.5 transition-colors hover:bg-muted sm:px-3 sm:py-2",
          isActive ? "rounded-t-lg" : "rounded-lg",
        )}
      >
        <button
          type="button"
          data-section-toggle
          onClick={onToggle}
          aria-expanded={isActive}
          aria-controls={`section-body-${section.id}`}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              isActive && "rotate-180",
            )}
          />
          <span
            className={cn(
              "hidden h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold sm:inline-flex",
              isActive
                ? "bg-primary/15 text-foreground"
                : "bg-muted text-muted-foreground",
            )}
            aria-hidden="true"
          >
            {number}
          </span>
          <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {section.title}
          </span>
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
            <div className="border-t border-border p-3 sm:p-4">
              <SectionBody section={section} />
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
