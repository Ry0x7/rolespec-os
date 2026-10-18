// @vitest-environment node
import { describe, it, expect } from "vitest"
import { UNKNOWN_CLIENT_IP, extractClientIp } from "../client-ip"

function headers(init: Record<string, string>): Headers {
  return new Headers(init)
}

describe("extractClientIp", () => {
  it("takes the first hop of x-forwarded-for", () => {
    expect(extractClientIp(headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" }))).toBe(
      "1.2.3.4"
    )
  })

  it("trims surrounding whitespace", () => {
    expect(extractClientIp(headers({ "x-forwarded-for": "  1.2.3.4  , 5.6.7.8" }))).toBe("1.2.3.4")
  })

  it("handles a single-value x-forwarded-for", () => {
    expect(extractClientIp(headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7")
  })

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(extractClientIp(headers({ "x-real-ip": "10.0.0.1" }))).toBe("10.0.0.1")
  })

  it("falls back to x-real-ip when the first x-forwarded-for hop is empty", () => {
    expect(extractClientIp(headers({ "x-forwarded-for": " , 5.6.7.8", "x-real-ip": "10.0.0.1" }))).toBe(
      "10.0.0.1"
    )
  })

  it("prefers x-forwarded-for over x-real-ip", () => {
    expect(
      extractClientIp(headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "10.0.0.1" }))
    ).toBe("1.2.3.4")
  })

  it("prefers the platform-set x-vercel-forwarded-for over a spoofable x-forwarded-for", () => {
    expect(
      extractClientIp(
        headers({
          "x-vercel-forwarded-for": "203.0.113.7",
          "x-forwarded-for": "1.2.3.4",
          "x-real-ip": "10.0.0.1",
        })
      )
    ).toBe("203.0.113.7")
  })

  it("takes the first hop of x-vercel-forwarded-for", () => {
    expect(
      extractClientIp(headers({ "x-vercel-forwarded-for": "203.0.113.7, 5.6.7.8" }))
    ).toBe("203.0.113.7")
  })

  it("falls back to x-forwarded-for when x-vercel-forwarded-for is blank", () => {
    expect(
      extractClientIp(headers({ "x-vercel-forwarded-for": "   ", "x-forwarded-for": "1.2.3.4" }))
    ).toBe("1.2.3.4")
  })

  it("returns the unknown sentinel when neither header is present", () => {
    expect(extractClientIp(headers({}))).toBe(UNKNOWN_CLIENT_IP)
    expect(UNKNOWN_CLIENT_IP).toBe("unknown")
  })

  it("returns the unknown sentinel for blank header values", () => {
    expect(extractClientIp(headers({ "x-forwarded-for": "   ", "x-real-ip": "  " }))).toBe(
      UNKNOWN_CLIENT_IP
    )
  })

  it("accepts a plain header-like object", () => {
    expect(extractClientIp({ get: (name) => (name === "x-real-ip" ? "8.8.8.8" : null) })).toBe(
      "8.8.8.8"
    )
  })
})
