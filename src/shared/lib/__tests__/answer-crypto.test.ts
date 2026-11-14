import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  decryptAnswerValue,
  encryptAnswerValue,
  isEncryptedAnswerValue,
} from "../answer-crypto"

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...originalEnv, AUTH_SECRET: "answer-crypto-test-secret" }
  delete process.env.ENCRYPTION_KEY
})

afterEach(() => {
  process.env = originalEnv
})

describe("answer-crypto", () => {
  it("stores an opaque envelope and round-trips every answer shape", () => {
    for (const value of ["Yes", true, ["One", "Two"]]) {
      const encrypted = encryptAnswerValue(value)
      expect(isEncryptedAnswerValue(encrypted)).toBe(true)
      expect(encrypted).not.toContain(JSON.stringify(value))
      expect(decryptAnswerValue(encrypted)).toEqual(value)
    }
  })

  it("passes legacy plaintext values through unchanged", () => {
    expect(decryptAnswerValue("Yes")).toBe("Yes")
    expect(decryptAnswerValue(["One"])).toEqual(["One"])
  })

  it("fails closed instead of returning ciphertext when the key is wrong", () => {
    const encrypted = encryptAnswerValue("Yes")
    process.env.AUTH_SECRET = "a-different-secret"
    expect(() => decryptAnswerValue(encrypted)).toThrow()
  })
})
