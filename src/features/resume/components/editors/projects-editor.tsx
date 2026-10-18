"use client"

import { useEffect, useRef, useState } from "react"
import { Reorder, useDragControls } from "framer-motion"
import { useResumeStore, type Section, type SectionItem } from "../../hooks/use-resume-store"
import { BulletTextarea } from "./bullet-textarea"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Button } from "@/shared/ui/button"
import { MonthYearPicker } from "@/shared/ui/month-year-picker"
import { Plus, Trash2, X, GripVertical, FolderGit2 } from "lucide-react"
import { SectionTip } from "@/shared/ui/section-tip"
import { EmptyState } from "@/shared/components/empty-state"
import { SectionFindings, useSectionFindings } from "../section-findings"

interface ProjectContent {
  name?: string
  bullets?: string[]
  technologies?: string[]
  url?: string
  urlLabel?: string
  startDate?: string
  endDate?: string
}

interface Props {
  section: Section
}

export function ProjectsEditor({ section }: Props) {
  const updateSectionItem = useResumeStore((s) => s.updateSectionItem)
  const addSectionItem = useResumeStore((s) => s.addSectionItem)
  const removeSectionItem = useResumeStore((s) => s.removeSectionItem)
  const reorderSectionItems = useResumeStore((s) => s.reorderSectionItems)
  const findings = useSectionFindings(section.id)

  const sortedItems = [...section.items].sort((a, b) => a.order - b.order)

  function updateItem(itemId: string, content: ProjectContent) {
    updateSectionItem(section.id, itemId, content as Record<string, unknown>)
  }

  function addProject() {
    addSectionItem(section.id, {
      name: "",
      bullets: [""],
      technologies: [],
      url: "",
      urlLabel: "",
      startDate: "",
      endDate: "",
    })
  }

  function handleReorder(newOrder: SectionItem[]) {
    const orderedIds = newOrder.map((item) => item.id)
    reorderSectionItems(section.id, orderedIds)
  }

  return (
    <div className="space-y-4">
      {sortedItems.length === 0 && (
        <EmptyState
          variant="bare"
          icon={FolderGit2}
          title="No projects yet — add your first"
        />
      )}
      {findings.length > 0 && <SectionFindings findings={findings} />}
      <Reorder.Group axis="y" values={sortedItems} onReorder={handleReorder} className="space-y-4">
        {sortedItems.map((item) => (
          <ProjectCard
            key={item.id}
            item={item}
            showTip={findings.length === 0}
            onUpdate={(c) => updateItem(item.id, c)}
            onRemove={() => removeSectionItem(section.id, item.id)}
          />
        ))}
      </Reorder.Group>

      <Button variant="outline" size="sm" onClick={addProject} className="w-full">
        <Plus className="h-3.5 w-3.5" /> Add Project
      </Button>
    </div>
  )
}

