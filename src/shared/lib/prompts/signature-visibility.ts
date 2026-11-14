/**
 * Which signature findings are allowed to reach a human, and which stay in the
 * log.
 *
 * `checkDraftSignature()` reports three kinds. Only two of them are worth
 * interrupting somebody over:
 *
 * - `wrong_name` — the draft signed something that is not the user's name. This
 *   is the observed failure (a former employer, a job title) and it goes into an
 *   employer's inbox if nobody looks.
 * - `unexpected_name` — no name was available and the model signed one anyway,
 *   which means it invented one.
 * - `missing_name` — a name was available and the sign-off carries none. This is
 *   a STYLE finding: an unsigned draft is odd, not wrong, and it is the kind most
 *   likely to fire on a legitimately short draft. Surfacing it would train the
 *   user to ignore the notice, which costs them the two findings above. It stays
 *   in the `logger.warn` the services already emit.
 *
 * The rule lives here, once, because every surface that shows a finding needs
 * it: the three job email server actions (application, cold, reply), both
 * extension draft routes (`/api/extension/cold-email` and
 * `/api/extension/email-reply`) and `SignatureNotice`, which renders what they
 * return. A condition restated at each of those is a condition that drifts.
 *
 * One place does restate it: the extension client applies the same allowlist in
 * `parseSignature()` (`extension/src/api.ts`). That is a deliberate copy rather
 * than an importer — the extension is a separate build that cannot reach into
 * `src/` — and it is defence in depth against a future server that changed its
 * mind.
 */

import type { SignatureCheck, SignatureIssueKind } from "./signature-check"

/** The issue kinds a user is shown. See the module comment for why not all three. */
const USER_FACING_ISSUES = new Set<SignatureIssueKind>([
  "wrong_name",
  "unexpected_name",
])

/** Whether this finding is one the user is told about at all. */
export function isUserFacingSignatureIssue(
  check: SignatureCheck | null | undefined
): check is SignatureCheck {
  return !!check && USER_FACING_ISSUES.has(check.issue)
}

/**
 * The finding as it may leave the server, or `null` when there is nothing the
 * user should see. Same nullable convention as the check itself, so a caller can
 * drop it into the existing `...(x ? { x } : {})` envelope unchanged.
 */
export function userFacingSignature(
  check: SignatureCheck | null | undefined
): SignatureCheck | null {
  return isUserFacingSignatureIssue(check) ? check : null
}
