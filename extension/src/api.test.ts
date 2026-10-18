import { afterEach, describe, expect, it, vi } from "vitest"

import {
  fetchSearchLinks,
  parseGrounding,
  parseQualifyResponse,
  parseSignature,
  postJob,
  qualifyPostings,
} from "./api"

/**
 * The grounding block is optional on both draft routes: absent on a clean draft,
 * and absent entirely against a RoleSpec deployed before the evidence check
 * existed. The parser has to degrade to "nothing to warn about" for anything it
 * does not recognise, never throw and never invent a warning.
 */
describe("parseGrounding", () => {
  it("reads the claimed requirements", () => {
    expect(
      parseGrounding({
        claimed: [
          { keyword: "JPQL", verdict: "unsupported", reason: "Nothing supports this." },
          { keyword: "JMS", verdict: "unsupported", reason: "Nothing supports this." },
        ],
      })
    ).toEqual({
      claimed: [
        { keyword: "JPQL", reason: "Nothing supports this." },
        { keyword: "JMS", reason: "Nothing supports this." },
      ],
      namedAsGap: [],
    })
  })

  it("reads the quiet tier when the server sends one", () => {
    expect(
      parseGrounding({
        claimed: [],
        namedAsGap: [
          { keyword: "Kafka", verdict: "unsupported", reason: "No evidence." },
        ],
      })
    ).toEqual({
      claimed: [],
      namedAsGap: [{ keyword: "Kafka", reason: "No evidence." }],
    })
  })

  it("treats a server with no namedAsGap field as having nothing quiet to report", () => {
    // The shape an older RoleSpec sends. It must still yield its warnings.
    expect(parseGrounding({ claimed: [{ keyword: "JPQL", reason: "No evidence." }] })).toEqual({
      claimed: [{ keyword: "JPQL", reason: "No evidence." }],
      namedAsGap: [],
    })
  })

  it("returns nothing for an absent or malformed block", () => {
    const empty = { claimed: [], namedAsGap: [] }
    expect(parseGrounding(undefined)).toEqual(empty)
    expect(parseGrounding(null)).toEqual(empty)
    expect(parseGrounding("JPQL")).toEqual(empty)
    expect(parseGrounding({})).toEqual(empty)
    expect(parseGrounding({ claimed: "JPQL" })).toEqual(empty)
    expect(parseGrounding({ claimed: [], namedAsGap: 7 })).toEqual(empty)
    expect(parseGrounding({ namedAsGap: [{ nope: true }] })).toEqual(empty)
  })

  it("skips entries without a usable keyword and tolerates a missing reason", () => {
    expect(
      parseGrounding({
        claimed: [{ keyword: "  " }, null, 7, { keyword: "JPQL" }],
        namedAsGap: [{ keyword: "Kafka", reason: 9 }],
      })
    ).toEqual({
      claimed: [{ keyword: "JPQL", reason: "" }],
      namedAsGap: [{ keyword: "Kafka", reason: "" }],
    })
  })
})

/**
 * The signature finding rides the same optional-field envelope as the grounding
 * block: absent on a clean draft, absent against an older RoleSpec, and — the
 * part worth pinning — absent for the `missing_name` kind, which the server does
 * not send and the client refuses anyway.
 */
describe("parseSignature", () => {
  it("reads a wrong_name finding", () => {
    expect(
      parseSignature({
        issue: "wrong_name",
        expectedName: "Marisol Reyes",
        signature: ["Best,", "Cebu General Hospital staff nurse"],
        offending: ["Cebu General Hospital staff nurse"],
      })
    ).toEqual({
      issue: "wrong_name",
      expectedName: "Marisol Reyes",
      offending: ["Cebu General Hospital staff nurse"],
    })
  })

  it("reads an unexpected_name finding, which has no expected name", () => {
    expect(
      parseSignature({ issue: "unexpected_name", expectedName: null, offending: ["Alex"] })
    ).toEqual({ issue: "unexpected_name", expectedName: null, offending: ["Alex"] })
  })

  it("refuses a missing_name finding even if a server ever sends one", () => {
    expect(
      parseSignature({ issue: "missing_name", expectedName: "Marisol Reyes", offending: [] })
    ).toBeNull()
  })

  it("degrades to null on anything unexpected", () => {
    expect(parseSignature(undefined)).toBeNull()
    expect(parseSignature(null)).toBeNull()
    expect(parseSignature("wrong_name")).toBeNull()
    expect(parseSignature({})).toBeNull()
    expect(parseSignature({ issue: "wrong_name" })).toBeNull()
    expect(parseSignature({ issue: "wrong_name", offending: "Alex" })).toBeNull()
    expect(parseSignature({ issue: "wrong_name", offending: [] })).toBeNull()
    expect(parseSignature({ issue: "wrong_name", offending: [7, ""] })).toBeNull()
  })

  it("drops a non-string expectedName rather than rendering it", () => {
    expect(
      parseSignature({ issue: "wrong_name", expectedName: 7, offending: ["Alex"] })
    ).toEqual({ issue: "wrong_name", expectedName: null, offending: ["Alex"] })
  })
})

