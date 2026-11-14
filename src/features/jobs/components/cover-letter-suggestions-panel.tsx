import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { CheckCircle2, XCircle } from "lucide-react"

import type { KeywordEvidence } from "@/shared/lib/evidence-grounding"

export interface CoverLetterSuggestions {
  keywordsToInclude: string[]
  experienceToEmphasize: string[]
  whatToAvoid: string[]
  improvementSuggestions: string[]
  toneSuggestions: string[]
  /**
   * Result of the evidence post-check, persisted alongside the suggestions
   * because `generateCoverLetter` redirects — an in-memory value would be gone
   * before this page rendered. Absent on letters generated before the check
   * existed, which is why every field here is read defensively.
   */
  grounding?: {
    claimed: KeywordEvidence[]
    /** Absent on letters generated before the two-tier split. */
    namedAsGap?: KeywordEvidence[]
  } | null
}

interface Props {
  suggestions: CoverLetterSuggestions | null
}

export function CoverLetterSuggestionsPanel({ suggestions }: Props) {
  if (!suggestions) return null

  const {
    keywordsToInclude,
    experienceToEmphasize,
    whatToAvoid,
    toneSuggestions,
  } = suggestions

  const hasKeywords = keywordsToInclude.length > 0
  const hasEmphasize = experienceToEmphasize.length > 0
  const hasAvoid = whatToAvoid.length > 0
  const hasTone = toneSuggestions.length > 0

  if (!hasKeywords && !hasEmphasize && !hasAvoid && !hasTone) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">AI Suggestions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasKeywords && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Keywords to Include
            </p>
            <div className="flex flex-wrap gap-1.5">
              {keywordsToInclude.map((kw) => (
                <span
                  key={kw}
                  className="bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5 text-xs"
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>
        )}

        {hasEmphasize && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Emphasize
            </p>
            <ul className="space-y-1">
              {experienceToEmphasize.map((item) => (
                <li key={item} className="flex items-start gap-1.5">
                  <CheckCircle2
                    className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500"
                    aria-hidden="true"
                  />
                  <span className="text-sm">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasAvoid && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Avoid
            </p>
            <ul className="space-y-1">
              {whatToAvoid.map((item) => (
                <li key={item} className="flex items-start gap-1.5">
                  <XCircle
                    className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <span className="text-sm text-destructive">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasTone && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Tone
            </p>
            {toneSuggestions.map((item) => (
              <p key={item} className="text-sm text-muted-foreground">
                {item}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
