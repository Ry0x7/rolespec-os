"use client"

import { useResumeStore, type Section } from "../../hooks/use-resume-store"
import { Label } from "@/shared/ui/label"
import { SectionTip } from "@/shared/ui/section-tip"
import { SectionFindings, useSectionFindings } from "../section-findings"

interface Props {
  section: Section
}

export function SummaryEditor({ section }: Props) {
  const updateSectionItem = useResumeStore((s) => s.updateSectionItem)
  const addSectionItem = useResumeStore((s) => s.addSectionItem)
  const findings = useSectionFindings(section.id)

  const item = section.items[0]
  const content = (item?.content ?? {}) as { text?: string }

  const MAX_LENGTH = 500

  function update(value: string) {
    if (value.length > MAX_LENGTH) return
    const updated = { text: value }
    if (item) {
      updateSectionItem(section.id, item.id, updated)
    } else {
      addSectionItem(section.id, updated)
    }
  }

  const charCount = content.text?.length ?? 0
  const isNearLimit = charCount >= MAX_LENGTH * 0.9

  return (
    <div className="space-y-2">
      {findings.length > 0 ? (
        <SectionFindings findings={findings} />
      ) : (
        <SectionTip>
          Write 2–3 sentences: your title + years of experience, your top skills, and one standout achievement. Skip &ldquo;I&rdquo; — start with your title. Example: <em>&ldquo;Registered nurse with 6 years in acute care. Specialized in pediatric ICU. Cut medication errors 30% at Mercy General.&rdquo;</em>
        </SectionTip>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="summary">Professional Summary</Label>
        <textarea
          id="summary"
          value={content.text ?? ""}
          onChange={(e) => update(e.target.value)}
          maxLength={MAX_LENGTH}
          placeholder="Experienced professional with 5+ years delivering measurable results in your field..."
          rows={5}
          className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
        <p className={`text-xs ${isNearLimit ? "text-amber-500" : "text-muted-foreground"}`}>
          {charCount}/{MAX_LENGTH} characters
        </p>
      </div>
    </div>
  )
}
