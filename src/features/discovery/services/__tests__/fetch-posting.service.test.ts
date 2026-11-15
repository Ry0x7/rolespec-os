// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  MAX_POSTING_BYTES,
  fetchPostingFromUrl,
  parsePostingUrl,
  parseTitlePattern,
} from "../fetch-posting.service"

const URL_UNDER_TEST = "https://boards.example.com/acme/jobs/1"

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  })
}

/** Shaped like the JSON-LD an ATS job page embeds. */
const JOB_POSTING_LD = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Senior Frontend Engineer",
  datePosted: "2026-08-20",
  employmentType: "FULL_TIME",
  jobLocationType: "TELECOMMUTE",
  hiringOrganization: { "@type": "Organization", name: "Acme Inc" },
  jobLocation: {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Berlin",
      addressCountry: "DE",
    },
  },
  baseSalary: {
    "@type": "MonetaryAmount",
    currency: "EUR",
    value: { "@type": "QuantitativeValue", minValue: 70000, maxValue: 90000, unitText: "YEAR" },
  },
  description: "<p>Ship <b>React</b> features.</p><script>alert(1)</script>",
}

/**
 * Serializes like a real page does: an embedded `</script>` inside the JSON is
 * escaped, otherwise it would close the block early.
 */
function pageWithLd(payload: unknown) {
  const json = JSON.stringify(payload).replace(/<\/script>/gi, "<\\/script>")
  return `<!doctype html><html><head><title>ignored</title>
    <script type="application/ld+json">${json}</script>
    </head><body><h1>Job</h1></body></html>`
}

