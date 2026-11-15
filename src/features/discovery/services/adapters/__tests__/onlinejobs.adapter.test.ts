// @vitest-environment node
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  ONLINEJOBS_RESULT_LIMIT,
  UNDISCLOSED_EMPLOYER,
  clearOnlinejobsRunClaims,
  onlinejobsAdapter,
  parseOnlinejobsPage,
} from "../onlinejobs.adapter"

/** OnlineJobs.ph has a cross-company search, so it ignores the watchlist. */
const CONTEXT = { atsWatchlist: { greenhouse: [], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] } }

/**
 * A live `jobkeyword=Web Developer` page captured on 2026-09-13, trimmed to
 * three result blocks — one without an employer logo, one with, one with an
 * empty salary cell — and with the description snippets cut short.
 */
const FIXTURE = readFileSync(join(__dirname, "fixtures/onlinejobs-search.html"), "utf8")

const QUERY = { role: "Web Developer", keywords: ["react"] }

function htmlResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html" } })
}

beforeEach(() => {
  clearOnlinejobsRunClaims()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("parseOnlinejobsPage", () => {
  it("maps the fields the live page renders", () => {
    const postings = parseOnlinejobsPage(FIXTURE)

    expect(postings?.[0]).toEqual({
      provider: "onlinejobsph",
      externalId: "1728717",
      // The employment-type pill inside the heading is not part of the title.
      title: "Squarespace Web Designer/Developer + SEO & Digital Content Specialist",
      companyName: UNDISCLOSED_EMPLOYER,
      url: "https://www.onlinejobs.ph/jobseekers/job/squarespace-web-designer-developer-seo-digital-content-specialist-1728717",
      location: "Philippines (remote)",
      workTypeHint: "remote",
      salaryText: "$7-10USD/hour",
      description: expect.stringContaining("highly capable, proactive person"),
      // `data-temp` is Manila wall-clock time with no zone.
      postedAt: "2026-09-13T15:04:54+08:00",
      raw: {
        path: "/jobseekers/job/squarespace-web-designer-developer-seo-digital-content-specialist-1728717",
      },
    })
  })

  it("reads the employer off the logo alt when the listing has one", () => {
    const postings = parseOnlinejobsPage(FIXTURE)

    expect(postings?.[1]?.companyName).toBe("Hula is Life")
    expect(postings?.[1]?.externalId).toBe("1728313")
  })

  it("drops the See More link out of the snippet", () => {
    expect(parseOnlinejobsPage(FIXTURE)?.[0]?.description).not.toContain("See More")
  })

  it("leaves the salary unset when the cell is empty", () => {
    expect(parseOnlinejobsPage(FIXTURE)?.[2]?.salaryText).toBeUndefined()
  })

  it("parses every block on the page", () => {
    expect(parseOnlinejobsPage(FIXTURE)).toHaveLength(3)
  })

  it("returns null when the markup yields no result blocks", () => {
    expect(parseOnlinejobsPage("<html><body>No results</body></html>")).toBeNull()
    expect(parseOnlinejobsPage("")).toBeNull()
    // A block that is not a posting is skipped rather than half-mapped.
    expect(parseOnlinejobsPage("<!-- Start --><div>nothing</div><!-- End -->")).toBeNull()
  })
})

describe("onlinejobsAdapter.search", () => {
  it("searches the role alone, because the site ANDs the words it is given", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse(FIXTURE))

    const controller = new AbortController()
    const postings = await onlinejobsAdapter.search(QUERY, controller.signal, CONTEXT)

    expect(postings).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin + url.pathname).toBe("https://www.onlinejobs.ph/jobseekers/jobsearch")
    // "Web Developer react" returns nothing live; the keywords are dropped.
    expect(url.searchParams.get("jobkeyword")).toBe("Web Developer")
    expect((init.headers as Record<string, string>)["user-agent"]).toContain("RoleSpec")
    expect(init.signal).toBe(controller.signal)
  })

  it("hits the source once per run, for the run's first query only", async () => {
    // `runDiscovery` fans several derived queries across one shared signal;
    // robots.txt asks for a five second crawl delay, so only the first runs.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse(FIXTURE))

    const signal = new AbortController().signal
    const first = await onlinejobsAdapter.search(QUERY, signal, CONTEXT)
    const second = await onlinejobsAdapter.search({ role: "React Developer" }, signal, CONTEXT)
    const third = await onlinejobsAdapter.search({ role: "Frontend Engineer" }, signal, CONTEXT)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toHaveLength(3)
    expect(second).toEqual([])
    expect(third).toEqual([])
  })

  it("claims the run on the first call even before it is awaited", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse(FIXTURE))

    const signal = new AbortController().signal
    // The real caller builds every query's promise synchronously, in order.
    const results = await Promise.all([
      onlinejobsAdapter.search(QUERY, signal, CONTEXT),
      onlinejobsAdapter.search({ role: "React Developer" }, signal, CONTEXT),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(results[0]).toHaveLength(3)
    expect(results[1]).toEqual([])
  })

  it("declines a second run inside the crawl delay even with a fresh signal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse(FIXTURE))

    await onlinejobsAdapter.search(QUERY, new AbortController().signal, CONTEXT)
    const second = await onlinejobsAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toEqual([])
  })

  it("caps the result count", async () => {
    const block = FIXTURE.slice(FIXTURE.indexOf("<!-- Start -->"), FIXTURE.indexOf("<!-- End -->"))
    const many = Array.from(
      { length: 40 },
      (_unused, index) => `${block.replace("-1728717", `-${index + 1}`)}<!-- End -->`
    ).join("")

    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse(many))

    const postings = await onlinejobsAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(ONLINEJOBS_RESULT_LIMIT)
  })

  it("returns an empty list on a non-OK status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse("nope", 503))

    await expect(
      onlinejobsAdapter.search(QUERY, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
  })

  it("returns an empty list when the markup no longer matches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      htmlResponse("<html><body><div class='jobs'></div></body></html>")
    )

    await expect(
      onlinejobsAdapter.search(QUERY, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
  })

  it("swallows a network failure rather than throwing at the pipeline", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"))

    await expect(
      onlinejobsAdapter.search(QUERY, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
  })

  it("does not call the source for an empty query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    await expect(
      onlinejobsAdapter.search({ role: "   " }, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
