import { describe, expect, it } from "vitest"
import { buildConnectUrl, generateState, parseConnectRedirect } from "./connect"

const REDIRECT_URI = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/"
const STATE = "s".repeat(43)

describe("buildConnectUrl", () => {
  it("puts state and an encoded redirect_uri on /extension/connect", () => {
    const url = new URL(buildConnectUrl("http://localhost:3000", STATE, REDIRECT_URI))

    expect(url.origin + url.pathname).toBe("http://localhost:3000/extension/connect")
    expect(url.searchParams.get("state")).toBe(STATE)
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI)
    // The raw query must be percent-encoded, not a bare second URL.
    expect(url.search).toContain("redirect_uri=https%3A%2F%2F")
  })

  it("strips trailing slashes from the app URL", () => {
    expect(buildConnectUrl("http://localhost:3000///", STATE, REDIRECT_URI)).toContain(
      "http://localhost:3000/extension/connect?",
    )
  })

  it("rejects an empty app URL", () => {
    expect(() => buildConnectUrl("   ", STATE, REDIRECT_URI)).toThrow(/App URL/)
  })
})

describe("parseConnectRedirect", () => {
  const redirect = (fragment: string) => `${REDIRECT_URI}#${fragment}`

  it("returns the token when state matches", () => {
    const token = parseConnectRedirect(
      redirect(`token=${encodeURIComponent("rspec_abc123")}&state=${STATE}`),
      STATE,
    )
    expect(token).toBe("rspec_abc123")
  })

  it("throws when the token is missing", () => {
    expect(() => parseConnectRedirect(redirect(`state=${STATE}`), STATE)).toThrow(/did not return a token/)
  })

  it("throws when the state does not match", () => {
    expect(() => parseConnectRedirect(redirect(`token=rspec_abc&state=other`), STATE)).toThrow(
      /did not match/,
    )
  })

  it("throws when the token lacks the rspec_ prefix", () => {
    expect(() => parseConnectRedirect(redirect(`token=nope_abc&state=${STATE}`), STATE)).toThrow(
      /unexpected token format/,
    )
  })

  it("throws when the URL has no fragment", () => {
    expect(() => parseConnectRedirect(REDIRECT_URI, STATE)).toThrow(/did not return a token/)
  })

  it("throws when the flow returned nothing (cancelled)", () => {
    expect(() => parseConnectRedirect(undefined, STATE)).toThrow(/cancelled/)
  })

  it("surfaces an error parameter from the app", () => {
    expect(() => parseConnectRedirect(redirect("error=access_denied"), STATE)).toThrow(/access_denied/)
  })
})

describe("generateState", () => {
  it("is unpadded base64url of the supplied bytes", () => {
    const state = generateState((buffer) => {
      buffer.fill(0)
      return buffer
    })

    expect(state).toBe("A".repeat(43))
    expect(state).not.toContain("=")
  })

  it("uses only [A-Za-z0-9_-] and fits the app's 8..256 length window", () => {
    const state = generateState((buffer) => {
      for (let i = 0; i < buffer.length; i += 1) buffer[i] = (i * 7 + 251) % 256
      return buffer
    })

    expect(state).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(state.length).toBe(43)
    expect(state.length).toBeGreaterThanOrEqual(8)
    expect(state.length).toBeLessThanOrEqual(256)
  })

  it("produces a different value on each call with real entropy", () => {
    expect(generateState()).not.toBe(generateState())
  })
})
