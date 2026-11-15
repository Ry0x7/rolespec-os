"use client"

import { useEffect, useRef } from "react"
import { Reorder, useDragControls } from "framer-motion"
import { useResumeStore, type Section, type SectionItem } from "../../hooks/use-resume-store"
import { BulletTextarea } from "./bullet-textarea"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Button } from "@/shared/ui/button"
import { MonthYearPicker } from "@/shared/ui/month-year-picker"
import { Plus, Trash2, GripVertical, Briefcase } from "lucide-react"
import { SectionTip } from "@/shared/ui/section-tip"
import { EmptyState } from "@/shared/components/empty-state"
import { SectionFindings, useSectionFindings } from "../section-findings"

interface ExperienceContent {
  company?: string
  role?: string
  location?: string
  startDate?: string
  endDate?: string
  current?: boolean
  bullets?: string[]
}

interface BulletItem {
  id: string
  text: string
}

interface Props {
  section: Section
}

export function ExperienceEditor({ section }: Props) {
  const updateSectionItem = useResumeStore((s) => s.updateSectionItem)
  const addSectionItem = useResumeStore((s) => s.addSectionItem)
  const removeSectionItem = useResumeStore((s) => s.removeSectionItem)
  const reorderSectionItems = useResumeStore((s) => s.reorderSectionItems)
  const findings = useSectionFindings(section.id)

  const sortedItems = [...section.items].sort((a, b) => a.order - b.order)

  function updateItem(itemId: string, content: ExperienceContent) {
    updateSectionItem(section.id, itemId, content as Record<string, unknown>)
  }

  function addExperience() {
    addSectionItem(section.id, {
      company: "",
      role: "",
      location: "",
      startDate: "",
      endDate: "",
      current: false,
      bullets: [""],
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
          icon={Briefcase}
          title="No experience yet — add your first"
        />
      )}
      {findings.length > 0 && <SectionFindings findings={findings} />}
      <Reorder.Group axis="y" values={sortedItems} onReorder={handleReorder} className="space-y-4">
        {sortedItems.map((item) => (
          <ExperienceCard
            key={item.id}
            item={item}
            showTip={findings.length === 0}
            onUpdate={(content) => updateItem(item.id, content)}
            onRemove={() => removeSectionItem(section.id, item.id)}
          />
        ))}
      </Reorder.Group>

      <Button variant="outline" size="sm" onClick={addExperience} className="w-full">
        <Plus className="h-3.5 w-3.5" /> Add Experience
      </Button>
    </div>
  )
}

