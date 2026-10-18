/**
 * Closed-beta signup gate. `SIGNUP_INVITE_CODE` is server-only and must never be
 * exposed to the client — the sign-up form only ever learns the boolean from
 * `isInviteCodeRequired()`, never the code itself.
 *
 * Unset (or whitespace-only) means registration stays open, so a dev install
 * needs no configuration.
 */
function configuredInviteCode(): string | null {
  const configured = process.env.SIGNUP_INVITE_CODE?.trim()
  return configured ? configured : null
}

export function isInviteCodeRequired(): boolean {
  return configuredInviteCode() !== null
}

/**
 * True when the gate is off, or when the submitted code matches exactly
 * (whitespace trimmed, case-sensitive).
 */
export function isInviteCodeValid(submitted: string | undefined): boolean {
  const configured = configuredInviteCode()
  if (configured === null) return true
  return submitted?.trim() === configured
}
