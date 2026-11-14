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

interface BulletChange {
  original?: string
  tailored?: string
  status: BulletDiff["status"]
}

/**
 * Pair bullets without letting one removal shift every later bullet into a
 * fake "rewrite". Exact matches anchor both lists, and only the gaps between
 * anchors can be rewrites; leftovers are removals or additions.
 */
export function diffBullets(original: readonly string[], tailored: readonly string[]): BulletChange[] {
  // Longest common subsequence of exact bullet text.
  const rows = original.length + 1
  const cols = tailored.length + 1
  const lcs = Array.from({ length: rows }, () => new Uint16Array(cols))
  for (let i = original.length - 1; i >= 0; i -= 1) {
    for (let j = tailored.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        original[i] === tailored[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const anchors: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < original.length && j < tailored.length) {
    if (original[i] === tailored[j]) {
      anchors.push([i, j])
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i += 1
    } else {
      j += 1
    }
  }
  anchors.push([original.length, tailored.length])

  const changes: BulletChange[] = []
  let prevI = 0
  let prevJ = 0
  for (const [anchorI, anchorJ] of anchors) {
    const oldGap = original.slice(prevI, anchorI)
    const newGap = tailored.slice(prevJ, anchorJ)
    const paired = Math.min(oldGap.length, newGap.length)
    for (let n = 0; n < paired; n += 1) {
      changes.push({ original: oldGap[n], tailored: newGap[n], status: "rewritten" })
    }
    for (let n = paired; n < oldGap.length; n += 1) {
      changes.push({ original: oldGap[n], status: "removed" })
    }
    for (let n = paired; n < newGap.length; n += 1) {
      changes.push({ tailored: newGap[n], status: "added" })
    }
    if (anchorI < original.length) {
      changes.push({ original: original[anchorI], tailored: tailored[anchorJ], status: "unchanged" })
    }
    prevI = anchorI + 1
    prevJ = anchorJ + 1
  }
  return changes
}

/** Identity of an experience/project item, used to align removed roles. */
function itemKey(content: Record<string, unknown>): string {
  return [content.role, content.company, content.name]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join("|")
    .toLowerCase()
}

/**
 * What actually happened to the skills list. The tailoring pass may only
 * reorder it; later edits can change the set. An identical list is
 * "unchanged", not "reordered" — otherwise the comparison claims an edit the
 * user never made.
 */
export function skillsDiffStatus(
  original: readonly string[],
  tailored: readonly string[]
): "unchanged" | "reordered" | "edited" {
  if (
    original.length === tailored.length &&
    original.every((skill, index) => skill === tailored[index])
  ) {
    return "unchanged"
  }
  const left = [...original].sort()
  const right = [...tailored].sort()
  const sameSet =
    left.length === right.length && left.every((skill, index) => skill === right[index])
  return sameSet ? "reordered" : "edited"
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
    const tailItems = [...(tailSec?.items ?? [])]

    // Pair roles by identity before comparing bullets. Index pairing turned a
    // dropped whole role into a rewrite of the role that shifted into its
    // place, and every later bullet with it.
    const partnerFor = (content: Record<string, unknown>): (typeof tailItems)[number] | undefined => {
      const key = itemKey(content)
      const index = tailItems.findIndex((item) => itemKey(item.content) === key)
      if (index === -1) return undefined
      return tailItems.splice(index, 1)[0]
    }

    srcItems.forEach((srcItem) => {
      const tailItem = partnerFor(srcItem.content)
      const role = typeof srcItem.content?.role === "string" ? srcItem.content.role : ""
      const company = typeof srcItem.content?.company === "string" ? srcItem.content.company : ""
      const name = typeof srcItem.content?.name === "string" ? srcItem.content.name : ""
      const roleAndCompany = [role, company].filter(Boolean).join(" at ") || name || "Role"

      const srcBullets = Array.isArray(srcItem.content?.bullets) ? (srcItem.content.bullets as string[]) : []
      const tailBullets = tailItem && Array.isArray(tailItem.content?.bullets) ? (tailItem.content.bullets as string[]) : []

      for (const bullet of diffBullets(srcBullets, tailBullets)) {
        changes.push({ ...bullet, roleAndCompany })
        if (bullet.status === "rewritten") rewrittenCount++
        else if (bullet.status === "removed") removedCount++
        else if (bullet.status === "added") addedCount++
        else unchangedCount++
      }
    })

    // Roles left in the tailored copy without a source counterpart are new
    // items; the tailoring path never creates one, but the comparison should
    // still report an edit made later in the editor.
    for (const tailItem of tailItems) {
      const role = typeof tailItem.content?.role === "string" ? tailItem.content.role : ""
      const company = typeof tailItem.content?.company === "string" ? tailItem.content.company : ""
      const name = typeof tailItem.content?.name === "string" ? tailItem.content.name : ""
      const roleAndCompany = [role, company].filter(Boolean).join(" at ") || name || "Role"
      const bullets = Array.isArray(tailItem.content?.bullets) ? (tailItem.content.bullets as string[]) : []
      for (const bullet of bullets) {
        changes.push({ tailored: bullet, status: "added", roleAndCompany })
        addedCount++
      }
    }

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