function ProjectCard({
  item,
  showTip,
  onUpdate,
  onRemove,
}: {
  item: SectionItem
  showTip: boolean
  onUpdate: (content: ProjectContent) => void
  onRemove: () => void
}) {
  const controls = useDragControls()
  const content = item.content as unknown as ProjectContent
  const [newTech, setNewTech] = useState("")

  // Focus plumbing for the Enter / Backspace bullet gestures. Bullets here are
  // keyed by index (this list has no reorder), so the field refs are too.
  const bulletFieldsRef = useRef(new Map<number, HTMLTextAreaElement>())
  const pendingFocusRef = useRef<{ index: number; caret: "start" | "end" } | null>(null)

  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    const el = bulletFieldsRef.current.get(pending.index)
    if (!el) return
    pendingFocusRef.current = null
    el.focus()
    const pos = pending.caret === "end" ? el.value.length : 0
    el.setSelectionRange(pos, pos)
  })

  function addTechnology() {
    if (!newTech.trim()) return
    onUpdate({
      ...content,
      technologies: [...(content.technologies ?? []), newTech.trim()],
    })
    setNewTech("")
  }

  function removeTechnology(idx: number) {
    onUpdate({
      ...content,
      technologies: (content.technologies ?? []).filter((_, i) => i !== idx),
    })
  }

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      className="space-y-3 rounded-md border border-border p-4 bg-card"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onPointerDown={(e) => controls.start(e)}
            className="cursor-grab active:cursor-grabbing touch-none p-1 rounded hover:bg-muted"
            aria-label="Drag to reorder"
            title="Drag to reorder"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="text-xs font-medium text-muted-foreground uppercase">
            {content.name || "New Project"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${content.name || "project"}`}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5 text-error" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Project Name</Label>
          <Input
            value={content.name ?? ""}
            onChange={(e) => onUpdate({ ...content, name: e.target.value })}
            placeholder="My Open Source Project"
          />
        </div>
        <div className="space-y-1.5">
          <Label>URL (optional)</Label>
          <Input
            value={content.url ?? ""}
            onChange={(e) => onUpdate({ ...content, url: e.target.value })}
            placeholder="https://yourproject.com/..."
          />
        </div>
        <div className="space-y-1.5">
          <Label>Link Text (optional)</Label>
          <Input
            value={content.urlLabel ?? ""}
            onChange={(e) => onUpdate({ ...content, urlLabel: e.target.value })}
            placeholder="Portfolio, case study, GitHub..."
          />
        </div>
        <div className="space-y-1.5">
          <Label>Start Date</Label>
          <MonthYearPicker
            value={content.startDate || undefined}
            onChange={(v) => onUpdate({ ...content, startDate: v ?? "" })}
            placeholder="Start date"
          />
        </div>
        <div className="space-y-1.5">
          <Label>End Date</Label>
          <MonthYearPicker
            value={content.endDate || undefined}
            onChange={(v) => onUpdate({ ...content, endDate: v ?? "" })}
            allowPresent
            placeholder="End date"
          />
        </div>
      </div>

      <div className="space-y-2">
        {showTip && (
          <SectionTip>
            Lead with what it does and who it&apos;s for, then the tools or methods used. Include a link where possible — ATS scanners reward linked evidence. Bullets should show impact: people reached, time saved, or results.
          </SectionTip>
        )}
        <div className="flex items-center justify-between gap-2">
          <Label>Bullet Points</Label>
        </div>
        {(content.bullets ?? [""]).map((bullet, idx) => (
          <BulletRow
            key={idx}
            bullet={bullet}
            position={idx + 1}
            canRemove={(content.bullets?.length ?? 1) > 1}
            onChange={(v) => {
              const bullets = [...(content.bullets ?? [""])]
              bullets[idx] = v
              onUpdate({ ...content, bullets })
            }}
            onRemove={() => {
              const bullets = (content.bullets ?? []).filter((_, i) => i !== idx)
              onUpdate({ ...content, bullets })
            }}
            onEnter={() => {
              const bullets = [...(content.bullets ?? [""])]
              bullets.splice(idx + 1, 0, "")
              onUpdate({ ...content, bullets })
              pendingFocusRef.current = { index: idx + 1, caret: "start" }
            }}
            onRemoveEmpty={() => {
              const bullets = (content.bullets ?? []).filter((_, i) => i !== idx)
              onUpdate({ ...content, bullets })
              pendingFocusRef.current = { index: Math.max(0, idx - 1), caret: "end" }
            }}
            registerRef={(el) => {
              if (el) bulletFieldsRef.current.set(idx, el)
              else bulletFieldsRef.current.delete(idx)
            }}
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const bullets = [...(content.bullets ?? [""]), ""]
            onUpdate({ ...content, bullets })
          }}
        >
          <Plus className="h-3 w-3" /> Add bullet
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Technologies</Label>
        <div className="flex flex-wrap gap-2">
          {(content.technologies ?? []).map((tech, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs font-medium"
            >
              {tech}
              <button
                type="button"
                onClick={() => removeTechnology(idx)}
                aria-label={`Remove ${tech}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newTech}
            onChange={(e) => setNewTech(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addTechnology()
              }
            }}
            placeholder="Type a tool or method and press Enter"
            className="flex-1"
          />
          <Button variant="secondary" size="sm" onClick={addTechnology}>
            Add
          </Button>
        </div>
      </div>
    </Reorder.Item>
  )
}

function BulletRow({
  bullet,
  position,
  canRemove,
  onChange,
  onRemove,
  onEnter,
  onRemoveEmpty,
  registerRef,
}: {
  bullet: string
  position: number
  canRemove: boolean
  onChange: (v: string) => void
  onRemove: () => void
  onEnter: () => void
  onRemoveEmpty: () => void
  registerRef: (el: HTMLTextAreaElement | null) => void
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-2 text-xs text-muted-foreground">&bull;</span>
      <BulletTextarea
        value={bullet}
        onChange={onChange}
        onEnter={onEnter}
        onRemoveEmpty={canRemove ? onRemoveEmpty : undefined}
        registerRef={registerRef}
        placeholder="Describe what you built or achieved..."
      />
      {canRemove && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove bullet ${position}`}
          onClick={onRemove}
          className="mt-0.5"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}