function signal() {
  return new AbortController().signal
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("parsePostingUrl", () => {
  it("accepts a public http(s) posting URL", () => {
    const parsed = parsePostingUrl(URL_UNDER_TEST)

    expect("url" in parsed && parsed.url.toString()).toBe(URL_UNDER_TEST)
  })

  it.each([
    ["http://localhost:3000/jobs/1", "blocked-host"],
    ["http://LOCALHOST/jobs/1", "blocked-host"],
    ["http://127.0.0.1/jobs/1", "blocked-host"],
    ["http://10.0.0.5/jobs/1", "blocked-host"],
    ["http://172.16.4.4/jobs/1", "blocked-host"],
    ["http://192.168.1.1/jobs/1", "blocked-host"],
    ["http://169.254.169.254/latest/meta-data", "blocked-host"],
    ["http://[::1]/jobs/1", "blocked-host"],
    ["http://2130706433/jobs/1", "blocked-host"],
    ["http://intranet/jobs/1", "blocked-host"],
    ["http://build.internal/jobs/1", "blocked-host"],
    ["ftp://example.com/jobs/1", "invalid-url"],
    ["file:///etc/passwd", "invalid-url"],
    ["javascript:alert(1)", "invalid-url"],
    ["http://user:pass@example.com/jobs/1", "invalid-url"],
    ["", "invalid-url"],
  ])("refuses %s", (input, reason) => {
    const parsed = parsePostingUrl(input)

    expect("reason" in parsed && parsed.reason).toBe(reason)
  })

  it("never requests a blocked host", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    const result = await fetchPostingFromUrl("http://127.0.0.1:8080/jobs/1", signal())

    expect(result).toMatchObject({ ok: false, reason: "blocked-host" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("fetchPostingFromUrl — JSON-LD", () => {
  it("extracts the posting and sends the adapter headers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(htmlResponse(pageWithLd(JOB_POSTING_LD)))

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extractionMethod).toBe("json-ld")
    expect(result.posting).toMatchObject({
      provider: "web",
      externalId: URL_UNDER_TEST,
      title: "Senior Frontend Engineer",
      companyName: "Acme Inc",
      url: URL_UNDER_TEST,
      canonicalUrl: URL_UNDER_TEST,
      location: "Berlin, DE",
      workType: "REMOTE",
      salaryText: "70000 - 90000 EUR per year",
      // HTML stripped by the shared normalizer, script contents dropped.
      description: "Ship React features.",
    })
    expect(result.posting.postedAt?.toISOString()).toBe("2026-08-20T00:00:00.000Z")

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(init.headers).toMatchObject({ accept: "text/html" })
    expect(String((init.headers as Record<string, string>)["user-agent"])).toContain("RoleSpec")
  })

  it("finds the posting inside an array block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(pageWithLd([{ "@type": "BreadcrumbList" }, JOB_POSTING_LD]))
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result).toMatchObject({ ok: true, extractionMethod: "json-ld" })
    expect(result.ok && result.posting.title).toBe("Senior Frontend Engineer")
  })

  it("finds the posting inside an @graph block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        pageWithLd({
          "@context": "https://schema.org",
          "@graph": [{ "@type": "WebPage" }, JOB_POSTING_LD],
        })
      )
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result).toMatchObject({ ok: true, extractionMethod: "json-ld" })
    expect(result.ok && result.posting.companyName).toBe("Acme Inc")
  })

  it("skips a malformed block and uses the good one after it", async () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{ not json </script>
      <script type="application/ld+json">${JSON.stringify({
        ...JOB_POSTING_LD,
        description: "<p>Ship React features.</p>",
      })}</script>
      </head><body></body></html>`
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse(html))

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result).toMatchObject({ ok: true, extractionMethod: "json-ld" })
  })

  it("falls back when the JSON-LD posting has no company", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        `<!doctype html><html><head>
          <script type="application/ld+json">${JSON.stringify({
            "@type": "JobPosting",
            title: "Engineer",
          })}</script>
          <meta property="og:title" content="Engineer" />
          <meta property="og:site_name" content="Acme Careers" />
        </head><body></body></html>`
      )
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result).toMatchObject({ ok: true, extractionMethod: "meta-fallback" })
  })
})

describe("parseTitlePattern", () => {
  it("reads Greenhouse's exact application title, keeping a hyphenated job title", () => {
    // The live `<title>` of https://boards.greenhouse.io/gitlab/jobs/8503792002.
    expect(parseTitlePattern("Job Application for Account Executive - Italy at GitLab")).toEqual({
      title: "Account Executive - Italy",
      companyName: "GitLab",
    })
  })

  it("tolerates a trailing site suffix on the company", () => {
    expect(parseTitlePattern("Job Application for Engineer at GitLab - Careers")).toEqual({
      title: "Engineer",
      companyName: "GitLab",
    })
  })

  it("reads a plain '{title} at {company}' title", () => {
    expect(parseTitlePattern("Staff Frontend Engineer at Acme")).toEqual({
      title: "Staff Frontend Engineer",
      companyName: "Acme",
    })
  })

  it("splits on the last ' at ' so a job title containing 'at' survives", () => {
    expect(parseTitlePattern("Job Application for Engineer at Scale at Acme")).toEqual({
      title: "Engineer at Scale",
      companyName: "Acme",
    })
  })

  it.each([
    "Careers",
    "Frontend Engineer",
    "Frontend Engineer | Acme",
    "Engineer at Acme at Berlin",
    "Engineer at A",
    "",
    undefined,
  ])("returns null for %s rather than guessing", (input) => {
    expect(parseTitlePattern(input)).toBeNull()
  })
})

describe("fetchPostingFromUrl — ATS API", () => {
  const GREENHOUSE_URL = "https://boards.greenhouse.io/gitlab/jobs/8503792002"

  /** What a client-rendered Greenhouse page gives the HTML path today. */
  const THIN_GREENHOUSE_PAGE = `<!doctype html><html><head>
      <title>Job Application for Account Executive - Italy at GitLab</title>
      <meta name="description" content="Remote, Italy">
    </head><body></body></html>`

  it("reads the posting from the ATS instead of the page and never fetches it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 8503792002,
          title: "Account Executive - Italy",
          company_name: "GitLab",
          absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/8503792002",
          location: { name: "Remote, Italy" },
          updated_at: "2026-08-31T17:56:36-04:00",
          content: "&lt;p&gt;Sell &lt;b&gt;GitLab&lt;/b&gt; in Italy.&lt;/p&gt;",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )

    const result = await fetchPostingFromUrl(GREENHOUSE_URL, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extractionMethod).toBe("ats-api")
    expect(result.posting).toMatchObject({
      // Real provenance, not the anonymous "web" provider.
      provider: "greenhouse",
      externalId: "8503792002",
      title: "Account Executive - Italy",
      companyName: "GitLab",
      location: "Remote, Italy",
      description: "Sell GitLab in Italy.",
    })
    // `provider:externalId` is the dedupe fallback; the canonical URL is the key.
    expect(result.posting.canonicalUrl).toBe(
      "https://job-boards.greenhouse.io/gitlab/jobs/8503792002"
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8503792002"
    )
  })

  it("falls back silently to the page when the ATS API 404s", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(htmlResponse(THIN_GREENHOUSE_PAGE))

    const result = await fetchPostingFromUrl(GREENHOUSE_URL, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extractionMethod).toBe("title-pattern")
    expect(result.posting).toMatchObject({ provider: "web", companyName: "GitLab" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("falls back to the page when the ATS request throws", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(htmlResponse(THIN_GREENHOUSE_PAGE))

    const result = await fetchPostingFromUrl(GREENHOUSE_URL, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extractionMethod).toBe("title-pattern")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("falls back to the page when the ATS answers an unusable shape", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(htmlResponse(THIN_GREENHOUSE_PAGE))

    const result = await fetchPostingFromUrl(GREENHOUSE_URL, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extractionMethod).toBe("title-pattern")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not consult the ATS for a gh_jid on a company's own domain", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(`<!doctype html><html><head>
        <title>Abuse Investigator at Stripe</title>
      </head><body></body></html>`)
    )

    const result = await fetchPostingFromUrl(
      "https://stripe.com/jobs/search?gh_jid=8172487",
      signal()
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extractionMethod).toBe("title-pattern")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("stripe.com")
  })
})

describe("fetchPostingFromUrl — title pattern", () => {
  it("uses the parsed company instead of the hostname", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        `<!doctype html><html><head>
          <title>Job Application for Account Executive - Italy at GitLab</title>
          <meta property="og:title" content="Account Executive - Italy">
          <meta name="description" content="Remote, Italy">
        </head><body></body></html>`
      )
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extractionMethod).toBe("title-pattern")
    expect(result.posting).toMatchObject({
      title: "Account Executive - Italy",
      companyName: "GitLab",
      description: "Remote, Italy",
    })
  })

  it("stays on the meta fallback when the title matches no pattern", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        `<!doctype html><html><head>
          <title>Frontend Engineer | Acme Careers</title>
        </head><body></body></html>`
      )
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extractionMethod).toBe("meta-fallback")
    expect(result.posting).toMatchObject({
      // The meta path now strips the site chrome off the title; the company is
      // still the honest hostname, because nothing on the page named it.
      title: "Frontend Engineer",
      companyName: "boards.example.com",
    })
  })

  it("ignores a parsed company that repeats the title and uses og:site_name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        `<!doctype html><html><head>
          <title>Christian Software Developer at Christian Software Developer</title>
          <meta property="og:title" content="Christian Software Developer">
          <meta property="og:site_name" content="Northwind Careers">
        </head><body></body></html>`
      )
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The pattern matched, but it named the employer after the role, so the
    // meta fallback answers instead.
    expect(result.extractionMethod).toBe("meta-fallback")
    expect(result.posting).toMatchObject({
      title: "Christian Software Developer",
      companyName: "Northwind Careers",
    })
  })

  it("declines the posting when the only company candidate is the title itself", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        `<!doctype html><html><head>
          <title>boards.example.com</title>
        </head><body></body></html>`
      )
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    // No og:site_name, and the hostname equals the title, so there is no
    // company left to state — better no posting than the role as the employer.
    expect(result).toMatchObject({ ok: false, reason: "no-posting" })
  })

  it("still reads a plain 'Title at Company' page title", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        `<!doctype html><html><head>
          <title>Senior Engineer at Northwind Labs</title>
        </head><body></body></html>`
      )
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extractionMethod).toBe("title-pattern")
    expect(result.posting).toMatchObject({
      title: "Senior Engineer",
      companyName: "Northwind Labs",
    })
  })
})

describe("fetchPostingFromUrl — meta fallback", () => {
  /** The real Mozilla position-page shape: role wrapped in site chrome. */
  it("strips site chrome off the title and keeps the role", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        `<!doctype html><html><head>
          <title>Mozilla Careers — Staff Data Scientist, Ads — Open Positions</title>
        </head><body></body></html>`
      )
    )

    const result = await fetchPostingFromUrl("https://www.mozilla.org/en-US/careers/position/gh/1", signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extractionMethod).toBe("meta-fallback")
    expect(result.posting.title).toBe("Staff Data Scientist, Ads")
  })

  it("drops the segment that is the site name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        `<!doctype html><html><head>
          <title>Senior Engineer | Acme</title>
          <meta property="og:site_name" content="Acme">
        </head><body></body></html>`
      )
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.posting).toMatchObject({ title: "Senior Engineer", companyName: "Acme" })
  })

  it("leaves a plain title alone", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        `<!doctype html><html><head>
          <title>Senior Backend Engineer</title>
        </head><body></body></html>`
      )
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.posting.title).toBe("Senior Backend Engineer")
  })

  it("keeps the original when every segment reads as chrome", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        `<!doctype html><html><head>
          <title>Acme — Careers</title>
          <meta property="og:site_name" content="Acme">
        </head><body></body></html>`
      )
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.posting.title).toBe("Acme — Careers")
  })

  it("uses og:title, og:site_name and the description meta", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse(
        `<!doctype html><html><head>
          <meta property="og:title" content="Staff Engineer &amp; Lead">
          <meta property='og:site_name' content='Acme Careers'>
          <meta name="description" content="We are hiring a Staff Engineer.">
        </head><body></body></html>`
      )
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extractionMethod).toBe("meta-fallback")
    expect(result.posting).toMatchObject({
      provider: "web",
      title: "Staff Engineer & Lead",
      companyName: "Acme Careers",
      description: "We are hiring a Staff Engineer.",
    })
  })

  it("falls back to <title> and the host when there is no og data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse("<html><head><title>Backend Engineer</title></head><body></body></html>")
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result.ok && result.posting).toMatchObject({
      title: "Backend Engineer",
      companyName: "boards.example.com",
    })
  })

  it("reports no-posting when the page has no title at all", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse("<html><body><p>nothing here</p></body></html>")
    )

    expect(await fetchPostingFromUrl(URL_UNDER_TEST, signal())).toMatchObject({
      ok: false,
      reason: "no-posting",
    })
  })
})

describe("fetchPostingFromUrl — refusals", () => {
  it.each([
    [403, "blocked"],
    [429, "blocked"],
    [404, "not-found"],
    [500, "unavailable"],
  ])("returns a typed failure for %i and never retries", async (status, reason) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("nope", { status }))

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result).toMatchObject({ ok: false, reason })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("rejects a non-HTML content type", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    )

    expect(await fetchPostingFromUrl(URL_UNDER_TEST, signal())).toMatchObject({
      ok: false,
      reason: "not-html",
    })
  })

  it("rejects a body that is not markup even with an HTML content type", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse("Access denied."))

    expect(await fetchPostingFromUrl(URL_UNDER_TEST, signal())).toMatchObject({
      ok: false,
      reason: "not-html",
    })
  })

  it("refuses a declared content-length past the cap without reading it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": String(MAX_POSTING_BYTES + 1),
        },
      })
    )

    expect(await fetchPostingFromUrl(URL_UNDER_TEST, signal())).toMatchObject({
      ok: false,
      reason: "too-large",
    })
  })

  it("aborts a stream that grows past the cap", async () => {
    const chunk = new TextEncoder().encode("<html>".padEnd(512 * 1024, "x"))
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200, headers: { "content-type": "text/html" } })
    )

    expect(await fetchPostingFromUrl(URL_UNDER_TEST, signal())).toMatchObject({
      ok: false,
      reason: "too-large",
    })
    expect(cancelled).toBe(true)
  })

  it("reports a network failure rather than throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"))

    expect(await fetchPostingFromUrl(URL_UNDER_TEST, signal())).toMatchObject({
      ok: false,
      reason: "network",
    })
  })

  it("reports a timeout when the caller's signal aborted", async () => {
    const controller = new AbortController()
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      controller.abort()
      return Promise.reject(new DOMException("aborted", "AbortError"))
    })

    expect(await fetchPostingFromUrl(URL_UNDER_TEST, controller.signal)).toMatchObject({
      ok: false,
      reason: "timeout",
    })
  })
})

describe("fetchPostingFromUrl — redirects", () => {
  it("follows a redirect and keeps the final URL as the posting URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "https://job-boards.example.com/acme/jobs/1" },
        })
      )
      .mockResolvedValueOnce(htmlResponse(pageWithLd(JOB_POSTING_LD)))

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.ok && result.posting.url).toBe("https://job-boards.example.com/acme/jobs/1")
  })

  it("refuses a redirect into a private host before requesting it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      })
    )

    const result = await fetchPostingFromUrl(URL_UNDER_TEST, signal())

    expect(result).toMatchObject({ ok: false, reason: "blocked-host" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("gives up on a redirect loop", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302, headers: { location: URL_UNDER_TEST } })
    )

    expect(await fetchPostingFromUrl(URL_UNDER_TEST, signal())).toMatchObject({
      ok: false,
      reason: "unavailable",
    })
  })
})
