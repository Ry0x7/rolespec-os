import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { decryptSecret, encryptSecret } from "../secret-box"
import { emptyCounts, reencryptValue } from "../secret-reencrypt"

describe("secret-reencrypt", () => {
  const originalEnv = { ...process.env }
  const AUTH_SECRET = "test-auth-secret-value"
  const ENCRYPTION_KEY = "test-dedicated-encryption-key"

  beforeEach(() => {
    process.env = { ...originalEnv, AUTH_SECRET }
    delete process.env.ENCRYPTION_KEY
  })

  afterEach(() => {
    process.env = originalEnv
  })

  /** Writes a v1 envelope regardless of the current ENCRYPTION_KEY state. */
  function legacyEnvelope(plaintext: string): string {
    return encryptSecret(plaintext, AUTH_SECRET)
  }

  it("reports empty for null, undefined and empty string", () => {
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY

    expect(reencryptValue(null).outcome).toBe("empty")
    expect(reencryptValue(undefined).outcome).toBe("empty")
    expect(reencryptValue("").outcome).toBe("empty")
  })

  it("skips a value that is already v2", () => {
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY
    const modern = encryptSecret("sk-already-migrated")
    expect(modern.startsWith("v2.")).toBe(true)

    expect(reencryptValue(modern)).toEqual({ outcome: "skipped" })
  })

  it("skips a value whose version is neither v1 nor v2", () => {
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY
    expect(reencryptValue("v9.a.b.c").outcome).toBe("skipped")
  })

  it("re-encrypts a v1 value as v2 and preserves the plaintext", () => {
    const legacy = legacyEnvelope("sk-proj-secret1234")
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY

    const result = reencryptValue(legacy)

    expect(result.outcome).toBe("reencrypted")
    expect(result.last4).toBe("1234")
    expect(result.next?.startsWith("v2.")).toBe(true)
    expect(result.next).not.toContain("sk-proj-secret1234")
    expect(decryptSecret(result.next!)).toBe("sk-proj-secret1234")
  })

  it("keeps the migrated value readable after AUTH_SECRET rotates", () => {
    const legacy = legacyEnvelope("sk-survives-rotation")
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY
    const result = reencryptValue(legacy)

    process.env.AUTH_SECRET = "rotated-auth-secret"

    expect(decryptSecret(result.next!)).toBe("sk-survives-rotation")
  })

  it("reports an undecryptable v1 value instead of throwing, and does not rewrite it", () => {
    const orphan = encryptSecret("sk-lost", "a-different-auth-secret")
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY

    const result = reencryptValue(orphan)

    expect(result).toEqual({ outcome: "undecryptable" })
    expect(result.next).toBeUndefined()
  })

  it("refuses to run without ENCRYPTION_KEY rather than emitting another v1", () => {
    const legacy = legacyEnvelope("sk-proj-secret")

    expect(() => reencryptValue(legacy)).toThrow(/ENCRYPTION_KEY/)
  })

  it("emptyCounts starts every bucket at zero", () => {
    expect(emptyCounts()).toEqual({
      empty: 0,
      skipped: 0,
      undecryptable: 0,
      reencrypted: 0,
    })
  })
})
