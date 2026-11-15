/**
 * The deterministic half of the candidate-name control.
 *
 * `candidate-name.ts` puts the candidate's real name in the prompt and tells the
 * model to sign with it. That is an instruction, and the thesis of this whole
 * feature line is that THE PROMPT IS NOT THE CONTROL — every other part of it
 * pairs a prompt rule with a post-check that does not depend on the model having
 * listened. This module is that post-check for the sign-off: it reads the
 * finished draft and reports when the signature slot does not carry the name it
 * was given (the observed failures signed "Best, Alex" and "Best, Cebu General
 * Hospital staff nurse"), or carries one when no name was available at all.
 *
 * It REPORTS and never edits, exactly like `checkGeneratedDraft()` in
 * `application-grounding.ts`. Substituting the right name into someone's letter
 * is a product decision, not a check's business.
 *
 * Everything here fails toward SILENCE. Where a shape is ambiguous the check
 * stays quiet rather than accusing a correct draft, because a false "your letter
 * is signed wrong" costs the user more than a missed one: they can read their
 * own sign-off, and they cannot read a warning that cried wolf twice.
 *
 * Dependency-free on purpose, like its siblings `candidate-name.ts`,
 * `human-voice.ts` and `untrusted.ts`.
 */

import { sanitizeCandidateName } from "./candidate-name"

/**
 * Whether the surface is supposed to end with a sign-off at all.
 *
 * `"none"` is not a nicety — it is the false-positive guard. A LinkedIn
 * connection note FORBIDS a sign-off, a LinkedIn DM forbids a formal one, and a
 * cover letter ends on its closing paragraph. On those three surfaces a missing
 * or informal signature is CORRECT, so the check is switched off rather than
 * tuned down.
 */
export type SignatureExpectation = "sign-off" | "none"

export type SignatureIssueKind =
  /** A name was available, the draft signed something else. */
  | "wrong_name"
  /** A name was available and the draft carries it nowhere in the sign-off. */
  | "missing_name"
  /** No name was available, and the draft signed a name anyway. */
  | "unexpected_name"

export type SignatureCheck = {
  issue: SignatureIssueKind
  /** The name the draft should have carried, or `null` when there was none. */
  expectedName: string | null
  /** The trailing lines the check read as the sign-off slot, top to bottom. */
  signature: string[]
  /**
   * The lines standing where the name belongs, minus the closing line itself.
   * Empty for `missing_name` (nothing was signed at all).
   */
  offending: string[]
}

/**
 * How many trailing lines can belong to a sign-off. Five covers "Best," + a name
 * + a three-line contact block; past that the slot would start swallowing body
 * text, and a bigger slot only makes the `unexpected_name` direction noisier.
 */
const SLOT_MAX_LINES = 5

/**
 * A sign-off line is short. A body paragraph in these drafts is a single long
 * line (the prompts all ask for plain text with blank lines between paragraphs),
 * so the length cut separates the two without guessing at closing words.
 */
const SLOT_LINE_MAX_LENGTH = 40

/** A name line is short too — this bounds what may be called name-shaped. */
const NAME_LINE_MAX_LENGTH = 60

/** ...and a name is a handful of words, not a sentence. */
const NAME_LINE_MAX_WORDS = 5

/**
 * Closing lines, normalised. Membership means "this is the 'Best,' line", so the
 * name is expected AFTER it. Kept deliberately short: an unrecognised closing
 * only ever makes the check quieter, because the fallback treats the last line
 * alone as the name slot.
 */
const CLOSING_PHRASES = new Set([
  "all the best",
  "best",
  "best regards",
  "best wishes",
  "cheers",
  "kind regards",
  "looking forward",
  "many thanks",
  "regards",
  "respectfully",
  "sincerely",
  "sincerely yours",
  "speak soon",
  "talk soon",
  "thank you",
  "thanks",
  "thanks again",
  "thanks so much",
  "warm regards",
  "warmly",
  "with thanks",
  "yours faithfully",
  "yours sincerely",
  "yours truly",
])

/** A bullet or numbered line is body content, never a signature. */
const LIST_MARKER = /^(?:[-*•>+]|\d+[.)])\s/

/**
 * Contact-block shapes: an address, a handle, a link, a phone number. The bare
 * `.tld` case catches "linkedin.com/in/marisol", which carries neither a digit
 * nor a scheme.
 */
const CONTACT_SHAPE = /[@\d/]|https?:\/\/|www\.|\.[a-z]{2,}/i

const COMBINING_MARKS = /\p{M}+/gu

/**
 * Case, accents and punctuation must not decide whether a name matched, so
 * everything is compared through this: decomposed, marks dropped, lowercased,
 * and every non-alphanumeric run turned into a single space. The result is
 * padded with spaces by `containsTokens` so matching stays whole-token —
 * "Marisol" must not match inside "Marisolutions".
 */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function containsTokens(haystack: string, needle: string): boolean {
  if (!needle) return false
  return ` ${haystack} `.includes(` ${needle} `)
}

