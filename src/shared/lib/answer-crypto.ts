import { decryptSecret, encryptSecret, isLegacyEnvelope } from "./secret-box"

/**
 * Encrypted JSON for human-approved answers. The database column stays `Json`,
 * but a stored answer is an opaque envelope (`enc.v1.<secret-box payload>`),
 * never the answer text. Legacy rows written before this helper remain readable
 * and are re-encrypted the next time the user edits them.
 */
const PREFIX = "enc.v1."

export function isEncryptedAnswerValue(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX)
}

/** Encrypts any JSON answer value; the envelope is safe to store or log. */
export function encryptAnswerValue(value: unknown): string {
  return `${PREFIX}${encryptSecret(JSON.stringify(value))}`
}

/**
 * Reads an encrypted or legacy answer. Throws when an envelope exists but the
 * key is missing or wrong: silently returning ciphertext would put a meaningless
 * value into a real ATS field.
 */
export function decryptAnswerValue(value: unknown): unknown {
  if (!isEncryptedAnswerValue(value)) return value
  const plaintext = decryptSecret(value.slice(PREFIX.length))
  try {
    return JSON.parse(plaintext) as unknown
  } catch {
    return plaintext
  }
}

/** True for a stored secret-box payload, encrypted answer or legacy value. */
export function isEncryptedOrLegacySecret(value: unknown): boolean {
  return isEncryptedAnswerValue(value) || (typeof value === "string" && isLegacyEnvelope(value))
}
