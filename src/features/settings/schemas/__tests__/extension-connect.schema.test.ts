// @vitest-environment node
import { describe, it, expect } from "vitest"

import {
  buildExtensionRedirect,
  isValidExtensionRedirectUri,
  isValidExtensionState,
  parseExtensionConnectParams,
} from "../extension-connect.schema"

/** A well-formed 32-character extension id. */
const ID = "a".repeat(32)
const VALID_URI = `https://${ID}.chromiumapp.org/`
const VALID_STATE = "aBc123_-xyz"

describe("isValidExtensionRedirectUri", () => {
  it("accepts the URL chrome.identity.getRedirectURL() produces", () => {
    expect(isValidExtensionRedirectUri(VALID_URI)).toBe(true)
  })

  it("accepts a mixed alphanumeric id and a path", () => {
    expect(isValidExtensionRedirectUri(`https://abcd1234${"e".repeat(24)}.chromiumapp.org/cb`)).toBe(
      true
    )
  })

  it.each([
    ["http, not https", `http://${ID}.chromiumapp.org/`],
    ["a bare host with no id", "https://chromiumapp.org/"],
    ["an id of the wrong length", `https://${"a".repeat(31)}.chromiumapp.org/`],
    ["an unrelated host", "https://evil.com/"],
    ["the host in the path", `https://evil.com/${ID}.chromiumapp.org/`],
    ["the host as a path prefix", `https://evil.com/?x=${ID}.chromiumapp.org`],
    ["a lookalike suffix", `https://${ID}.chromiumapp.org.evil.com/`],
    ["a lookalike without the dot", `https://${ID}xchromiumapp.org/`],
    ["userinfo pointing elsewhere", `https://${ID}.chromiumapp.org@evil.com/`],
    ["userinfo with a password", `https://user:pw@${ID}.chromiumapp.org/`],
    ["an explicit port", `https://${ID}.chromiumapp.org:8443/`],
    ["a fragment already present", `https://${ID}.chromiumapp.org/#token=stolen`],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>"],
    ["a relative path", "/extension/connect"],
    ["an empty string", ""],
    ["nonsense", "not a url"],
  ])("rejects %s", (_label, value) => {
    expect(isValidExtensionRedirectUri(value)).toBe(false)
  })

  it("accepts an uppercase id, which the URL parser lowercases like a browser would", () => {
    const value = `https://${"A".repeat(32)}.chromiumapp.org/`

    expect(isValidExtensionRedirectUri(value)).toBe(true)
    // And the value handed on is the lowercased form, not the raw input.
    expect(parseExtensionConnectParams(VALID_STATE, value)).toMatchObject({
      redirectUri: `https://${"a".repeat(32)}.chromiumapp.org/`,
    })
  })

  it.each([undefined, null, 42, {}, [`${VALID_URI}`]])("rejects the non-string %o", (value) => {
    expect(isValidExtensionRedirectUri(value)).toBe(false)
  })

  it("rejects an absurdly long URL", () => {
    expect(isValidExtensionRedirectUri(`${VALID_URI}${"a".repeat(600)}`)).toBe(false)
  })
})

describe("isValidExtensionState", () => {
  it.each(["12345678", VALID_STATE, "A".repeat(256)])("accepts %o", (value) => {
    expect(isValidExtensionState(value)).toBe(true)
  })

  it.each([
    ["too short", "1234567"],
    ["too long", "A".repeat(257)],
    ["empty", ""],
    ["a space", "abc defgh"],
    ["a fragment separator", "abcdefgh#x"],
    ["an ampersand", "abcdefgh&x"],
    ["a percent escape", "abcdefgh%20"],
    ["a newline", "abcdefgh\n"],
  ])("rejects %s", (_label, value) => {
    expect(isValidExtensionState(value)).toBe(false)
  })

  it.each([undefined, null, 12345678])("rejects the non-string %o", (value) => {
    expect(isValidExtensionState(value)).toBe(false)
  })
})

describe("parseExtensionConnectParams", () => {
  it("returns the normalised pair when both are valid", () => {
    expect(parseExtensionConnectParams(VALID_STATE, VALID_URI)).toEqual({
      ok: true,
      state: VALID_STATE,
      redirectUri: VALID_URI,
    })
  })

  it("fails on a bad redirect_uri without echoing it back", () => {
    const result = parseExtensionConnectParams(VALID_STATE, "https://evil.com/")

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).not.toContain("evil.com")
  })

  it("fails on a bad state", () => {
    expect(parseExtensionConnectParams("short", VALID_URI).ok).toBe(false)
  })

  it("checks the redirect target before the state", () => {
    // The redirect target is the security-critical half; a page reporting the
    // state problem first would hide the more serious one.
    const result = parseExtensionConnectParams("short", "https://evil.com/")

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("redirect")
  })
})

describe("buildExtensionRedirect", () => {
  it("puts the token and state in the fragment, both escaped", () => {
    expect(buildExtensionRedirect(VALID_URI, "rspec_ab+c/d=", "st_ate-1")).toBe(
      `${VALID_URI}#token=rspec_ab%2Bc%2Fd%3D&state=st_ate-1`
    )
  })

  it("produces a URL whose fragment carries the token and nothing before it", () => {
    const url = new URL(buildExtensionRedirect(VALID_URI, "rspec_xyz", VALID_STATE))

    expect(url.origin).toBe(`https://${ID}.chromiumapp.org`)
    expect(url.search).toBe("")
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe("rspec_xyz")
    expect(new URLSearchParams(url.hash.slice(1)).get("state")).toBe(VALID_STATE)
  })
})
