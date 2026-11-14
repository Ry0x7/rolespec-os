import { ShieldAlert } from "lucide-react"

import type {
  SignatureCheck,
  SubjectNameCheck,
} from "@/shared/lib/prompts/signature-check"
import { userFacingSignature } from "@/shared/lib/prompts/signature-visibility"

interface Props {
  signature?: SignatureCheck | null
  subjectName?: SubjectNameCheck | null
  label?: string
  className?: string
}

function quote(lines: string[]): string {
  return `“${lines.join(" / ")}”`
}

/**
 * The deterministic name checks for a generated email, in one amber box.
 *
 * Sibling of `GroundingNotice` rather than a tier inside it: that component
 * reports CLAIMS the resume does not back, this one reports the candidate's own
 * name landing wrong, and the two have nothing to share but a colour.
 *
 * The wording follows the same rule as its sibling — it asks the user to check
 * and never announces that the model lied. `checkDraftSignature()` only ever
 * establishes that the real name is ABSENT from the slot; it does not decide
 * that what stood there is a wrong name, so this quotes the line as evidence
 * and leaves the verdict to the person about to hit send.
 *
 * Each finding gets its own sentence because the fix differs: a sign-off is
 * retyped at the bottom of the draft, a subject line at the top, and an
 * `unexpected_name` means RoleSpec had no name to give the model at all — which
 * is fixed on the resume, not in the draft.
 *
 * `missing_name` never renders. See `signature-visibility.ts`.
 */
export function SignatureNotice({
  signature,
  subjectName,
  label = "draft",
  className,
}: Props) {
  // The one filter: `missing_name` is a style finding and never reaches a human.
  // See `signature-visibility.ts`.
  const sig = userFacingSignature(signature)
  const subject = subjectName ?? null
  if (!sig && !subject) return null

  return (
    <div
      className={`rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 ${className ?? ""}`}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500"
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold text-foreground">
            Check the name before you send
          </p>
          <ul className="space-y-1">
            {sig && sig.issue === "unexpected_name" && (
              <li className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  Check the sign-off
                </span>
                {` — RoleSpec had no name on file for you, and this ${label} signed off as ${quote(sig.offending)}. Confirm that is you, or replace it.`}
              </li>
            )}
            {sig && sig.issue !== "unexpected_name" && (
              <li className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  Check the sign-off
                </span>
                {` — this ${label} ends with ${quote(sig.offending)}. The name on your resume is `}
                <span className="font-medium text-foreground">
                  {sig.expectedName}
                </span>
                {". Fix the sign-off before you send."}
              </li>
            )}
            {subject && (
              <li className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  Check the subject line
                </span>
                {` — the subject ends with ${quote([subject.offending])} where your name goes. The name on your resume is `}
                <span className="font-medium text-foreground">
                  {subject.expectedName}
                </span>
                {". Fix the subject if that is wrong."}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}
