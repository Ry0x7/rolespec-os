import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  SecretBoxError,
  decryptSecret,
  encryptSecret,
  isDedicatedEncryptionKeyConfigured,
  isLegacyEnvelope,
  secretLast4,
  tryDecryptSecret,
} from "../secret-box"

describe("secret-box", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv, AUTH_SECRET: "test-auth-secret-value" }
    // The v1 tests below assume no dedicated key, whatever the shell has set.
    delete process.env.ENCRYPTION_KEY
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("round-trips a value", () => {
    const plaintext = "sk-proj-abcdefghijklmnop"
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext)
  })

  it("round-trips unicode and empty strings", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("")
    expect(decryptSecret(encryptSecret("clé—🔐"))).toBe("clé—🔐")
  })

  it("emits the versioned four-part envelope and never the plaintext", () => {
    const payload = encryptSecret("sk-secret-value")
    const parts = payload.split(".")

    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe("v1")
    expect(payload).not.toContain("sk-secret-value")
  })

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"))
  })

  it("rejects a tampered ciphertext", () => {
    const [version, iv, ciphertext, tag] = encryptSecret("sk-secret-value").split(".")
    const flipped = Buffer.from(ciphertext, "base64")
    flipped[0] ^= 0xff
    const tampered = [version, iv, flipped.toString("base64"), tag].join(".")

    expect(() => decryptSecret(tampered)).toThrow(SecretBoxError)
  })

  it("rejects a tampered auth tag", () => {
    const [version, iv, ciphertext, tag] = encryptSecret("sk-secret-value").split(".")
    const flipped = Buffer.from(tag, "base64")
    flipped[0] ^= 0xff
    const tampered = [version, iv, ciphertext, flipped.toString("base64")].join(".")

    expect(() => decryptSecret(tampered)).toThrow(SecretBoxError)
  })

  it("rejects a payload encrypted under a different key", () => {
    const payload = encryptSecret("sk-secret-value", "key-a")

    expect(() => decryptSecret(payload, "key-b")).toThrow(SecretBoxError)
    expect(decryptSecret(payload, "key-a")).toBe("sk-secret-value")
  })

  it("rejects malformed and unknown-version envelopes", () => {
    expect(() => decryptSecret("not-an-envelope")).toThrow(SecretBoxError)
    expect(() => decryptSecret("v9.a.b.c")).toThrow(/Unsupported/)
  })

  it("throws when AUTH_SECRET is unset", () => {
    delete process.env.AUTH_SECRET
    expect(() => encryptSecret("x")).toThrow(/AUTH_SECRET/)
  })

  it("tryDecryptSecret returns null instead of throwing", () => {
    expect(tryDecryptSecret(null)).toBeNull()
    expect(tryDecryptSecret(undefined)).toBeNull()
    expect(tryDecryptSecret("")).toBeNull()
    expect(tryDecryptSecret("garbage")).toBeNull()
    expect(tryDecryptSecret(encryptSecret("sk-live"))).toBe("sk-live")
  })

  it("secretLast4 exposes only the tail", () => {
    expect(secretLast4("sk-proj-abcd1234")).toBe("1234")
  })

  describe("ENCRYPTION_KEY (v2 envelopes)", () => {
    const ENCRYPTION_KEY = "test-dedicated-encryption-key"

    it("writes v1 and reports no dedicated key when ENCRYPTION_KEY is unset", () => {
      expect(isDedicatedEncryptionKeyConfigured()).toBe(false)
      const payload = encryptSecret("sk-legacy-value")

      expect(payload.startsWith("v1.")).toBe(true)
      expect(isLegacyEnvelope(payload)).toBe(true)
      expect(decryptSecret(payload)).toBe("sk-legacy-value")
    })

    it("treats a blank/whitespace ENCRYPTION_KEY as unset", () => {
      process.env.ENCRYPTION_KEY = "   "
      expect(isDedicatedEncryptionKeyConfigured()).toBe(false)
      expect(encryptSecret("x").startsWith("v1.")).toBe(true)
    })

    it("round-trips a v2 envelope when ENCRYPTION_KEY is set", () => {
      process.env.ENCRYPTION_KEY = ENCRYPTION_KEY
      const payload = encryptSecret("sk-proj-dedicated")

      expect(payload.split(".")).toHaveLength(4)
      expect(payload.startsWith("v2.")).toBe(true)
      expect(isLegacyEnvelope(payload)).toBe(false)
      expect(payload).not.toContain("sk-proj-dedicated")
      expect(decryptSecret(payload)).toBe("sk-proj-dedicated")
      expect(tryDecryptSecret(payload)).toBe("sk-proj-dedicated")
    })

    it("still decrypts a v1 value written before ENCRYPTION_KEY was introduced", () => {
      const legacy = encryptSecret("sk-written-before")
      expect(legacy.startsWith("v1.")).toBe(true)

      process.env.ENCRYPTION_KEY = ENCRYPTION_KEY

      expect(decryptSecret(legacy)).toBe("sk-written-before")
      expect(encryptSecret("sk-written-after").startsWith("v2.")).toBe(true)
    })

    it("survives an AUTH_SECRET rotation for v2 while v1 dies with it", () => {
      const legacy = encryptSecret("sk-v1-value")
      process.env.ENCRYPTION_KEY = ENCRYPTION_KEY
      const modern = encryptSecret("sk-v2-value")

      process.env.AUTH_SECRET = "rotated-auth-secret"

      expect(decryptSecret(modern)).toBe("sk-v2-value")
      expect(tryDecryptSecret(legacy)).toBeNull()
    })

    it("fails a v2 payload when ENCRYPTION_KEY is unset or wrong", () => {
      process.env.ENCRYPTION_KEY = ENCRYPTION_KEY
      const payload = encryptSecret("sk-v2-value")

      process.env.ENCRYPTION_KEY = "some-other-encryption-key"
      expect(() => decryptSecret(payload)).toThrow(SecretBoxError)
      expect(tryDecryptSecret(payload)).toBeNull()

      delete process.env.ENCRYPTION_KEY
      expect(() => decryptSecret(payload)).toThrow(/ENCRYPTION_KEY/)
      expect(tryDecryptSecret(payload)).toBeNull()
    })

    it("derives distinct keys even when ENCRYPTION_KEY equals AUTH_SECRET", () => {
      const shared = "identical-secret-material"
      process.env.AUTH_SECRET = shared

      const legacy = encryptSecret("sk-v1-value")
      process.env.ENCRYPTION_KEY = shared
      const modern = encryptSecret("sk-v2-value")

      expect(legacy.startsWith("v1.")).toBe(true)
      expect(modern.startsWith("v2.")).toBe(true)

      // Same IKM, different HKDF labels: relabelling either envelope makes it
      // undecryptable, which is only true if the two keys actually differ.
      const relabelledAsV2 = `v2.${legacy.split(".").slice(1).join(".")}`
      const relabelledAsV1 = `v1.${modern.split(".").slice(1).join(".")}`

      expect(tryDecryptSecret(relabelledAsV2)).toBeNull()
      expect(tryDecryptSecret(relabelledAsV1)).toBeNull()

      // ...while each still reads correctly under its own version.
      expect(decryptSecret(legacy)).toBe("sk-v1-value")
      expect(decryptSecret(modern)).toBe("sk-v2-value")
    })

    it("keeps the explicit `secret` override on the legacy v1 path", () => {
      process.env.ENCRYPTION_KEY = ENCRYPTION_KEY
      const payload = encryptSecret("sk-override", "key-a")

      expect(payload.startsWith("v1.")).toBe(true)
      expect(decryptSecret(payload, "key-a")).toBe("sk-override")
      expect(() => decryptSecret(payload, "key-b")).toThrow(SecretBoxError)
    })

    it("lets `secret` override the v2 key material too", () => {
      process.env.ENCRYPTION_KEY = ENCRYPTION_KEY
      const payload = encryptSecret("sk-v2-value")

      delete process.env.ENCRYPTION_KEY
      expect(decryptSecret(payload, ENCRYPTION_KEY)).toBe("sk-v2-value")
    })
  })
})
