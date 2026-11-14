"use client"

import { useState } from "react"
import { useResumeStore, type Section } from "../../hooks/use-resume-store"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Button } from "@/shared/ui/button"
import { Plus, X, Wrench } from "lucide-react"
import { SectionTip } from "@/shared/ui/section-tip"
import { EmptyState } from "@/shared/components/empty-state"
import { SectionFindings, useSectionFindings } from "../section-findings"

interface SkillsContent {
  category?: string
  skills?: string[]
}

interface Props {
  section: Section
}

export function SkillsEditor({ section }: Props) {
  const updateSectionItem = useResumeStore((s) => s.updateSectionItem)
  const addSectionItem = useResumeStore((s) => s.addSectionItem)
  const removeSectionItem = useResumeStore((s) => s.removeSectionItem)
  const missingKeywords = useResumeStore((s) => s.missingKeywords)
  const findings = useSectionFindings(section.id)

  // All skills already present across every category (lowercase for comparison)
  const addedSkillsLower = new Set(
    section.items.flatMap((item) => {
      const c = item.content as unknown as SkillsContent
      return (c.skills ?? []).map((s) => s.toLowerCase())
    })
  )

  // Keywords not yet added anywhere in this section
  const unaddedKeywords = missingKeywords.filter(
    (kw) => !addedSkillsLower.has(kw.toLowerCase())
  )

  function addCategory() {
    addSectionItem(section.id, { category: "", skills: [] })
  }

  // The Skills editor is the one place a missing keyword becomes a click,
  // so the chip set renders once per section (not once per category, which
  // is how 20 keywords across 2 categories used to render as 40 chips) and
  // always lands the addition on the first category — creating one first if
  // the section is still empty, so the action never has nowhere to go.
  function addKeyword(keyword: string) {
    const first = section.items[0]
    if (!first) {
      addSectionItem(section.id, { category: "", skills: [keyword] })
      return
    }
    const content = first.content as unknown as SkillsContent
    updateSectionItem(section.id, first.id, {
      ...content,
      skills: [...(content.skills ?? []), keyword],
    } as Record<string, unknown>)
  }

  return (
    <div className="space-y-4">
      {findings.length > 0 ? (
        <SectionFindings findings={findings} />
      ) : (
        <SectionTip>
          Group skills by category (e.g. Core Skills, Tools, Certifications). Only list skills you can comfortably discuss in an interview. Match keywords from job descriptions to pass ATS filters.
        </SectionTip>
      )}
      {section.items.length === 0 && (
        <EmptyState
          variant="bare"
          icon={Wrench}
          title="No skill categories yet — add your first"
        />
      )}
      {unaddedKeywords.length > 0 && (
        <SuggestedKeywords keywords={unaddedKeywords} onAdd={addKeyword} />
      )}
      {section.items.map((item) => {
        const content = item.content as unknown as SkillsContent
        return (
          <SkillCategory
            key={item.id}
            content={content}
            onUpdate={(c) =>
              updateSectionItem(section.id, item.id, c as Record<string, unknown>)
            }
            onRemove={() => removeSectionItem(section.id, item.id)}
          />
        )
      })}

      <Button variant="outline" size="sm" onClick={addCategory} className="w-full">
        <Plus className="h-3.5 w-3.5" /> Add Skill Category
      </Button>
    </div>
  )
}

function SuggestedKeywords({
  keywords,
  onAdd,
}: {
  keywords: string[]
  onAdd: (keyword: string) => void
}) {
  return (
    <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-[11px] font-medium text-muted-foreground">
        From the job description — click to add to your skills:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {keywords.map((kw) => (
          <button
            key={kw}
            type="button"
            onClick={() => onAdd(kw)}
            aria-label={`Add "${kw}" to skills`}
            className="inline-flex items-center gap-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
          >
            <Plus className="h-2.5 w-2.5" aria-hidden="true" />
            {kw}
          </button>
        ))}
      </div>
    </div>
  )
}

function SkillCategory({
  content,
  onUpdate,
  onRemove,
}: {
  content: SkillsContent
  onUpdate: (content: SkillsContent) => void
  onRemove: () => void
}) {
  const [newSkill, setNewSkill] = useState("")

  function addSkill() {
    if (!newSkill.trim()) return
    onUpdate({ ...content, skills: [...(content.skills ?? []), newSkill.trim()] })
    setNewSkill("")
  }

  function removeSkill(idx: number) {
    onUpdate({
      ...content,
      skills: (content.skills ?? []).filter((_, i) => i !== idx),
    })
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex-1 space-y-1.5">
          <Label>Category</Label>
          <Input
            value={content.category ?? ""}
            onChange={(e) => onUpdate({ ...content, category: e.target.value })}
            placeholder="e.g. Core Skills, Tools, Certifications"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${content.category || "skill category"}`}
          onClick={onRemove}
          className="ml-2 mt-5"
        >
          <X className="h-3.5 w-3.5 text-error" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(content.skills ?? []).map((skill, idx) => (
          <span
            key={idx}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs font-medium"
          >
            {skill}
            <button
              type="button"
              onClick={() => removeSkill(idx)}
              aria-label={`Remove ${skill}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={newSkill}
          onChange={(e) => setNewSkill(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addSkill()
            }
          }}
          placeholder="Type a skill and press Enter"
          className="flex-1"
        />
        <Button variant="secondary" size="sm" onClick={addSkill}>
          Add
        </Button>
      </div>
    </div>
  )
}
