export interface BulletDiff {
  original?: string
  tailored?: string
  status: "rewritten" | "removed" | "added" | "unchanged"
  roleAndCompany?: string
}

export interface SectionDiff {
  title: string
  type: string
  changes: BulletDiff[]
}

export interface ResumeComparison {
  hasSource: boolean
  sourceTitle?: string
  tailoredTitle?: string
  summaryDiff?: {
    original?: string
    tailored?: string
    status: "rewritten" | "added" | "unchanged"
  }
  skillsDiff?: {
    original: string[]
    tailored: string[]
  }
  sections: SectionDiff[]
  stats: {
    rewrittenCount: number
    removedCount: number
    addedCount: number
    unchangedCount: number
  }
}

interface ResumeWithSections {
  id: string
  title: string
  sections: Array<{
    type: string
    title: string
    items: Array<{
      content: Record<string, unknown>
    }>
  }>
}

export function computeResumeDiff(
  source: ResumeWithSections,
  tailored: ResumeWithSections
): ResumeComparison {
  let rewrittenCount = 0
  let removedCount = 0
  let addedCount = 0
  let unchangedCount = 0

  // 1. Summary Diff
  let summaryDiff: ResumeComparison["summaryDiff"] | undefined = undefined
  const sourceSummarySec = source.sections.find((s) => s.type === "SUMMARY")
  const tailoredSummarySec = tailored.sections.find((s) => s.type === "SUMMARY")
  const sourceSummaryText = typeof sourceSummarySec?.items[0]?.content?.text === "string" ? sourceSummarySec.items[0].content.text.trim() : ""
  const tailoredSummaryText = typeof tailoredSummarySec?.items[0]?.content?.text === "string" ? tailoredSummarySec.items[0].content.text.trim() : ""

  if (sourceSummaryText || tailoredSummaryText) {
    if (!sourceSummaryText && tailoredSummaryText) {
      summaryDiff = { tailored: tailoredSummaryText, status: "added" }
      addedCount++
    } else if (sourceSummaryText !== tailoredSummaryText) {
      summaryDiff = { original: sourceSummaryText, tailored: tailoredSummaryText, status: "rewritten" }
      rewrittenCount++
    } else {
      summaryDiff = { original: sourceSummaryText, tailored: tailoredSummaryText, status: "unchanged" }
      unchangedCount++
    }
  }

  // 2. Skills Diff
  let skillsDiff: ResumeComparison["skillsDiff"] | undefined = undefined
  const sourceSkillsSec = source.sections.find((s) => s.type === "SKILLS")
  const tailoredSkillsSec = tailored.sections.find((s) => s.type === "SKILLS")
  const sourceSkills = (sourceSkillsSec?.items ?? []).flatMap((it) =>
    Array.isArray(it.content?.skills) ? (it.content.skills as string[]) : []
  )
  const tailoredSkills = (tailoredSkillsSec?.items ?? []).flatMap((it) =>
    Array.isArray(it.content?.skills) ? (it.content.skills as string[]) : []
  )
  if (sourceSkills.length > 0 || tailoredSkills.length > 0) {
    skillsDiff = {
      original: sourceSkills,
      tailored: tailoredSkills,
    }
  }

  // 3. Experience & Project Sections Diff
  const sections: SectionDiff[] = []
  const experienceTypes = ["EXPERIENCE", "PROJECTS"]

  for (const expType of experienceTypes) {
    const srcSec = source.sections.find((s) => s.type === expType)
    const tailSec = tailored.sections.find((s) => s.type === expType)
    if (!srcSec && !tailSec) continue

    const changes: BulletDiff[] = []
    const srcItems = srcSec?.items ?? []
    const tailItems = tailSec?.items ?? []

    srcItems.forEach((srcItem, itemIdx) => {
      const tailItem = tailItems[itemIdx]
      const role = typeof srcItem.content?.role === "string" ? srcItem.content.role : ""
      const company = typeof srcItem.content?.company === "string" ? srcItem.content.company : ""
      const roleAndCompany = [role, company].filter(Boolean).join(" at ") || "Role"

      const srcBullets = Array.isArray(srcItem.content?.bullets) ? (srcItem.content.bullets as string[]) : []
      const tailBullets = tailItem && Array.isArray(tailItem.content?.bullets) ? (tailItem.content.bullets as string[]) : []

      srcBullets.forEach((srcBullet, bIdx) => {
        const tailBullet = tailBullets[bIdx]
        if (!tailBullet) {
          changes.push({
            original: srcBullet,
            status: "removed",
            roleAndCompany,
          })
          removedCount++
        } else if (tailBullet !== srcBullet) {
          changes.push({
            original: srcBullet,
            tailored: tailBullet,
            status: "rewritten",
            roleAndCompany,
          })
          rewrittenCount++
        } else {
          changes.push({
            original: srcBullet,
            tailored: tailBullet,
            status: "unchanged",
            roleAndCompany,
          })
          unchangedCount++
        }
      })

      // Any extra bullets in tailored
      if (tailBullets.length > srcBullets.length) {
        tailBullets.slice(srcBullets.length).forEach((extra) => {
          changes.push({
            tailored: extra,
            status: "added",
            roleAndCompany,
          })
          addedCount++
        })
      }
    })

    if (changes.length > 0) {
      sections.push({
        title: tailSec?.title ?? srcSec?.title ?? expType,
        type: expType,
        changes,
      })
    }
  }

  return {
    hasSource: true,
    sourceTitle: source.title,
    tailoredTitle: tailored.title,
    summaryDiff,
    skillsDiff,
    sections,
    stats: {
      rewrittenCount,
      removedCount,
      addedCount,
      unchangedCount,
    },
  }
}
