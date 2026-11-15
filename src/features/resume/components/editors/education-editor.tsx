"use client"

import { Reorder, useDragControls } from "framer-motion"
import { useResumeStore, type Section, type SectionItem } from "../../hooks/use-resume-store"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Button } from "@/shared/ui/button"
import { MonthYearPicker } from "@/shared/ui/month-year-picker"
import { Plus, Trash2, GripVertical, GraduationCap } from "lucide-react"
import { SectionTip } from "@/shared/ui/section-tip"
import { EmptyState } from "@/shared/components/empty-state"
import { SectionFindings, useSectionFindings } from "../section-findings"

interface EducationContent {
  school?: string
  degree?: string
  field?: string
  startDate?: string
  endDate?: string
  gpa?: string
}

interface Props {
  section: Section
}

export function EducationEditor({ section }: Props) {
  const updateSectionItem = useResumeStore((s) => s.updateSectionItem)
  const addSectionItem = useResumeStore((s) => s.addSectionItem)
  const removeSectionItem = useResumeStore((s) => s.removeSectionItem)
  const reorderSectionItems = useResumeStore((s) => s.reorderSectionItems)
  const findings = useSectionFindings(section.id)

  const sortedItems = [...section.items].sort((a, b) => a.order - b.order)

  function updateItem(itemId: string, content: EducationContent) {
    updateSectionItem(section.id, itemId, content as Record<string, unknown>)
  }

  function addEducation() {
    addSectionItem(section.id, {
      school: "",
      degree: "",
      field: "",
      startDate: "",
      endDate: "",
      gpa: "",
    })
  }

  function handleReorder(newOrder: SectionItem[]) {
    const orderedIds = newOrder.map((item) => item.id)
    reorderSectionItems(section.id, orderedIds)
  }

  return (
    <div className="space-y-4">
      {findings.length > 0 ? (
        <SectionFindings findings={findings} />
      ) : (
        <SectionTip>
          List your highest degree first. GPA is optional — include it only if 3.5 or above. Relevant coursework or honors can go in a custom section.
        </SectionTip>
      )}
      {sortedItems.length === 0 && (
        <EmptyState
          variant="bare"
          icon={GraduationCap}
          title="No education yet — add your first"
        />
      )}
      <Reorder.Group axis="y" values={sortedItems} onReorder={handleReorder} className="space-y-4">
        {sortedItems.map((item) => (
          <EducationCard
            key={item.id}
            item={item}
            onUpdate={(content) => updateItem(item.id, content)}
            onRemove={() => removeSectionItem(section.id, item.id)}
          />
        ))}
      </Reorder.Group>

      <Button variant="outline" size="sm" onClick={addEducation} className="w-full">
        <Plus className="h-3.5 w-3.5" /> Add Education
      </Button>
    </div>
  )
}

function EducationCard({
  item,
  onUpdate,
  onRemove,
}: {
  item: SectionItem
  onUpdate: (content: EducationContent) => void
  onRemove: () => void
}) {
  const controls = useDragControls()
  const content = item.content as unknown as EducationContent

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
            {content.school || "New Education"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${content.school || "education entry"}`}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5 text-error" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>School / University</Label>
          <Input
            value={content.school ?? ""}
            onChange={(e) => onUpdate({ ...content, school: e.target.value })}
            placeholder="e.g. State University"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Degree</Label>
          <Input
            value={content.degree ?? ""}
            onChange={(e) => onUpdate({ ...content, degree: e.target.value })}
            placeholder="B.S."
          />
        </div>
        <div className="space-y-1.5">
          <Label>Field of Study</Label>
          <Input
            value={content.field ?? ""}
            onChange={(e) => onUpdate({ ...content, field: e.target.value })}
            placeholder="e.g. Nursing"
          />
        </div>
        <div className="space-y-1.5">
          <Label>GPA (optional)</Label>
          <Input
            value={content.gpa ?? ""}
            onChange={(e) => onUpdate({ ...content, gpa: e.target.value })}
            placeholder="3.8/4.0"
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
    </Reorder.Item>
  )
}
