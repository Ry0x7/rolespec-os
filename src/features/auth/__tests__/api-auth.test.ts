// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3100" })),
  cookies: vi.fn(async () => ({ get: vi.fn() })),
}))
vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/shared/lib/logger", () => ({
  logger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}))

import { isSameOriginRequest } from "../api-auth"

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost:3100/api/notes", { method: "POST", headers })
}

describe("isSameOriginRequest", () => {
  it("allows non-browser callers that send no Origin", () => {
    expect(isSameOriginRequest(request({ host: "localhost:3100" }))).toBe(true)
  })

  it("allows a matching Origin including its port", () => {
    expect(
      isSameOriginRequest(
        request({ host: "rolespec.example.com", origin: "https://rolespec.example.com" })
      )
    ).toBe(true)
  })

  it("uses the forwarded host behind a proxy", () => {
    expect(
      isSameOriginRequest(
        request({
          host: "127.0.0.1:3000",
          "x-forwarded-host": "rolespec.example.com",
          origin: "https://rolespec.example.com",
        })
      )
    ).toBe(true)
  })

  it.each([
    ["https://evil.example", "rolespec.example.com"],
    ["https://rolespec.example.com.evil.example", "rolespec.example.com"],
    ["null", "rolespec.example.com"],
  ])("rejects Origin %s for host %s", (origin, host) => {
    expect(isSameOriginRequest(request({ host, origin }))).toBe(false)
  })

  it("rejects a missing host header rather than assuming local", () => {
    expect(isSameOriginRequest(request({ origin: "https://evil.example" }))).toBe(false)
  })
})