/**
 * The 201 body grew `requirements` and `qualification` after `risk`. Both are
 * optional: a RoleSpec older than either sends neither, and that must still read
 * as a clean save rather than an error.
 */
describe("postJob 201 body", () => {
  const settings = { appUrl: "https://rolespec.test", apiToken: "token" }
  const job = { companyName: "Acme", jobTitle: "Engineer" }

  function respondWith(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 201 }))
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("carries the requirements and qualification through", async () => {
    respondWith({
      id: "job_1",
      risk: { level: "LOW", reasons: ["Reposted"] },
      requirements: ["NO_SPONSORSHIP", 7, "US_ONLY"],
      qualification: {
        verdict: "WEAK",
        nextAction: "Only apply if you can relocate.",
        match: { level: "CONCERN", matchedCapabilities: ["TypeScript"], confirmedCount: 1 },
      },
    })

    const result = await postJob(settings, job)

    expect(result).toMatchObject({
      ok: true,
      kind: "saved",
      id: "job_1",
      risk: { level: "LOW", reasons: ["Reposted"] },
      requirements: ["NO_SPONSORSHIP", "US_ONLY"],
      qualification: { verdict: "WEAK", nextAction: "Only apply if you can relocate." },
    })
  })

  it("reads an older 201 with neither field as a clean save", async () => {
    respondWith({ id: "job_2" })

    const result = await postJob(settings, job)

    expect(result).toEqual({ ok: true, kind: "saved", id: "job_2", requirements: [] })
  })

  it("drops a malformed qualification without spoiling the save", async () => {
    respondWith({ id: "job_3", requirements: "NO_SPONSORSHIP", qualification: { verdict: "MAYBE" } })

    const result = await postJob(settings, job)

    expect(result).toEqual({ ok: true, kind: "saved", id: "job_3", requirements: [] })
  })

  /**
   * A re-clip of a tab already in RoleSpec. The route answers 200, which used to
   * fall through to "Unexpected response from RoleSpec (200)." — an error message
   * for something that is not an error.
   */
  it("reads a duplicate 200 as a success pointing at the existing job", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "app_9", duplicate: true }), { status: 200 }))
    )

    expect(await postJob(settings, job)).toEqual({ ok: true, kind: "duplicate", id: "app_9" })
  })

  it("does not read a 200 without the duplicate flag as a duplicate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "app_9" }), { status: 200 }))
    )

    const result = await postJob(settings, job)

    expect(result).toEqual({
      ok: false,
      kind: "unknown",
      message: "Unexpected response from RoleSpec (200).",
    })
  })

  it("carries the market fit and confidence through", async () => {
    respondWith({
      id: "job_4",
      marketFit: { fit: "IN_MARKET", label: "Open to PH", reason: "Open to candidates in the Philippines." },
      confidence: { level: "MEDIUM", summary: "Named employer. Posting age unknown." },
    })

    const result = await postJob(settings, job)

    expect(result).toEqual({
      ok: true,
      kind: "saved",
      id: "job_4",
      requirements: [],
      marketFit: {
        fit: "IN_MARKET",
        label: "Open to PH",
        reason: "Open to candidates in the Philippines.",
      },
      confidence: { level: "MEDIUM", summary: "Named employer. Posting age unknown." },
    })
  })

  it("drops a malformed market fit or confidence without spoiling the save", async () => {
    respondWith({
      id: "job_5",
      marketFit: { fit: "IN_MARKET" },
      confidence: { level: "PRETTY_SURE", summary: "Trust us." },
    })

    const result = await postJob(settings, job)

    expect(result).toEqual({ ok: true, kind: "saved", id: "job_5", requirements: [] })
  })
})

