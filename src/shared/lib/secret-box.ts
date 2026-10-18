import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"

/**
 * Symmetric encryption for secrets that have to round-trip through the database
 * (the deployment LLM API keys on `AiSettings` and the per-user ones on
 * `UserAiSettings`).
 *
 * AES-256-GCM with a random 96-bit IV per message. Two envelope versions:
 *
 * - `v2.<iv>.<ct>.<tag>` — key HKDF-SHA256-derived from `ENCRYPTION_KEY`, a
 *   dedicated secret whose only job is encryption at rest. This is what
 *   {@link encryptSecret} writes whenever `ENCRYPTION_KEY` is set, and it means
 *   rotating `AUTH_SECRET` (session signing) no longer destroys stored keys.
 * - `v1.<iv>.<ct>.<tag>` — key HKDF-SHA256-derived from `AUTH_SECRET`, the
 *   original scheme. Still read, and still written when `ENCRYPTION_KEY` is
 *   unset, so an existing deployment and a bare dev checkout keep working with
 *   no new env var.
 *
 * The two derivations use different HKDF salt/info labels, so a `v1` and a `v2`
 * key are unrelated even if an operator sets `ENCRYPTION_KEY` to the same string
 * as `AUTH_SECRET`.
 *
 * Setting `ENCRYPTION_KEY` on a deployment that already has `v1` values does not
 * migrate them: they stay bound to `AUTH_SECRET` until
 * `npx tsx scripts/reencrypt-secrets.ts --yes` rewrites them as `v2`.
 *
 * Rotating the key that a stored ciphertext was written under makes it
 * unreadable; callers must treat a decrypt failure as "no key configured" and
 * ask the user to re-enter it.
 */

const VERSION_V1 = "v1"
const VERSION_V2 = "v2"
const IV_BYTES = 12
const KEY_BYTES = 32

/**
 * HKDF salt/info labels. Constants are fine here: both IKMs are already
 * high-entropy secrets, and a per-message salt would have to be stored anyway.
 * The v2 labels differ from the v1 ones on purpose — see the module doc.
 */
const HKDF_INFO_V1 = "rolespec-ai-credentials"
const HKDF_SALT_V1 = "rolespec-secret-box-v1"
const HKDF_INFO_V2 = "rolespec-secrets-at-rest"
const HKDF_SALT_V2 = "rolespec-secret-box-v2"

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SecretBoxError"
  }
}

/** The dedicated encryption secret, or null when unset/blank. */
function encryptionKeyIkm(): string | null {
  const raw = process.env.ENCRYPTION_KEY
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** True when this deployment writes `v2` envelopes. */
export function isDedicatedEncryptionKeyConfigured(): boolean {
  return encryptionKeyIkm() !== null
}

function deriveKeyV1(secret?: string): Buffer {
  const ikm = secret ?? process.env.AUTH_SECRET
  if (!ikm) {
    throw new SecretBoxError("AUTH_SECRET is not set; cannot encrypt or decrypt secrets.")
  }
  return Buffer.from(hkdfSync("sha256", ikm, HKDF_SALT_V1, HKDF_INFO_V1, KEY_BYTES))
}

function deriveKeyV2(secret?: string): Buffer {
  const ikm = secret ?? encryptionKeyIkm()
  if (!ikm) {
    throw new SecretBoxError("ENCRYPTION_KEY is not set; cannot read v2 encrypted secrets.")
  }
  return Buffer.from(hkdfSync("sha256", ikm, HKDF_SALT_V2, HKDF_INFO_V2, KEY_BYTES))
}

function seal(plaintext: string, version: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    version,
    iv.toString("base64"),
    ciphertext.toString("base64"),
    tag.toString("base64"),
  ].join(".")
}

/**
 * Encrypts a UTF-8 string.
 *
 * Writes `v2` (ENCRYPTION_KEY-derived) when `ENCRYPTION_KEY` is set, `v1`
 * (AUTH_SECRET-derived) otherwise.
 *
 * `secret` overrides the key material and forces the legacy `v1` path — it
 * exists for tests and for the re-encryption script's read side. To exercise
 * `v2`, stub `process.env.ENCRYPTION_KEY` instead.
 */
export function encryptSecret(plaintext: string, secret?: string): string {
  if (secret !== undefined) {
    return seal(plaintext, VERSION_V1, deriveKeyV1(secret))
  }
  if (isDedicatedEncryptionKeyConfigured()) {
    return seal(plaintext, VERSION_V2, deriveKeyV2())
  }
  return seal(plaintext, VERSION_V1, deriveKeyV1())
}

/** True when the stored value is a `v1` (AUTH_SECRET-derived) envelope. */
export function isLegacyEnvelope(payload: string | null | undefined): boolean {
  return typeof payload === "string" && payload.startsWith(`${VERSION_V1}.`)
}

/**
 * Decrypts a value produced by {@link encryptSecret}, routing on the envelope
 * version: `v2` uses the `ENCRYPTION_KEY`-derived key, `v1` the
 * `AUTH_SECRET`-derived one. Throws `SecretBoxError` on a malformed envelope,
 * an unknown version, a missing key, a tampered payload, or a key mismatch —
 * GCM authentication makes the last two indistinguishable by design.
 *
 * `secret` overrides the key material for whichever version the payload
 * declares.
 */
export function decryptSecret(payload: string, secret?: string): string {
  const parts = payload.split(".")
  if (parts.length !== 4) {
    throw new SecretBoxError("Malformed encrypted payload.")
  }

  const [version, ivB64, ciphertextB64, tagB64] = parts

  let key: Buffer
  if (version === VERSION_V2) {
    key = deriveKeyV2(secret)
  } else if (version === VERSION_V1) {
    key = deriveKeyV1(secret)
  } else {
    throw new SecretBoxError(`Unsupported encrypted payload version "${version}".`)
  }

  const iv = Buffer.from(ivB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new SecretBoxError("Malformed encrypted payload.")
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, "base64")),
      decipher.final(),
    ])
    return plaintext.toString("utf8")
  } catch {
    // Deliberately opaque: never leak whether the key or the payload was wrong.
    throw new SecretBoxError("Could not decrypt payload.")
  }
}

/**
 * Decrypts without throwing. Returns null for any unusable stored value, which
 * is what every caller wants: a secret that cannot be read is a secret that is
 * not configured.
 */
export function tryDecryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null
  try {
    return decryptSecret(payload)
  } catch {
    return null
  }
}

/** Last 4 characters of a secret, for "sk-…abcd" style status display. */
export function secretLast4(value: string): string {
  return value.slice(-4)
}
