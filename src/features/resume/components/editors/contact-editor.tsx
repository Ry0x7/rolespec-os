"use client"

import { useResumeStore, type Section } from "../../hooks/use-resume-store"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { SectionTip } from "@/shared/ui/section-tip"
import { looksLikeUrl, normalizeUrl } from "@/shared/lib/url"
import { SectionFindings, useSectionFindings } from "../section-findings"

interface Props {
  section: Section
}

export function ContactEditor({ section }: Props) {
  const updateSectionItem = useResumeStore((s) => s.updateSectionItem)
  const addSectionItem = useResumeStore((s) => s.addSectionItem)
  const findings = useSectionFindings(section.id)

  const item = section.items[0]
  const content = (item?.content ?? {}) as Record<string, string>

  function update(field: string, value: string) {
    const updated = { ...content, [field]: value }
    if (item) {
      updateSectionItem(section.id, item.id, updated)
    } else {
      addSectionItem(section.id, updated)
    }
  }

  function normalizeOnBlur(field: string) {
    const current = content[field] ?? ""
    // Only touch values that actually look like URLs, so free-form text is not
    // turned into "https://some note".
    if (!looksLikeUrl(current)) return
    const normalized = normalizeUrl(current)
    if (normalized !== current) update(field, normalized)
  }

  return (
    <div className="space-y-4">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="fullName">Full Name</Label>
        <Input
          id="fullName"
          value={content.fullName ?? ""}
          onChange={(e) => update("fullName", e.target.value)}
          placeholder="John Doe"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="jobTitle">Job Title</Label>
        <Input
          id="jobTitle"
          value={content.jobTitle ?? ""}
          onChange={(e) => update("jobTitle", e.target.value)}
          placeholder="e.g. Registered Nurse"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={content.email ?? ""}
          onChange={(e) => update("email", e.target.value)}
          placeholder="john@example.com"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          value={content.phone ?? ""}
          onChange={(e) => update("phone", e.target.value)}
          placeholder="+1 234 567 890"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          value={content.location ?? ""}
          onChange={(e) => update("location", e.target.value)}
          placeholder="San Francisco, CA"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="linkedin">LinkedIn</Label>
        <Input
          id="linkedin"
          value={content.linkedin ?? ""}
          onChange={(e) => update("linkedin", e.target.value)}
          onBlur={() => normalizeOnBlur("linkedin")}
          placeholder="linkedin.com/in/johndoe"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="github">GitHub</Label>
        <Input
          id="github"
          value={content.github ?? ""}
          onChange={(e) => update("github", e.target.value)}
          onBlur={() => normalizeOnBlur("github")}
          placeholder="github.com/johndoe"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="website">Website</Label>
        <Input
          id="website"
          value={content.website ?? ""}
          onChange={(e) => update("website", e.target.value)}
          onBlur={() => normalizeOnBlur("website")}
          placeholder="johndoe.dev"
        />
      </div>
    </div>
    {findings.length > 0 ? (
      <SectionFindings findings={findings} />
    ) : (
      <SectionTip>
        Use a professional email (avoid nicknames). Paste plain URLs into LinkedIn, Website — and GitHub if you&rsquo;re in a technical field — they are shortened automatically on your resume (e.g. linkedin.com/in/johndoe) and stay clickable.
      </SectionTip>
    )}
    </div>
  )
}
