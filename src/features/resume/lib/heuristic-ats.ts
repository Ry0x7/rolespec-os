import type { AnalysisMode, ATSAnalysisResult } from "../services/ats-analyze"
import type { Section } from "../hooks/use-resume-store"

/**
 * Offline heuristic ATS/quality score — no AI, no network, no key.
 *
 * Used as a fallback when the AI provider is missing (or over its daily
 * limit) so Analyze still returns something actionable, and as the
 * always-available path for users who never configure AI. Scores are
 * conservative by design: they measure structure present in the stored
 * sections only.
 */

const ACTION_VERBS = new Set(
  "led built shipped drove owned launched improved reduced increased designed delivered grew automated migrated scaled mentored managed created launched optimized".split(
    " "
  )
)

function sectionText(sections: Section[]): string {
  const parts: string[] = []
  for (const s of sections) {
    if (s.visible === false) continue
    parts.push(s.title)
    for (const item of s.items) {
      const c = item.content as Record<string, unknown>
      for (const v of Object.values(c)) {
        if (typeof v === "string") parts.push(v)
        else if (Array.isArray(v)) parts.push(v.filter((x) => typeof x === "string").join(" "))
      }
    }
  }
  return parts.join("\n")
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2)
}

export function heuristicAtsScore(
  sections: Section[],
  opts?: { jobDescription?: string; mode?: AnalysisMode }
): ATSAnalysisResult {
  const mode: AnalysisMode = opts?.mode ?? (opts?.jobDescription?.trim() ? "job-match" : "quality")
  const visible = sections.filter((s) => s.visible !== false)
  const byType = new Map(visible.map((s) => [s.type, s]))
  const text = sectionText(sections)
  const words = tokenize(text)

  // Completeness: contact + summary + experience + education + skills.
  let completeness = 20
  if (byType.has("CONTACT")) completeness += 16
  if (byType.has("SUMMARY")) completeness += 16
  if (byType.has("EXPERIENCE")) completeness += 16
  if (byType.has("EDUCATION")) completeness += 16
  if (byType.has("SKILLS")) completeness += 16
  completeness = Math.min(100, completeness)

  // Formatting: visible sections with titles, no empty sections.
  const emptySections = visible.filter((s) => s.items.length === 0).length
  const formatting = Math.max(40, 100 - emptySections * 15 - (visible.length === 0 ? 40 : 0))

  // Impact: bullets with action verbs and numbers.
  const bullets: string[] = []
  for (const s of visible) {
    for (const item of s.items) {
      const c = item.content as Record<string, unknown>
      const b = c.bullets
      if (Array.isArray(b)) bullets.push(...b.filter((x): x is string => typeof x === "string"))
    }
  }
  let strong = 0
  for (const b of bullets) {
    const first = b.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? ""
    const hasVerb = ACTION_VERBS.has(first)
    const hasNumber = /\d/.test(b)
    if (hasVerb && hasNumber) strong += 2
    else if (hasVerb || hasNumber) strong += 1
  }
  const impact =
    bullets.length === 0 ? 45 : Math.min(100, Math.round(45 + (strong / bullets.length) * 55))

  // Readability: penalize very long bullets / very long resume.
  const avgLen =
    bullets.length === 0 ? 0 : bullets.reduce((a, b) => a + b.length, 0) / bullets.length
  const readability =
    bullets.length === 0
      ? 60
      : Math.max(40, Math.min(95, avgLen > 220 ? 55 : avgLen > 160 ? 70 : 85))

  // Keywords: overlap of JD tokens with resume tokens (job-match only).
  let keywords: number | null = null
  let missingKeywords: string[] = []
  if (mode === "job-match" && opts?.jobDescription?.trim()) {
    const jdTokens = [...new Set(tokenize(opts.jobDescription))]
    const resumeSet = new Set(words)
    const stop = new Set(
      "and,the,for,with,you,will,our,are,has,have,that,this,from,role,team,work,ability,experience".split(",")
    )
    const meaningful = jdTokens.filter((t) => !stop.has(t)).slice(0, 40)
    const hits = meaningful.filter((t) => resumeSet.has(t))
    keywords =
      meaningful.length === 0
        ? 60
        : Math.round((hits.length / meaningful.length) * 100)
    missingKeywords = meaningful.filter((t) => !resumeSet.has(t)).slice(0, 12)
  }

  const scores: ATSAnalysisResult["scores"] = {
    formatting,
    keywords,
    impact,
    completeness,
    readability,
  }

  // Same weighting as the AI path (see ats-analyze.ts).
  const overallScore =
    mode === "quality"
      ? Math.round(impact * 0.35 + readability * 0.25 + formatting * 0.2 + completeness * 0.2)
      : Math.round(
          (keywords ?? 60) * 0.3 + impact * 0.3 + formatting * 0.2 + completeness * 0.1 + readability * 0.1
        )

  const issues: ATSAnalysisResult["issues"] = []
  if (!byType.has("SUMMARY"))
    issues.push({
      severity: "warning",
      category: "completeness",
      message: "No summary section — add 2-3 lines on who you are and what you target.",
      section: "Summary",
      suggestion: "Add a SUMMARY section with your target role and top strengths.",
    })
  if (bullets.length === 0)
    issues.push({
      severity: "critical",
      category: "impact",
      message: "No quantified bullets found — experience reads as duties, not impact.",
      section: "Experience",
      suggestion: "Start bullets with action verbs and add numbers (%, $, users, latency).",
    })
  else if (impact < 65)
    issues.push({
      severity: "warning",
      category: "impact",
      message: "Few bullets show measurable outcomes.",
      section: "Experience",
      suggestion: "Add a metric to each bullet: size, speed, revenue, or scale.",
    })
  if (emptySections > 0)
    issues.push({
      severity: "info",
      category: "formatting",
      message: `${emptySections} section${emptySections > 1 ? "s are" : " is"} empty — hidden or not, empty sections cost parsing confidence.`,
      section: "Formatting",
      suggestion: "Fill or remove empty sections before exporting.",
    })
  if (mode === "job-match" && missingKeywords.length > 0)
    issues.push({
      severity: "warning",
      category: "keywords",
      message: `${missingKeywords.length} job keywords are missing from the resume.`,
      section: "Keywords",
      suggestion: "Mirror the posting's own terms where you genuinely have the experience.",
    })

  const suggestions: ATSAnalysisResult["suggestions"] = [
    {
      category: "impact",
      title: "Quantify one bullet per role",
      description: "Pick the most important bullet under each role and add a number to it.",
      priority: "high",
    },
    {
      category: "completeness",
      title: "Keep contact + skills parseable",
      description: "Plain email, phone, location on one CONTACT section; one SKILLS section with comma-separated skills.",
      priority: "medium",
    },
  ]

  return { overallScore, scores, issues, suggestions, missingKeywords, mode }
}
