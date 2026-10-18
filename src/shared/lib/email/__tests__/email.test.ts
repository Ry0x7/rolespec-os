// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

import { logTransport, selectTransport } from ".."
import { escapeHtml, passwordResetEmail } from "../templates"

describe("selectTransport", () => {
  it("prefers resend when a key is present", () => {
    expect(selectTransport({ RESEND_API_KEY: "re_123" })?.name).toBe("resend")
  })

  it("falls back to logging in development so local flows work without a key", () => {
    expect(selectTransport({ NODE_ENV: "development" })?.name).toBe("log")
    expect(selectTransport({})?.name).toBe("log")
  })

  it("refuses to log in production rather than silently not sending", () => {
    // The log transport prints reset tokens to stdout, and a production deploy
    // that thinks it sent a reset it never sent is worse than a loud failure.
    expect(selectTransport({ NODE_ENV: "production" })).toBeNull()
  })

  it("treats a blank key as absent", () => {
    expect(selectTransport({ RESEND_API_KEY: "   ", NODE_ENV: "development" })?.name).toBe("log")
    expect(selectTransport({ RESEND_API_KEY: "   ", NODE_ENV: "production" })).toBeNull()
  })
})

describe("logTransport", () => {
  it("reports success and writes the message to the console", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})

    const result = await logTransport.send({
      to: "a@example.com",
      subject: "Subject",
      html: "<p>html</p>",
      text: "the text body",
    })

    expect(result).toEqual({ ok: true, transport: "log" })
    expect(spy.mock.calls[0][0]).toContain("the text body")
    spy.mockRestore()
  })
})

describe("escapeHtml", () => {
  it("neutralises the characters that could inject markup", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    )
    expect(escapeHtml("a & b")).toBe("a &amp; b")
    expect(escapeHtml("it's")).toBe("it&#39;s")
  })

  it("escapes ampersands before the entities it introduces", () => {
    // A naive ordering turns < into &lt; and then the & into &amp;lt;.
    expect(escapeHtml("&<")).toBe("&amp;&lt;")
  })
})

describe("passwordResetEmail", () => {
  const url = "https://app.example.com/reset-password?token=abc123"

  it("puts the link in both bodies", () => {
    const message = passwordResetEmail("user@example.com", url, 30)

    expect(message.to).toBe("user@example.com")
    expect(message.html).toContain(url)
    expect(message.text).toContain(url)
  })

  it("states the expiry so the recipient knows the link is short-lived", () => {
    expect(passwordResetEmail("user@example.com", url, 30).text).toContain("30 minutes")
  })

  it("tells a recipient who did not request it that nothing has changed", () => {
    // This is the one line that matters when the email is unsolicited.
    expect(passwordResetEmail("user@example.com", url, 30).text).toContain(
      "your password has not changed"
    )
  })
})
