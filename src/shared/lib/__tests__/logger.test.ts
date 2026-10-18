// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { logger, redactContext } from "../logger"

const spies = {
  log: vi.spyOn(console, "log"),
  warn: vi.spyOn(console, "warn"),
  error: vi.spyOn(console, "error"),
}

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => {})
  vi.clearAllMocks()
})

afterEach(() => {
  // `NODE_ENV` is readonly in the Next.js type surface, so it has to be stubbed
  // rather than assigned.
  vi.unstubAllEnvs()
})

describe("redactContext", () => {
  it.each([
    "password",
    "resetToken",
    "AUTH_SECRET",
    "paymongoWebhookSecret",
    "apiKey",
    "authorization",
    "cookie",
    "credential",
    "signature",
  ])("redacts %s", (key) => {
    expect(redactContext({ [key]: "sensitive" })[key]).toBe("[redacted]")
  })

  it("leaves ordinary fields alone", () => {
    expect(redactContext({ userId: "user_1", count: 3, ok: true })).toEqual({
      userId: "user_1",
      count: 3,
      ok: true,
    })
  })

  it("redacts nested keys", () => {
    const result = redactContext({ outer: { innerToken: "x", safe: 1 } }) as {
      outer: Record<string, unknown>
    }
    expect(result.outer.innerToken).toBe("[redacted]")
    expect(result.outer.safe).toBe(1)
  })

  it("flattens an Error to name and message rather than dropping it", () => {
    const result = redactContext({ err: new TypeError("boom") }) as {
      err: Record<string, unknown>
    }
    expect(result.err).toEqual({ name: "TypeError", message: "boom" })
  })

  it("stops recursing on a deep object instead of walking forever", () => {
    // A Prisma model or a request object would otherwise be walked in full.
    const deep = { a: { b: { c: { d: { e: "too far" } } } } }
    expect(JSON.stringify(redactContext(deep))).toContain("truncated")
  })
})

describe("development output", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LOG_LEVEL", "")
  })

  it("writes a human-readable line with level and scope", () => {
    logger("resume/parse").info("parsed a file", { userId: "user_1" })

    expect(spies.log).toHaveBeenCalledWith('INFO [resume/parse] parsed a file {"userId":"user_1"}')
  })

  it("omits the context object when there is none", () => {
    logger("shop").info("opened")

    expect(spies.log).toHaveBeenCalledWith("INFO [shop] opened")
  })

  it("routes warn and error to the matching console method", () => {
    const log = logger("x")
    log.warn("careful")
    log.error("broken")

    expect(spies.warn).toHaveBeenCalledTimes(1)
    expect(spies.error).toHaveBeenCalledTimes(1)
    expect(spies.log).not.toHaveBeenCalled()
  })

  it("emits debug in development", () => {
    logger("x").debug("noisy")
    expect(spies.log).toHaveBeenCalledTimes(1)
  })
})

describe("production output", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LOG_LEVEL", "")
  })

  it("writes one parseable JSON object per line", () => {
    logger("export/store").info("stored export", { userId: "user_1", amount: 12 })

    const parsed = JSON.parse(spies.log.mock.calls[0][0] as string)
    expect(parsed).toMatchObject({
      level: "info",
      scope: "export/store",
      message: "stored export",
      userId: "user_1",
      amount: 12,
    })
    expect(typeof parsed.time).toBe("string")
  })

  it("redacts in the serialised output, not just in memory", () => {
    logger("auth").error("bad reset", { resetToken: "raw-secret-value" })

    const line = spies.error.mock.calls[0][0] as string
    expect(line).not.toContain("raw-secret-value")
    expect(JSON.parse(line).resetToken).toBe("[redacted]")
  })

  it("drops debug lines", () => {
    logger("x").debug("noisy")
    expect(spies.log).not.toHaveBeenCalled()
  })
})

describe("level threshold", () => {
  it("honours LOG_LEVEL over the environment default", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LOG_LEVEL", "warn")

    const log = logger("x")
    log.info("dropped")
    log.warn("kept")

    expect(spies.log).not.toHaveBeenCalled()
    expect(spies.warn).toHaveBeenCalledTimes(1)
  })

  it("ignores an unrecognised LOG_LEVEL rather than going silent", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LOG_LEVEL", "nonsense")

    logger("x").info("kept")

    expect(spies.log).toHaveBeenCalledTimes(1)
  })
})

describe("child", () => {
  it("appends to the scope path", () => {
    vi.stubEnv("NODE_ENV", "development")

    logger("resume").child("parse").info("hello")

    expect(spies.log).toHaveBeenCalledWith("INFO [resume/parse] hello")
  })
})