describe("parseQualifyResponse", () => {
  it("reads well-formed results", () => {
    expect(
      parseQualifyResponse({
        profileComplete: true,
        results: [
          { key: "k1", verdict: "STRONG", riskLevel: "HIGH", marketFit: "In market", confirmedCount: 2, matched: ["IV", " Triage "] },
        ],
      }),
    ).toEqual({
      profileComplete: true,
      results: [{ key: "k1", verdict: "STRONG", riskLevel: "HIGH", marketFit: "In market", confirmedCount: 2, matched: ["IV", "Triage"] }],
    })
  })

  it("drops malformed rows and defaults unknown fields", () => {
    const parsed = parseQualifyResponse({
      profileComplete: true,
      results: [
        null,
        "k",
        { verdict: "STRONG" },
        { key: "k2", verdict: "AMAZING" },
        { key: "k3", verdict: "WEAK", riskLevel: "EXTREME", confirmedCount: -1, matched: [1, "", "SQL"] },
      ],
    })
    expect(parsed.results).toEqual([
      { key: "k3", verdict: "WEAK", riskLevel: null, marketFit: null, confirmedCount: 0, matched: ["SQL"] },
    ])
  })

  it("reads anything but an explicit profileComplete: true as incomplete", () => {
    expect(parseQualifyResponse(null)).toEqual({ profileComplete: false, results: [] })
    expect(parseQualifyResponse("oops").profileComplete).toBe(false)
    expect(parseQualifyResponse({ profileComplete: "yes", results: "x" })).toEqual({ profileComplete: false, results: [] })
  })
})

describe("qualifyPostings", () => {
  const settings = { appUrl: "http://localhost:3100", apiToken: "rspec_test" }
  afterEach(() => vi.unstubAllGlobals())

  it("posts at most 40 postings with the bearer token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ profileComplete: true, results: [] }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const postings = Array.from({ length: 45 }, (_, i) => ({ key: `k${i}`, title: `Job ${i}` }))
    const result = await qualifyPostings(settings, postings)
    expect(result).toEqual({ ok: true, profileComplete: true, results: [] })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://localhost:3100/api/extension/qualify")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer rspec_test")
    expect(JSON.parse(init.body as string).postings).toHaveLength(40)
  })

  it.each([
    [401, "unauthorized"],
    [429, "rate_limited"],
    [400, "validation"],
    [500, "unknown"],
  ])("maps %s to %s", async (status, reason) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })))
    expect(await qualifyPostings(settings, [{ key: "k", title: "t" }])).toEqual({ ok: false, reason })
  })

  it("maps a network failure and a non-JSON 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch") }))
    expect(await qualifyPostings(settings, [{ key: "k", title: "t" }])).toEqual({ ok: false, reason: "network" })
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })))
    expect(await qualifyPostings(settings, [{ key: "k", title: "t" }])).toEqual({ ok: false, reason: "unknown" })
  })
})

describe("fetchSearchLinks", () => {
  const settings = { appUrl: "http://localhost:3100", apiToken: "rspec_test" }
  afterEach(() => vi.unstubAllGlobals())

  it("GETs the search links with the bearer token and keeps usable rows", async () => {
    const body = {
      groups: [
        {
          role: "Backend Engineer",
          links: [
            {
              board: "LINKEDIN",
              label: "LinkedIn",
              query: "backend engineer",
              location: "Manila",
              url: "https://www.linkedin.com/jobs/search/?keywords=backend",
            },
            { board: "MONSTER", label: "x", query: "q", location: null, url: "https://example.com" },
            { board: "INDEED", label: "Indeed", query: "q", location: null, url: "javascript:alert(1)" },
          ],
        },
        { role: "Empty", links: [] },
      ],
      activeTargetRoleCount: 4,
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchSearchLinks(settings)
    expect(result).toEqual({
      ok: true,
      data: {
        groups: [
          {
            role: "Backend Engineer",
            links: [
              {
                board: "LINKEDIN",
                label: "LinkedIn",
                query: "backend engineer",
                location: "Manila",
                url: "https://www.linkedin.com/jobs/search/?keywords=backend",
              },
            ],
          },
        ],
        activeTargetRoleCount: 4,
      },
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://localhost:3100/api/extension/search-links")
    expect(init.method).toBe("GET")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer rspec_test")
  })

  it("maps a 401 to unauthorized with the server's message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 }))
    )
    expect(await fetchSearchLinks(settings)).toEqual({
      ok: false,
      kind: "unauthorized",
      message: "Invalid token",
    })
  })

  it("maps a 429 and a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })))
    expect(await fetchSearchLinks(settings)).toMatchObject({ ok: false, kind: "rate_limited" })
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch") }))
    expect(await fetchSearchLinks(settings)).toMatchObject({ ok: false, kind: "network" })
  })
})
