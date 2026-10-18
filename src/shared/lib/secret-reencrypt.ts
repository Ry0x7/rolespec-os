/**
 * Pure row-transform logic for the P1.1 re-encryption migration
 * (`scripts/reencrypt-secrets.ts`), which rewrites `v1` (AUTH_SECRET-derived)
 * stored secrets as `v2` (ENCRYPTION_KEY-derived).
 *
 * Kept free of prisma so it can be unit tested without a database; the script
 * wires this up to the real `AiSettings` / `UserAiSettings` reads and writes.
 */

import {
  decryptSecret,
  encryptSecret,
  isDedicatedEncryptionKeyConfigured,
  isLegacyEnvelope,
  secretLast4,
} from "./secret-box"

export type ReencryptOutcome =
  /** Column is null/empty — nothing stored, nothing to do. */
  | "empty"
  /** Already a `v2` envelope (or some other non-`v1` version) — leave it. */
  | "skipped"
  /** A `v1` value that could not be decrypted — already dead, left in place. */
  | "undecryptable"
  /** A `v1` value successfully rewritten as `v2`. */
  | "reencrypted"

export interface ReencryptResult {
  outcome: ReencryptOutcome
  /** The `v2` replacement, only for `outcome: "reencrypted"`. */
  next?: string
  /** Last 4 chars of the plaintext, for a non-revealing report line. */
  last4?: string
}

/**
 * Re-encrypts one stored column value. Never throws: an undecryptable `v1`
 * value is reported, not fatal — it is already unusable to the app, and
 * rewriting it is impossible.
 *
 * Requires `ENCRYPTION_KEY` to be configured, since the whole point is to
 * produce a `v2` envelope; the caller checks that up front, and this function
 * re-checks rather than silently emitting another `v1`.
 */
export function reencryptValue(value: string | null | undefined): ReencryptResult {
  if (!value) return { outcome: "empty" }
  if (!isLegacyEnvelope(value)) return { outcome: "skipped" }
  if (!isDedicatedEncryptionKeyConfigured()) {
    throw new Error("ENCRYPTION_KEY is not set; refusing to re-encrypt.")
  }

  let plaintext: string
  try {
    plaintext = decryptSecret(value)
  } catch {
    return { outcome: "undecryptable" }
  }

  return {
    outcome: "reencrypted",
    next: encryptSecret(plaintext),
    last4: secretLast4(plaintext),
  }
}

export type ReencryptCounts = Record<ReencryptOutcome, number>

export function emptyCounts(): ReencryptCounts {
  return { empty: 0, skipped: 0, undecryptable: 0, reencrypted: 0 }
}