function isClosingPhrase(line: string): boolean {
  return CLOSING_PHRASES.has(normalize(line))
}

/**
 * Whether a line could be somebody's name printed where a signature goes.
 *
 * Used ONLY to decide between reporting and staying quiet, never to decide that
 * a particular string IS a name — see `checkDraftSignature`'s doc comment. A
 * bracketed placeholder ("[Your Name]") passes on purpose: it is exactly as
 * wrong as an invented name and the prompts forbid it too.
 */
export function looksLikeNameLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (trimmed.length > NAME_LINE_MAX_LENGTH) return false
  if (LIST_MARKER.test(trimmed)) return false
  if (CONTACT_SHAPE.test(trimmed)) return false
  // A terminal period, question or exclamation mark makes it a sentence, and a
  // sentence in the slot is a short closing line the walk pulled in.
  if (/[.!?]$/.test(trimmed)) return false
  if (isClosingPhrase(trimmed)) return false
  if (!/\p{L}/u.test(trimmed)) return false
  return trimmed.split(/\s+/).length <= NAME_LINE_MAX_WORDS
}

/**
 * The trailing lines that make up the sign-off, oldest first.
 *
 * Walks up from the bottom and stops at the first long line, which is the
 * closing paragraph. The LAST non-empty line is always included whatever its
 * length: a signature that runs long ("Marisol Reyes | Senior Engineer |
 * marisol@example.com") would otherwise be cut away and read as no signature at
 * all — the one shape where the length rule produces a false alarm.
 *
 * Extracted from `scripts/candidate-name-live-check.ts`, which now imports it,
 * so the harness and the services read a draft the same way.
 */
export function signatureSlot(body: string): string[] {
  // A post-check must never be the thing that breaks a generation, and `body`
  // arrives from a model call. Anything that is not text has no signature slot.
  if (typeof body !== "string") return []

  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return []

  const slot: string[] = [lines[lines.length - 1]]
  for (let i = lines.length - 2; i >= 0 && slot.length < SLOT_MAX_LINES; i--) {
    if (lines[i].length > SLOT_LINE_MAX_LENGTH) break
    slot.unshift(lines[i])
  }
  return slot
}

/**
 * The lines inside the slot that stand where a name belongs: everything after
 * the last closing line, or — when the draft closed without one — the final line
 * on its own. Never the closing line itself, so "Best regards," alone counts as
 * an unsigned draft rather than as a signature.
 */
function nameSlotLines(slot: string[]): string[] {
  for (let i = slot.length - 1; i >= 0; i--) {
    if (isClosingPhrase(slot[i])) return slot.slice(i + 1)
  }
  return slot.length ? [slot[slot.length - 1]] : []
}

/**
 * True when the slot carries the candidate's own name in any reasonable shape:
 * the full name, the tokens reordered ("Reyes, Marisol"), or the given name
 * alone, which is what a warm-tone email legitimately signs.
 */
function slotCarriesName(slot: string[], name: string): boolean {
  const haystack = normalize(slot.join(" "))
  const tokens = normalize(name).split(" ").filter(Boolean)
  if (tokens.length === 0) return false

  if (containsTokens(haystack, tokens.join(" "))) return true
  if (containsTokens(haystack, tokens[0])) return true
  return tokens.every((token) => containsTokens(haystack, token))
}

/**
 * Reads the sign-off of a finished draft and reports a mismatch, or `null` when
 * there is nothing to report.
 *
 * WHAT IT DOES NOT DO: decide that some other string is "a wrong name". The two
 * failures actually observed were a former employer and a job title, so wrong
 * names in the wild are not first-name-shaped and a detector for them would have
 * to recognise arbitrary proper nouns — which in a signature slot also means
 * misreading legitimate title and contact lines. The check therefore asks the
 * cheap question with the safe failure mode: IS THE REAL NAME THERE? Absence is
 * what gets reported, and `offending` merely quotes the lines that were there
 * instead, as evidence for a human rather than as an accusation about them.
 *
 * @param body        The draft body. Subjects are deliberately not accepted —
 *                    see the note on `SignatureCheck`'s call sites: a cold-email
 *                    subject bars the name, a reply subject echoes whatever the
 *                    sender wrote, and an application subject may drop the name
 *                    to fit 60 characters. All three are correct, so the subject
 *                    cannot produce a finding here by construction.
 * @param expectation `"none"` switches the check off for surfaces that have no
 *                    sign-off by design.
 */
