// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { deriveBoardSlugs, probeBoards } from "../company-board-probe.service"

function signal() {
  return new AbortController().signal
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

function htmlResponse(body: string) {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } })
}

const NOT_FOUND = () => new Response("{}", { status: 404 })

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("deriveBoardSlugs", () => {
  it("collapses to a single candidate for a one-word name", () => {
    expect(deriveBoardSlugs("GitLab")).toEqual(["gitlab"])
  })

  it("tries joined, hyphenated and suffix-stripped forms in order", () => {
    expect(deriveBoardSlugs("Acme Corp")).toEqual(["acmecorp", "acme-corp", "acme"])
  })

  it("keeps every word when the last one is not a legal suffix", () => {
    expect(deriveBoardSlugs("Ramp Financial")).toEqual(["rampfinancial", "ramp-financial"])
  })

  it("strips punctuation and accents and spells out an ampersand", () => {
    expect(deriveBoardSlugs("Café & Co.")).toEqual([
      "cafeandco",
      "cafe-and-co",
      // "co" is a legal suffix, so the last-word-dropped forms are tried too.
      "cafeand",
      "cafe-and",
    ])
  })

  it("never derives more than four candidates", () => {
    expect(deriveBoardSlugs("One Two Three Four Five Ltd").length).toBeLessThanOrEqual(4)
  })

  it.each(["", "   ", "!!!", "***"])("returns nothing for %p", (name) => {
    expect(deriveBoardSlugs(name)).toEqual([])
  })

  it("drops a candidate that is too long to be a board slug", () => {
    expect(deriveBoardSlugs("a".repeat(150))).toEqual([])
  })
})

describe("probeBoards", () => {
  it("probes all five providers per slug and reports only the boards that answered", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith("https://boards-api.greenhouse.io/v1/boards/gitlab/jobs")) {
        return jsonResponse({ jobs: [{ id: 1 }, { id: 2 }] })
      }
      return NOT_FOUND()
    })

    const hits = await probeBoards(["gitlab"], signal())

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(hits).toEqual([{ provider: "greenhouse", slug: "gitlab", postingCount: 2 }])
  })

  it("counts a BambooHR board's `result` array", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === "https://kumu.bamboohr.com/careers/list"
        ? jsonResponse({ meta: { totalCount: 2 }, result: [{ id: "336" }, { id: "337" }] })
        : NOT_FOUND()
    )

    expect(await probeBoards(["kumu"], signal())).toEqual([
      { provider: "bamboohr", slug: "kumu", postingCount: 2 },
    ])
  })

  it("counts a Freshteam board page's posting blocks", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === "https://acme.freshteam.com/jobs"
        ? htmlResponse(
            '<html><body><form class="job-search-form" action="/jobs/search"></form>' +
              '<ul class="job-list">' +
              '<li class="heading"><a href="/jobs/aa/one"></a></li>' +
              '<li class="heading"><a href="/jobs/bb/two"></a></li>' +
              "</ul></body></html>"
          )
        : NOT_FOUND()
    )

    expect(await probeBoards(["acme"], signal())).toEqual([
      { provider: "freshteam", slug: "acme", postingCount: 2 },
    ])
  })

  it("reports a real Freshteam board with no open roles", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === "https://acme.freshteam.com/jobs"
        ? htmlResponse('<html><body><form class="job-search-form"></form></body></html>')
        : NOT_FOUND()
    )

    expect(await probeBoards(["acme"], signal())).toEqual([
      { provider: "freshteam", slug: "acme", postingCount: 0 },
    ])
  })

  it("does not treat Freshteam's unclaimed-subdomain page as a board", async () => {
    // Every `*.freshteam.com` answers 200; an unclaimed one serves this, which
    // still says "Freshteam". Verified live on 2026-09-14 with kumu.freshteam.com.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === "https://acme.freshteam.com/jobs"
        ? htmlResponse(
            '<html><head><title>Freshteam</title></head><body>' +
              '<div class="invalid-domain-wrapper"><div class="no-ats">' +
              "We couldn't find this domain</div></div></body></html>"
          )
        : NOT_FOUND()
    )

    expect(await probeBoards(["acme"], signal())).toEqual([])
  })

  it("never probes Workday, which has no slug to guess", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => NOT_FOUND())

    await probeBoards(["acme"], signal())

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes("myworkdayjobs.com"))).toBe(false)
    expect(urls).toHaveLength(5)
  })

  it("counts a Lever board's bare array and an Ashby board's listed jobs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith("https://api.lever.co/")) return jsonResponse([{ id: "a" }])
      if (url.startsWith("https://api.ashbyhq.com/")) {
        return jsonResponse({ jobs: [{ id: "a" }, { id: "b", isListed: false }, { id: "c" }] })
      }
      return NOT_FOUND()
    })

    const hits = await probeBoards(["acme"], signal())

    expect(hits).toEqual([
      { provider: "ashby", slug: "acme", postingCount: 2 },
      { provider: "lever", slug: "acme", postingCount: 1 },
    ])
  })

  it("reports a real board with no open roles rather than hiding it", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).startsWith("https://boards-api.greenhouse.io/")
        ? jsonResponse({ jobs: [] })
        : NOT_FOUND()
    )

    expect(await probeBoards(["acme"], signal())).toEqual([
      { provider: "greenhouse", slug: "acme", postingCount: 0 },
    ])
  })

  it("isolates a failing provider from the others", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith("https://boards-api.greenhouse.io/")) throw new Error("network")
      if (url.startsWith("https://api.lever.co/")) return jsonResponse([{ id: "a" }])
      return NOT_FOUND()
    })

    expect(await probeBoards(["acme"], signal())).toEqual([
      { provider: "lever", slug: "acme", postingCount: 1 },
    ])
  })

  it("ignores a response whose shape is not the documented one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ unexpected: true }))

    expect(await probeBoards(["acme"], signal())).toEqual([])
  })

  it("makes no request at all when no slug could be derived", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    expect(await probeBoards([], signal())).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("stays at or under twenty requests for the widest name", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => NOT_FOUND())

    await probeBoards(deriveBoardSlugs("One Two Three Four Five Ltd"), signal())

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(20)
  })
})
