/**
 * The candidate's own name is the one piece of resume content that has to reach
 * a prompt as a TRUSTED value. A sign-off cannot be written from inside a
 * `fenceUntrusted()` block: the fence declares everything in it to be document
 * data, so a name in there is something to analyse, never something to sign.
 *
 * `fullName` is still user-controlled text, so it is sanitised before it crosses
 * that boundary — one line, bounded length, and never anything that could pass
 * for a fence marker. If nothing survives the cleaning there is NO name, and the
 * prompt takes the nameless path instead of printing junk.
 *
 * Dependency-free on purpose, like its siblings `human-voice.ts` and
 * `untrusted.ts` — pure strings and pure functions.
 */

/**
 * The cap exists to bound a hostile value, not to police real ones — long
 * compound names (Spanish and Filipino ones especially, and this product's users
 * are largely Philippines-based) run well past a tidy-looking 80.
 */
export const CANDIDATE_NAME_MAX_LENGTH = 120

/**
 * Anything that could pass for the untrusted fence's marker. Matched against the
 * whole value rather than replaced: a name never legitimately contains it, so
 * rejecting outright is cleaner than splicing a placeholder into a signature.
 */
const FENCE_TOKEN_PATTERN = /(?:END_)?EXTERNAL_DATA/i

/**
 * Control (C0/C1, DEL) and invisible format characters. A newline is what would
 * turn a name into its own instruction line, which is the whole reason this
 * function exists; the bidi/zero-width format characters come along because a
 * name that renders as one thing and reads as another is the same trick.
 */
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]+/gu

/**
 * Returns a single-line, length-bounded name safe to interpolate into a system
 * prompt, or `null` when there is nothing usable.
 *
 * Idempotent, so a caller that sanitises twice loses nothing.
 */
export function sanitizeCandidateName(value: unknown): string | null {
  if (typeof value !== "string") return null

  const singleLine = value.replace(CONTROL_CHARS, " ")
  if (FENCE_TOKEN_PATTERN.test(singleLine)) return null

  const collapsed = singleLine.replace(/\s+/g, " ").trim()
  if (!collapsed) return null

  return collapsed.slice(0, CANDIDATE_NAME_MAX_LENGTH).trim() || null
}

/**
 * The rule that has to sit near every few-shot example: the observed failures
 * signed a draft with the candidate's FORMER EMPLOYER and with their JOB TITLE,
 * so both substitutions are named explicitly rather than left to inference.
 */
export const NEVER_INVENT_NAME_RULE =
  '- Never invent, guess or substitute a name. A company name, a former employer from the resume, a job title, and any name used in the example above are NOT the candidate\'s name — never sign off with one and never put one where a name belongs.'

/**
 * The name/sign-off rules for a generator's system prompt.
 *
 * Both branches are deliberate. A supplied name is stated as a given the model
 * copies verbatim; no name means an explicit instruction to close without one,
 * because a prompt that demands a name the prompt never supplied is exactly what
 * made the model invent one.
 *
 * Pass `subjectLine` for the generators whose subject may carry the name.
 *
 * `closing` picks the shape of the ending the surface actually has:
 * - `"sign-off"` (default) for a letter or an email, which closes with "Best,"
 *   and a name;
 * - `"name-only"` for a LinkedIn DM and for prose that never signs off at all,
 *   where the rule is only about which name may appear, not about adding one.
 */
export function buildCandidateNameRules(
  candidateName: string | null | undefined,
  options: { subjectLine?: boolean; closing?: "sign-off" | "name-only" } = {}
): string {
  const name = sanitizeCandidateName(candidateName)
  const closing = options.closing ?? "sign-off"
  const lines: string[] = []

  if (name) {
    lines.push(
      closing === "sign-off"
        ? `- The candidate's name is exactly "${name}". Use that spelling verbatim in the sign-off — no nickname, no initials, no reordering.`
        : `- The candidate's name is exactly "${name}". Wherever their name appears, use that spelling verbatim — no nickname, no initials, no reordering.`
    )
    if (options.subjectLine) {
      lines.push(
        `- When the subject line carries the candidate's name, use exactly "${name}".`
      )
    }
  } else {
    lines.push(
      closing === "sign-off"
        ? '- The candidate\'s name is NOT available. End with a nameless sign-off — a closing line such as "Best regards," on its own, with no name after it. Do not write a placeholder either.'
        : "- The candidate's name is NOT available. Do not write their name anywhere, and do not end with a name line. No placeholder either."
    )
    if (options.subjectLine) {
      lines.push("- Leave the candidate's name out of the subject line entirely.")
    }
  }

  lines.push(NEVER_INVENT_NAME_RULE)
  return lines.join("\n")
}