export function checkDraftSignature(input: {
  candidateName: string | null | undefined
  body: string
  expectation?: SignatureExpectation
}): SignatureCheck | null {
  const { body, expectation = "sign-off" } = input
  if (expectation === "none") return null

  // Sanitised the same way it was on the way into the prompt, so the check
  // compares against the exact string the model was told to copy.
  const expectedName = sanitizeCandidateName(input.candidateName)
  const slot = signatureSlot(body)
  const nameLines = nameSlotLines(slot)

  if (!expectedName) {
    // The nameless prompt branch asks for a closing line with nothing after it.
    const signed = nameLines.filter(looksLikeNameLine)
    if (signed.length === 0) return null
    return {
      issue: "unexpected_name",
      expectedName: null,
      signature: slot,
      offending: signed,
    }
  }

  if (slotCarriesName(slot, expectedName)) return null

  const offending = nameLines.filter(looksLikeNameLine)
  return {
    issue: offending.length > 0 ? "wrong_name" : "missing_name",
    expectedName,
    signature: slot,
    offending,
  }
}

// ---------------------------------------------------------------------------
// The subject line
// ---------------------------------------------------------------------------

/**
 * The delimiter an application-email subject puts before the candidate's name.
 *
 * The prompt asks for an EM DASH ("Application for {role} — {candidate name}"),
 * but a model that reaches for an en dash or a spaced hyphen has still produced
 * the same slot, so all three are read. A bare hyphen is deliberately NOT one:
 * unspaced, it is part of a compound word ("Front-End Engineer").
 */
const SUBJECT_NAME_DELIMITER = /—|–| - /g

export type SubjectNameCheck = {
  issue: "wrong_name"
  /** The name the subject's name slot should have carried. */
  expectedName: string
  /** What stood in the slot instead, verbatim, as evidence for a human. */
  offending: string
}

/**
 * Reads the NAME SLOT of a subject line and reports when something other than
 * the candidate's name is sitting in it, or `null` when there is nothing to say.
 *
 * WHY THIS IS NOT PART OF `checkDraftSignature`: that function refuses a subject
 * outright, and correctly so — one check pointed at every generator's subject
 * would turn three CORRECT behaviours into findings (a cold-email subject BARS
 * the name, a reply subject echoes the sender's own words, and a LinkedIn
 * subject is blanked). This is therefore a NARROW, PER-SURFACE check, wired into
 * `application-email.service.ts` alone, because that is the one prompt that asks
 * for a subject in the shape "Application for {role} — {candidate name}".
 *
 * The load-bearing step is the delimiter: a subject with NO delimiter is the
 * licensed "name half dropped" case — the prompt allows dropping it, and a long
 * role title pushes past the 60-character cap. Refusing to fire there
 * structurally is what makes this safe to run on every draft.
 *
 * Like `checkDraftSignature` it never decides that some other string IS a name.
 * It asks only whether the real name is where the template puts it, and quotes
 * what stood there instead.
 *
 * TWO KNOWN FALSE POSITIVES, recorded rather than dodged. Both are report-only
 * and cost the user a glance; the observed failure costs a wrong name in an
 * employer's inbox.
 *
 * 1. A role title that carries its own dash ("Application for Senior Engineer —
 *    Platform") reads exactly like a filled name slot, so it fires when the name
 *    is absent. No heuristic separates a qualifier from a wrong name without
 *    learning to recognise arbitrary proper nouns, which is the thing this
 *    module refuses to do.
 * 2. A subject signed with the FIRST name only ("… — Marisol") fires, because
 *    the slot is matched on the full name or the last token. `checkDraftSignature`
 *    is looser there on purpose — a warm email closes "Best, Marisol" — but the
 *    subject's prompt rule is "use exactly <name>", and accepting a bare first
 *    name would also wave through the first failure ever observed, the invented
 *    first name "Alex".
 */
export function checkSubjectNameSlot(input: {
  candidateName: string | null | undefined
  subject: string
}): SubjectNameCheck | null {
  // Sanitised the same way it was on the way into the prompt. No usable name
  // means the prompt licensed a nameless subject, so there is nothing to check.
  const expectedName = sanitizeCandidateName(input.candidateName)
  if (!expectedName) return null

  // A post-check must never be the thing that breaks a generation, and the
  // subject it reads came back from a model call.
  if (typeof input.subject !== "string") return null
  const subject = input.subject.trim()
  if (!subject) return null

  // The name being anywhere in the subject is enough — the slot is correct.
  // A last-token match counts so an initialised form ("M. Reyes") passes.
  const haystack = normalize(subject)
  const tokens = normalize(expectedName).split(" ").filter(Boolean)
  if (tokens.length === 0) return null
  if (containsTokens(haystack, tokens.join(" "))) return null
  if (containsTokens(haystack, tokens[tokens.length - 1])) return null

  // The LAST delimiter, so a role title containing one of its own still leaves
  // the trailing segment as the name slot.
  SUBJECT_NAME_DELIMITER.lastIndex = 0
  let slotStart = -1
  for (
    let match = SUBJECT_NAME_DELIMITER.exec(subject);
    match !== null;
    match = SUBJECT_NAME_DELIMITER.exec(subject)
  ) {
    slotStart = match.index + match[0].length
  }
  if (slotStart < 0) return null

  const offending = subject.slice(slotStart).trim()
  if (!offending) return null

  return { issue: "wrong_name", expectedName, offending }
}