function ExperienceCard({
  item,
  showTip,
  onUpdate,
  onRemove,
}: {
  item: SectionItem
  showTip: boolean
  onUpdate: (content: ExperienceContent) => void
  onRemove: () => void
}) {
  const controls = useDragControls()
  const content = item.content as unknown as ExperienceContent
  const bullets = content.bullets ?? [""]

  // Stable per-bullet ids that travel with a bullet across reorders.
  // Index-derived ids regenerate positionally on every render, which breaks
  // framer-motion's mid-drag value tracking (the drag stalled after one swap).
  // The ref keeps an id per bullet; reorder/remove handlers move ids with
  // their bullet, and this render-time sync covers external length changes
  // (add bullet, AI rewrites).
  //
  // `react-hooks/react-compiler` is suppressed rather than satisfied here, and
  // that is a deliberate, narrow choice. Writing a ref during render is unsafe
  // under StrictMode's double invoke and concurrent re-renders: a discarded
  // render pass can still advance `bulletIdSeq`, so ids are not guaranteed
  // reproducible. The correct fix is to hold these ids in the resume store
  // alongside the bullets they belong to, so they are data rather than a render
  // side effect. That is a store-shape change, and the behaviour it has to
  // preserve — an in-flight framer-motion drag surviving a reorder — cannot be
  // verified by the jsdom suite; it needs a real browser against a seeded
  // account. Left as-is until it can be changed and checked together, because
  // the failure mode of getting it wrong (drag silently stalling again) is worse
  // than the failure mode of the current code.
  /* eslint-disable react-hooks/refs -- see the note above; needs a store change plus browser verification */
  const bulletIdSeq = useRef(0)
  const bulletIdsRef = useRef<string[]>([])
  while (bulletIdsRef.current.length < bullets.length) {
    bulletIdsRef.current.push(`${item.id}-bl${bulletIdSeq.current++}`)
  }
  if (bulletIdsRef.current.length > bullets.length) {
    bulletIdsRef.current = bulletIdsRef.current.slice(0, bullets.length)
  }
  const bulletIds = bulletIdsRef.current
  const bulletItems: BulletItem[] = bullets.map((text, i) => ({
    id: bulletIds[i],
    text,
  }))
  /* eslint-enable react-hooks/refs */

  // Focus plumbing for the Enter / Backspace bullet gestures, keyed by the same
  // synthetic bullet ids the Reorder.Group uses. The target is recorded in the
  // handler and consumed after the re-render that created (or removed) the row.
  const bulletFieldsRef = useRef(new Map<string, HTMLTextAreaElement>())
  const pendingFocusRef = useRef<{ id: string; caret: "start" | "end" } | null>(null)

  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    const el = bulletFieldsRef.current.get(pending.id)
    if (!el) return
    pendingFocusRef.current = null
    el.focus()
    const pos = pending.caret === "end" ? el.value.length : 0
    el.setSelectionRange(pos, pos)
  })

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
            {content.company || "New Position"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${content.company || "position"}`}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5 text-error" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Company</Label>
          <Input
            value={content.company ?? ""}
            onChange={(e) =>
              onUpdate({ ...content, company: e.target.value })
            }
            placeholder="Acme Inc."
          />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Input
            value={content.role ?? ""}
            onChange={(e) =>
              onUpdate({ ...content, role: e.target.value })
            }
            placeholder="e.g. Store Manager"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Location</Label>
          <Input
            value={content.location ?? ""}
            onChange={(e) =>
              onUpdate({ ...content, location: e.target.value })
            }
            placeholder="Remote"
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
            value={content.current ? "Present" : content.endDate || undefined}
            onChange={(v) =>
              onUpdate({
                ...content,
                endDate: v === "Present" ? "" : (v ?? ""),
                current: v === "Present",
              })
            }
            allowPresent
            placeholder="End date"
          />
        </div>
      </div>

      <div className="space-y-2">
        {showTip && (
          <SectionTip>
            Start each bullet with a strong action verb (Built, Led, Reduced, Shipped). Quantify impact: <em>&ldquo;Reduced patient wait times by 35%&rdquo;</em> beats <em>&ldquo;Improved performance&rdquo;</em>. Aim for 3–5 bullets per role.
          </SectionTip>
        )}
        <div className="flex items-center justify-between gap-2">
          <Label>Bullet Points</Label>
        </div>
        <Reorder.Group
          axis="y"
          values={bulletIds}
          onReorder={(newIds: string[]) => {
            const textById = new Map(bulletIds.map((id, i) => [id, bullets[i]]))
            bulletIdsRef.current = newIds
            onUpdate({
              ...content,
              bullets: newIds.map((id) => textById.get(id) ?? ""),
            })
          }}
          className="space-y-2"
        >
          {bulletItems.map((bulletItem, idx) => (
            <BulletRow
              key={bulletItem.id}
              bulletItem={bulletItem}
              position={idx + 1}
              canRemove={bullets.length > 1}
              onChange={(v) => {
                const newBullets = [...bullets]
                newBullets[idx] = v
                onUpdate({ ...content, bullets: newBullets })
              }}
              onRemove={() => {
                bulletIdsRef.current = bulletIds.filter((_, i) => i !== idx)
                const newBullets = bullets.filter((_, i) => i !== idx)
                onUpdate({ ...content, bullets: newBullets })
              }}
              onEnter={() => {
                const newId = `${item.id}-bl${bulletIdSeq.current++}`
                bulletIdsRef.current = [
                  ...bulletIds.slice(0, idx + 1),
                  newId,
                  ...bulletIds.slice(idx + 1),
                ]
                const newBullets = [...bullets]
                newBullets.splice(idx + 1, 0, "")
                onUpdate({ ...content, bullets: newBullets })
                pendingFocusRef.current = { id: newId, caret: "start" }
              }}
              onRemoveEmpty={() => {
                const neighbourId = idx > 0 ? bulletIds[idx - 1] : bulletIds[idx + 1]
                bulletIdsRef.current = bulletIds.filter((_, i) => i !== idx)
                onUpdate({ ...content, bullets: bullets.filter((_, i) => i !== idx) })
                if (neighbourId) {
                  pendingFocusRef.current = { id: neighbourId, caret: "end" }
                }
              }}
              registerRef={(el) => {
                if (el) bulletFieldsRef.current.set(bulletItem.id, el)
                else bulletFieldsRef.current.delete(bulletItem.id)
              }}
            />
          ))}
        </Reorder.Group>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onUpdate({ ...content, bullets: [...bullets, ""] })
          }}
        >
          <Plus className="h-3 w-3" /> Add bullet
        </Button>
      </div>
    </Reorder.Item>
  )
}

function BulletRow({
  bulletItem,
  position,
  canRemove,
  onChange,
  onRemove,
  onEnter,
  onRemoveEmpty,
  registerRef,
}: {
  bulletItem: BulletItem
  position: number
  canRemove: boolean
  onChange: (v: string) => void
  onRemove: () => void
  onEnter: () => void
  onRemoveEmpty: () => void
  registerRef: (el: HTMLTextAreaElement | null) => void
}) {
  const controls = useDragControls()

  return (
    <Reorder.Item value={bulletItem.id} dragListener={false} dragControls={controls}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onPointerDown={(e) => controls.start(e)}
          className="mt-2 cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground"
          aria-label={`Drag to reorder bullet ${position}`}
          title="Drag to reorder"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="mt-2 text-xs text-muted-foreground">&bull;</span>
        <BulletTextarea
          value={bulletItem.text}
          onChange={onChange}
          onEnter={onEnter}
          onRemoveEmpty={canRemove ? onRemoveEmpty : undefined}
          registerRef={registerRef}
          placeholder="Achieved X by doing Y, resulting in Z"
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
    </Reorder.Item>
  )
}
