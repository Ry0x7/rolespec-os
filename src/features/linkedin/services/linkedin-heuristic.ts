import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re)
  return m ? m.length : 0
}

/**
 * Deterministic no-AI LinkedIn check. Scores the pasted profile text with
 * transparent keyword/length signals so the user gets guidance when no AI
 * provider is configured, offline, or over quota. Never called automatically
 * — the UI offers it as an explicit "Quick check (no AI)" path.
 */
export function rateLinkedInHeuristic(rawText: string): ProfileRatingData {
  const text = rawText.slice(0, 20000)
  const lower = text.toLowerCase()
  const words = text.trim().split(/\s+/).filter(Boolean).length

  const hasHeadline = /headline|open to|seeking|engineer|designer|manager|developer|analyst/i.test(text) ? 1 : 0
  const metricHits = countMatches(lower, /(\d+\s?%|\$\s?\d+|\d+\s?(users|customers|clients|projects|engineers))/g)
  const actionVerbs = countMatches(
    lower,
    /\b(built|shipped|led|launched|improved|reduced|increased|owned|designed|scaled|mentored|automated)\b/g
  )
  const skillHits = countMatches(
    lower,
    /\b(typescript|python|react|sql|aws|docker|kubernetes|figma|excel|salesforce|seo|node)\b/g
  )
  const contactHits =
    (lower.includes("@") ? 1 : 0) + (lower.includes("linkedin.com") ? 1 : 0) + (lower.includes("github") ? 1 : 0)

  const headline = clamp(35 + hasHeadline * 30 + Math.min(25, words / 40))
  const about = clamp(30 + Math.min(50, words / 12) + (words > 80 ? 10 : 0))
  const experienceImpact = clamp(25 + actionVerbs * 8 + metricHits * 12)
  const skillsKeywords = clamp(25 + skillHits * 9)
  const completeness = clamp(30 + contactHits * 15 + (words > 150 ? 25 : words / 6))

  const overallScore = clamp(
    headline * 0.15 + about * 0.2 + experienceImpact * 0.3 + skillsKeywords * 0.15 + completeness * 0.2
  )

  const issues: ProfileRatingData["issues"] = []
  if (actionVerbs === 0)
    issues.push({
      severity: "warning",
      message: "No strong action verbs found — start bullets with built, led, shipped or improved",
      category: "Experience impact",
    })
  if (metricHits === 0)
    issues.push({
      severity: "warning",
      message: "No numbers or outcomes — add one metric per role (%, $, users, scope)",
      category: "Experience impact",
    })
  if (skillHits === 0)
    issues.push({
      severity: "info",
      message: "Few recognizable skill keywords — name the tools the target role asks for",
      category: "Keywords",
    })
  if (contactHits === 0)
    issues.push({
      severity: "info",
      message: "No contact details detected in the pasted text — keep email/links in the export",
      category: "Completeness",
    })
  if (words < 80)
    issues.push({
      severity: "warning",
      message: "Profile text is very short — paste the full export for a fuller check",
      category: "Completeness",
    })

  const suggestions: ProfileRatingData["suggestions"] = {
    items: [
      ...(actionVerbs < 3 ? ["Rewrite each role with one action verb + one outcome"] : []),
      ...(metricHits === 0 ? ["Add a metric to your most recent role first"] : []),
      ...(skillHits < 3 ? ["Mirror 3–5 keywords from the job description"] : []),
      "Headline format: Role | Specialty | Proof (e.g. Senior PM | Fintech | 4 launches)",
    ],
  }

  return {
    id: `heuristic-${Date.now()}`,
    kind: "LINKEDIN",
    sourceUrl: null,
    overallScore,
    scores: { headline, about, experienceImpact, skillsKeywords, completeness },
    issues,
    suggestions,
    benchmark: null,
    createdAt: new Date().toISOString(),
  }
}
