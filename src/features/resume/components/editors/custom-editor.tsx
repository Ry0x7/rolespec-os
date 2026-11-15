"use client"

import { Reorder, useDragControls } from "framer-motion"
import { useResumeStore, type Section, type SectionItem } from "../../hooks/use-resume-store"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Button } from "@/shared/ui/button"
import { Plus, Trash2, GripVertical, FileText } from "lucide-react"
import { EmptyState } from "@/shared/components/empty-state"

interface CustomContent {
  title?: string
  content?: string
}

interface Props {
  section: Section
}

export function CustomEditor({ section }: Props) {
  const updateSectionItem = useResumeStore((s) => s.updateSectionItem)
  const addSectionItem = useResumeStore((s) => s.addSectionItem)
  const removeSectionItem = useResumeStore((s) => s.removeSectionItem)
  const reorderSectionItems = useResumeStore((s) => s.reorderSectionItems)

  const sortedItems = [...section.items].sort((a, b) => a.order - b.order)

  function updateItem(itemId: string, content: CustomContent) {
    updateSectionItem(section.id, itemId, content as Record<string, unknown>)
  }

  function addEntry() {
    addSectionItem(section.id, {
      title: "",
      content: "",
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
          icon={FileText}
          title="No entries yet — add your first"
        />
      )}
      <Reorder.Group axis="y" values={sortedItems} onReorder={handleReorder} className="space-y-4">
        {sortedItems.map((item) => (
          <CustomCard
            key={item.id}
            item={item}
            onUpdate={(content) => updateItem(item.id, content)}
            onRemove={() => removeSectionItem(section.id, item.id)}
          />
        ))}
      </Reorder.Group>

      <Button variant="outline" size="sm" onClick={addEntry} className="w-full">
        <Plus className="h-3.5 w-3.5" /> Add Entry
      </Button>
    </div>
  )
}

function CustomCard({
  item,
  onUpdate,
  onRemove,
}: {
  item: SectionItem
  onUpdate: (content: CustomContent) => void
  onRemove: () => void
}) {
  const controls = useDragControls()
  const content = item.content as unknown as CustomContent

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
            {content.title || "New Entry"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${content.title || "entry"}`}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5 text-error" />
        </Button>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input
            value={content.title ?? ""}
            onChange={(e) => onUpdate({ ...content, title: e.target.value })}
            placeholder="Section heading or entry title"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Content</Label>
          <textarea
            value={content.content ?? ""}
            onChange={(e) => onUpdate({ ...content, content: e.target.value })}
            placeholder="Write your content here. Use new lines to separate paragraphs..."
            rows={4}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>
      </div>
    </Reorder.Item>
  )
}
