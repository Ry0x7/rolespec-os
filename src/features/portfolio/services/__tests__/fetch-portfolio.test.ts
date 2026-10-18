import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:dns", () => {
  const promises = { lookup: vi.fn() }
  return { promises, default: { promises } }
})

import { promises as dns } from "node:dns"
import {
  checkUrlSafety,
  extractReadableText,
  extractTitle,
  extractMetaDescription,
  isBlockedHostname,
  isPrivateAddress,
  safeLookup,
} from "../fetch-portfolio"

const mockedLookup = vi.mocked(dns.lookup)

/** dns.lookup is only called with { all: true } here, so always resolve a list. */
function resolvesTo(...addresses: string[]) {
  mockedLookup.mockResolvedValue(
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    })) as never
  )
}

describe("isPrivateAddress", () => {
  it.each([
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::1%eth0",
    "::ffff:127.0.0.1",
    // IPv4-mapped in hex. This is the form a URL hostname actually arrives in:
    // the WHATWG parser rewrites [::ffff:127.0.0.1] to [::ffff:7f00:1].
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:127.0.0.1",
    "::ffff:a9fe:a9fe", // 169.254.169.254, the cloud metadata endpoint
    "::ffff:c0a8:1", // 192.168.0.1
    "::ffff:0a00:1", // 10.0.0.1
    "64:ff9b::7f00:1", // NAT64-wrapped loopback
    "2002:7f00:1::", // 6to4-wrapped loopback
    "::",
    "::1",
    "100.64.0.1", // carrier-grade NAT
    "100.127.255.255",
    "192.0.0.1", // IETF protocol assignments
    "192.0.2.5", // TEST-NET-1
    "192.88.99.1", // 6to4 relay anycast
    "198.18.0.1", // benchmarking
    "198.51.100.9", // TEST-NET-2
    "203.0.113.9", // TEST-NET-3
    "224.0.0.1", // multicast
    "239.255.255.250",
    "240.0.0.1", // reserved
    "255.255.255.255", // broadcast
    "fec0::1", // deprecated site-local
    "ff02::1", // multicast
    // Not a parseable literal — the guard fails closed.
    "not-an-ip",
    "1.2.3",
    "12345::",
  ])("blocks %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "172.15.0.1",
    "93.184.216.34",
    "2606:4700::1111",
    "100.63.255.255", // just below the CGNAT block
    "100.128.0.1", // just above it
    "192.0.3.1", // just outside TEST-NET-1
    "198.20.0.1", // just outside the benchmarking block
    "223.255.255.255", // just below multicast
    "::ffff:8080:8080", // IPv4-mapped 128.128.128.128 — public
    "2002:0808:0808::", // 6to4-wrapped 8.8.8.8 — public
  ])("allows %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })
})

describe("isBlockedHostname", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "printer.local",
    "db.internal",
    "app.localhost",
    "metadata.google.internal",
    "metadata.goog",
    "METADATA.GOOG",
    "",
  ])(
    "blocks %s",
    (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(true)
    }
  )

  it.each(["example.com", "ry.dev", "my-portfolio.vercel.app", "localhost.example.com"])(
    "allows %s",
    (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(false)
    }
  )
})

