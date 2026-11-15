"use client"

import { useState } from "react"
import { AnimatePresence, motion, Reorder, useDragControls, useReducedMotion } from "framer-motion"
import { useResumeStore, type Section, type SectionItem } from "../../hooks/use-resume-store"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Button } from "@/shared/ui/button"
import { MonthYearPicker } from "@/shared/ui/month-year-picker"
import { Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Award } from "lucide-react"
import { SectionTip } from "@/shared/ui/section-tip"
import { EmptyState } from "@/shared/components/empty-state"
import { SectionFindings, useSectionFindings } from "../section-findings"

interface CertificationContent {
  name?: string
  organization?: string
  dateObtained?: string
  expirationDate?: string
  credentialId?: string
}

/** A freshly added card has no content yet — start it expanded so the
 *  organization and date fields are visible instead of hidden. */
function isBlank(content: CertificationContent) {
  return !(
    content.name ||
    content.organization ||
    content.dateObtained ||
    content.expirationDate ||
    content.credentialId
  )
}

interface Props {
  section: Section
}

export function CertificationsEditor({ section }: Props) {
  const updateSectionItem = useResumeStore((s) => s.updateSectionItem)
  const addSectionItem = useResumeStore((s) => s.addSectionItem)
  const removeSectionItem = useResumeStore((s) => s.removeSectionItem)
  const reorderSectionItems = useResumeStore((s) => s.reorderSectionItems)
  const findings = useSectionFindings(section.id)

  const sortedItems = [...section.items].sort((a, b) => a.order - b.order)

  function updateItem(itemId: string, content: CertificationContent) {
    updateSectionItem(section.id, itemId, content as Record<string, unknown>)
  }

  function addCertification() {
    addSectionItem(section.id, {
      name: "",
      organization: "",
      dateObtained: "",
      expirationDate: "",
      credentialId: "",
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
          Include the issuing organization and date. Certifications under 2 years old carry the most weight. Active credentials (RN, CPA, PMP, AWS) are especially valued by ATS systems.
        </SectionTip>
      )}
      {sortedItems.length === 0 && (
        <EmptyState
          variant="bare"
          icon={Award}
          title="No certifications yet — add your first"
        />
      )}
      <Reorder.Group axis="y" values={sortedItems} onReorder={handleReorder} className="space-y-4">
        {sortedItems.map((item) => (
          <CertificationCard
            key={item.id}
            item={item}
            onUpdate={(content) => updateItem(item.id, content)}
            onRemove={() => removeSectionItem(section.id, item.id)}
          />
        ))}
      </Reorder.Group>

      <Button variant="outline" size="sm" onClick={addCertification} className="w-full">
        <Plus className="h-3.5 w-3.5" /> Add Certification
      </Button>
    </div>
  )
}

function CertificationCard({
  item,
  onUpdate,
  onRemove,
}: {
  item: SectionItem
  onUpdate: (content: CertificationContent) => void
  onRemove: () => void
}) {
  const controls = useDragControls()
  const content = item.content as unknown as CertificationContent
  const [expanded, setExpanded] = useState(() => isBlank(content))
  const shouldReduceMotion = useReducedMotion()

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      className="space-y-3 rounded-md border border-border p-4 bg-card"
    >
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
        <input
          value={content.name ?? ""}
          onChange={(e) => onUpdate({ ...content, name: e.target.value })}
          placeholder="Certification Name"
          className="bg-transparent border-none outline-none text-sm font-medium w-full placeholder:text-muted-foreground focus:outline-none"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={`cert-details-${item.id}`}
          aria-label={expanded ? "Collapse details" : "Expand details"}
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hover:bg-destructive/10"
          aria-label={`Remove ${content.name || "certification"}`}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive hover:text-destructive" />
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="cert-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div id={`cert-details-${item.id}`} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Issuing Organization</Label>
                <Input
                  value={content.organization ?? ""}
                  onChange={(e) => onUpdate({ ...content, organization: e.target.value })}
                  placeholder="e.g. American Red Cross"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Date Obtained</Label>
                <MonthYearPicker
                  value={content.dateObtained || undefined}
                  onChange={(v) => onUpdate({ ...content, dateObtained: v ?? "" })}
                  placeholder="Date obtained"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Expiration Date (optional)</Label>
                <MonthYearPicker
                  value={content.expirationDate || undefined}
                  onChange={(v) => onUpdate({ ...content, expirationDate: v ?? "" })}
                  placeholder="Expiration date"
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Credential ID (optional)</Label>
                <Input
                  value={content.credentialId ?? ""}
                  onChange={(e) => onUpdate({ ...content, credentialId: e.target.value })}
                  placeholder="ABC-123-XYZ"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}
