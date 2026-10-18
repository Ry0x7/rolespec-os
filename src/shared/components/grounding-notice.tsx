import { Info, ShieldAlert } from "lucide-react"

import type { KeywordEvidence } from "@/shared/lib/evidence-grounding"

interface Props {
  /**
   * Requirements the generated draft mentions that the user's own resume does
   * not back, with no gap phrasing around them. Rendering nothing for an empty
   * list is deliberate — the clean case must stay silent, or the warning stops
   * meaning anything.
   */
  claimed: KeywordEvidence[]
  /**
   * Requirements the draft names as things the user has NOT done. Optional: a
   * cover letter persisted before the split has only `claimed`, and it must keep
   * rendering exactly as it did.
   */
  namedAsGap?: KeywordEvidence[]
  /** What was generated, for the sentence. Defaults to "draft". */
  label?: string
  className?: string
}

/**
 * The post-check result for a generated cover letter or email, in two tiers.
 *
 * The wording is careful on purpose. `checkGeneratedDraft()` finds MENTIONS of
 * a requirement the resume does not support, and a mention is not always a
 * claim — "your team works in Kafka" trips the same wire as "I've used Kafka".
 * So this asks the user to check, rather than announcing that the model lied.
 *
 * The loud tier keeps the amber/ShieldAlert treatment it shares with the resume
 * enhance panel's "Not added" note, because it is the same rule reported from
 * the other side: there, requirements that were withheld; here, ones that got
 * through anyway. The quiet tier is for terms the draft itself owns up to
 * ("Kafka is new to me") — still worth confirming, not worth alarm, and given
 * neutral surface tokens rather than a second accent colour so there is only
 * ever one alarm colour on the page.
 */
export function GroundingNotice({
  claimed,
  namedAsGap,
  label = "draft",
  className,
}: Props) {
  const gaps = namedAsGap ?? []
  if (claimed.length === 0 && gaps.length === 0) return null

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      {claimed.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-2">
            <ShieldAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500"
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-2">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Check before you send ({claimed.length})
                </p>
                <p className="text-xs text-muted-foreground">
                  This {label} mentions the following, and your resume does not
                  back them. Remove them, or make sure they do not read as your
                  own experience.
                </p>
              </div>
              <ul className="space-y-1">
                {claimed.map((note) => (
                  <li key={note.keyword} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {note.keyword}
                    </span>
                    {" — "}
                    {note.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <div className="flex items-start gap-2">
            <Info
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Named as a gap ({gaps.length})
                </p>
                <p className="text-xs text-muted-foreground">
                  This {label} brings these up as things you have not done yet.
                  Your resume does not back them either way, so check that saying
                  so is what you meant.
                </p>
              </div>
              <ul className="space-y-1">
                {gaps.map((note) => (
                  <li key={note.keyword} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {note.keyword}
                    </span>
                    {" — "}
                    {note.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