describe("checkUrlSafety", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("accepts a public https URL that resolves publicly", async () => {
    resolvesTo("93.184.216.34")
    const result = await checkUrlSafety("https://example.com/portfolio")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url.hostname).toBe("example.com")
  })

  it("accepts a public http URL", async () => {
    resolvesTo("93.184.216.34")
    await expect(checkUrlSafety("http://example.com")).resolves.toMatchObject({ ok: true })
  })

  it("rejects a non-http(s) protocol", async () => {
    await expect(checkUrlSafety("ftp://example.com/file")).resolves.toEqual({
      ok: false,
      code: "INVALID_URL",
    })
    await expect(checkUrlSafety("file:///etc/passwd")).resolves.toEqual({
      ok: false,
      code: "INVALID_URL",
    })
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("rejects unparseable input", async () => {
    await expect(checkUrlSafety("not a url")).resolves.toEqual({
      ok: false,
      code: "INVALID_URL",
    })
  })

  it("rejects localhost and .local without a DNS lookup", async () => {
    await expect(checkUrlSafety("http://localhost:3000")).resolves.toEqual({
      ok: false,
      code: "BLOCKED_URL",
    })
    await expect(checkUrlSafety("http://nas.local/")).resolves.toEqual({
      ok: false,
      code: "BLOCKED_URL",
    })
    await expect(checkUrlSafety("http://vault.internal/")).resolves.toEqual({
      ok: false,
      code: "BLOCKED_URL",
    })
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("rejects the GCP metadata hostnames without a DNS lookup", async () => {
    await expect(checkUrlSafety("http://metadata.google.internal/")).resolves.toEqual({
      ok: false,
      code: "BLOCKED_URL",
    })
    await expect(checkUrlSafety("https://metadata.goog/computeMetadata/v1/")).resolves.toEqual({
      ok: false,
      code: "BLOCKED_URL",
    })
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("rejects a URL carrying credentials", async () => {
    for (const url of [
      "https://user:pass@example.com/",
      "https://user@example.com/",
      "https://:pass@example.com/",
    ]) {
      await expect(checkUrlSafety(url)).resolves.toEqual({ ok: false, code: "INVALID_URL" })
    }
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("rejects private IP literals without a DNS lookup", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://10.1.2.3/",
      "http://192.168.0.5/",
      "http://172.20.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]:8080/",
      "http://[fd00::1]/",
    ]) {
      await expect(checkUrlSafety(url)).resolves.toEqual({
        ok: false,
        code: "BLOCKED_URL",
      })
    }
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("rejects IPv6 literals that wrap a private IPv4 address", async () => {
    for (const url of [
      // The URL parser normalizes all of these into hex IPv6, which is what the
      // guard has to classify.
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[0:0:0:0:0:ffff:127.0.0.1]/",
      "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
      "http://[::ffff:c0a8:1]/",
      "http://[64:ff9b::7f00:1]/",
      "http://[2002:7f00:1::]/",
    ]) {
      await expect(checkUrlSafety(url)).resolves.toEqual({
        ok: false,
        code: "BLOCKED_URL",
      })
    }
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("rejects IPv4 literals written in decimal or hex shorthand", async () => {
    // new URL() normalizes these to 127.0.0.1 before the guard sees them.
    for (const url of ["http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/"]) {
      await expect(checkUrlSafety(url)).resolves.toEqual({
        ok: false,
        code: "BLOCKED_URL",
      })
    }
  })

  it("rejects reserved IPv4 literals outside the RFC 1918 ranges", async () => {
    for (const url of [
      "http://100.64.0.1/",
      "http://192.0.2.1/",
      "http://198.18.0.1/",
      "http://224.0.0.1/",
      "http://255.255.255.255/",
    ]) {
      await expect(checkUrlSafety(url)).resolves.toEqual({
        ok: false,
        code: "BLOCKED_URL",
      })
    }
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("allows a public IP literal", async () => {
    await expect(checkUrlSafety("http://8.8.8.8/")).resolves.toMatchObject({ ok: true })
    await expect(checkUrlSafety("http://[2606:4700::1111]/")).resolves.toMatchObject({ ok: true })
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("rejects a public hostname that resolves into a private range (DNS rebinding)", async () => {
    resolvesTo("127.0.0.1")
    await expect(checkUrlSafety("https://evil.example.com")).resolves.toEqual({
      ok: false,
      code: "BLOCKED_URL",
    })
  })

  it("rejects when any resolved address is private", async () => {
    resolvesTo("93.184.216.34", "10.0.0.7")
    await expect(checkUrlSafety("https://mixed.example.com")).resolves.toEqual({
      ok: false,
      code: "BLOCKED_URL",
    })
  })

  it("rejects when DNS resolution fails or returns nothing", async () => {
    mockedLookup.mockRejectedValueOnce(new Error("ENOTFOUND"))
    await expect(checkUrlSafety("https://nope.example.com")).resolves.toEqual({
      ok: false,
      code: "BLOCKED_URL",
    })

    mockedLookup.mockResolvedValueOnce([] as never)
    await expect(checkUrlSafety("https://empty.example.com")).resolves.toEqual({
      ok: false,
      code: "BLOCKED_URL",
    })
  })
})

describe("safeLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Promisified call so the callback shape stays visible in each test. */
  function lookup(hostname: string, options: { all?: boolean; family?: number } = {}) {
    return new Promise<{
      err: NodeJS.ErrnoException | null
      addresses?: string | Array<{ address: string; family: number }>
      family?: number
    }>((resolve) => {
      safeLookup(hostname, options, (err, addresses, family) =>
        resolve({ err, addresses, family })
      )
    })
  }

  it("passes a public answer through as a list when all is set", async () => {
    resolvesTo("93.184.216.34", "2606:4700::1111")
    const { err, addresses } = await lookup("example.com", { all: true })
    expect(err).toBeNull()
    expect(addresses).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ])
  })

  it("answers with a single address + family when all is not set", async () => {
    resolvesTo("93.184.216.34")
    const { err, addresses, family } = await lookup("example.com")
    expect(err).toBeNull()
    expect(addresses).toBe("93.184.216.34")
    expect(family).toBe(4)
    // It still resolves with { all: true } internally, so every candidate is seen.
    expect(mockedLookup).toHaveBeenCalledWith("example.com", { all: true })
  })

  it("errors when the only answer is private", async () => {
    resolvesTo("127.0.0.1")
    const { err } = await lookup("rebind.example.com", { all: true })
    expect(err?.code).toBe("EBLOCKEDADDRESS")
    expect(err?.message).toContain("127.0.0.1")
  })

  it("errors when any answer is private (mixed answer)", async () => {
    resolvesTo("93.184.216.34", "169.254.169.254")
    const { err, addresses } = await lookup("mixed.example.com", { all: true })
    expect(err?.code).toBe("EBLOCKEDADDRESS")
    expect(addresses).toBeUndefined()
  })

  it("errors on an empty answer", async () => {
    mockedLookup.mockResolvedValueOnce([] as never)
    const { err } = await lookup("empty.example.com", { all: true })
    expect(err?.code).toBe("EBLOCKEDADDRESS")
  })

  it("propagates a DNS error", async () => {
    const dnsError: NodeJS.ErrnoException = new Error("ENOTFOUND")
    dnsError.code = "ENOTFOUND"
    mockedLookup.mockRejectedValueOnce(dnsError)
    const { err } = await lookup("nope.example.com", { all: true })
    expect(err).toBe(dnsError)
  })
})

describe("extractTitle / extractMetaDescription", () => {
  it("reads the title and decodes entities", () => {
    expect(extractTitle("<html><head><title>Ry &amp; Co.</title></head></html>")).toBe(
      "Ry & Co."
    )
  })

  it("returns undefined when there is no title", () => {
    expect(extractTitle("<html><body>hi</body></html>")).toBeUndefined()
  })

  it("reads a name= meta description", () => {
    expect(
      extractMetaDescription('<meta name="description" content="Frontend engineer">')
    ).toBe("Frontend engineer")
  })

  it("reads an og:description meta tag", () => {
    expect(
      extractMetaDescription("<meta property='og:description' content='Portfolio site'>")
    ).toBe("Portfolio site")
  })
})

describe("extractReadableText", () => {
  const html = `<!doctype html>
<html>
  <head>
    <title>Ry &mdash; Portfolio</title>
    <meta name="description" content="Full-stack engineer &amp; designer">
    <style>body { color: red; }</style>
  </head>
  <body>
    <!-- a comment that should vanish -->
    <script>console.log("tracking")</script>
    <noscript>Enable JavaScript</noscript>
    <svg viewBox="0 0 10 10"><path d="M0 0"/></svg>
    <h1>Hello&nbsp;world</h1>
    <p>I build   things &lt;fast&gt; &amp; well.</p>
    <p>Contact: me&#39;s email</p>
  </body>
</html>`

  it("captures the title and prepends title + meta description", () => {
    const result = extractReadableText(html)
    expect(result.title).toBe("Ry &mdash; Portfolio")
    expect(result.text).toContain("Page title: Ry &mdash; Portfolio")
    expect(result.text).toContain("Meta description: Full-stack engineer & designer")
  })

  it("strips script, style, noscript, svg and comments", () => {
    const { text } = extractReadableText(html)
    expect(text).not.toContain("tracking")
    expect(text).not.toContain("color: red")
    expect(text).not.toContain("Enable JavaScript")
    expect(text).not.toContain("M0 0")
    expect(text).not.toContain("a comment that should vanish")
    // No markup tags survive (the decoded "&lt;fast&gt;" text does).
    expect(text).not.toMatch(/<\/?(?:html|head|body|p|div|h1|script|style|svg)\b/i)
  })

  it("decodes entities and collapses whitespace", () => {
    const { text } = extractReadableText(html)
    expect(text).toContain("Hello world")
    expect(text).toContain("I build things <fast> & well.")
    expect(text).toContain("Contact: me's email")
    expect(text).not.toMatch(/ {2,}/)
  })

  it("handles a document with no head, title or meta", () => {
    const result = extractReadableText("<div><p>Just text</p></div>")
    expect(result.title).toBeUndefined()
    expect(result.text).toBe("Just text")
  })
})
