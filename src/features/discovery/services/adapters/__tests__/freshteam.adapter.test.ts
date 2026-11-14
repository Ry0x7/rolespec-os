// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  FRESHTEAM_RESULT_LIMIT,
  freshteamAdapter,
  freshteamCompanyName,
  freshteamLocation,
  parseFreshteamPage,
} from "../freshteam.adapter"
import { clearFetchMemo } from "../fetch-memo"

// Pinned so the test does not move whenever the default watchlist is edited.
const CONTEXT = {
  atsWatchlist: {
    greenhouse: [],
    lever: [],
    ashby: [],
    bamboohr: [],
    freshteam: ["thinkingmachines"],
    workday: [],
  },
}

/** One posting block, trimmed from the real thinkingmachines `/jobs` page of 2026-09-14. */
function block(href: string, title: string, location: string) {
  return `<li class="heading">
    <a href="${href}">
      <div class="row">
        <div class="job-list-info">
          <span class="job-title">${title}</span>
          <span class="job-desc text">
            A one-line teaser that is not the posting body.
          </span>
        </div>
        <div class="job-location">
          <span class="location-info">
            ${location}
            <br />
            Full Time
          </span>
          <span class="location-icon"><i class="icon-arrow-right "></i></span>
        </div>
      </div>
    </a>
  </li>`
}

const PAGE = `<!DOCTYPE html><html><head><title>Thinking Machines Data Science</title></head><body>
  <ul class="job-list">
    ${block("/jobs/feW9IyawTFI7/ph-cloud-engineer", "PH - Cloud Engineer", "Taguig, Metro Manila")}
    ${block("/jobs/qHDogHkvICQ_/ph-genai-engineer", "PH - GenAI Engineer", "Remote")}
    ${block("/jobs/TOUqBkA4k07O/ph-data-strategy-consultant", "PH - Data Strategy Consultant", "Taguig, Metro Manila")}
  </ul>
</body></html>`

const QUERY = { role: "Engineer", keywords: [] }

function htmlResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html" } })
}

beforeEach(() => {
  clearFetchMemo()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("freshteamCompanyName", () => {
  it("reads the company's real name off the page title", () => {
    expect(freshteamCompanyName(PAGE, "thinkingmachines")).toBe("Thinking Machines Data Science")
  })

  it("falls back to the slug when the page has no title", () => {
    expect(freshteamCompanyName("<html><body></body></html>", "acme")).toBe("acme")
  })
})

describe("freshteamLocation", () => {
  it("keeps only the line before the employment type", () => {
    expect(
      freshteamLocation('<span class="location-info">Taguig, Metro Manila<br />Full Time</span>')
    ).toBe("Taguig, Metro Manila")
  })

  it("is undefined when the block states no location", () => {
    expect(freshteamLocation("<li></li>")).toBeUndefined()
  })
})

describe("parseFreshteamPage", () => {
  it("maps the fields the live listing page carries", () => {
    // "Cloud" alone: the token match is an OR, so "Cloud Engineer" would also
    // pull in "PH - GenAI Engineer".
    const postings = parseFreshteamPage(PAGE, "thinkingmachines", { role: "Cloud" })

    expect(postings).toEqual([
      {
        provider: "freshteam",
        externalId: "feW9IyawTFI7",
        title: "PH - Cloud Engineer",
        companyName: "Thinking Machines Data Science",
        url: "https://thinkingmachines.freshteam.com/jobs/feW9IyawTFI7/ph-cloud-engineer",
        location: "Taguig, Metro Manila",
        // The listing page has neither a body nor a date; see the adapter's note.
        raw: {
          href: "/jobs/feW9IyawTFI7/ph-cloud-engineer",
          title: "PH - Cloud Engineer",
          location: "Taguig, Metro Manila",
        },
      },
    ])
  })

  it("hints remote only when the location says so", () => {
    const postings = parseFreshteamPage(PAGE, "thinkingmachines", { role: "Engineer" })

    expect(postings?.map((posting) => [posting.title, posting.workTypeHint])).toEqual([
      ["PH - Cloud Engineer", undefined],
      ["PH - GenAI Engineer", "remote"],
    ])
  })

  it("filters on the title, not the teaser", () => {
    expect(parseFreshteamPage(PAGE, "thinkingmachines", { role: "teaser" })).toEqual([])
  })

  it("returns an empty list when the page has blocks but nothing matches", () => {
    expect(parseFreshteamPage(PAGE, "thinkingmachines", { role: "Plumber" })).toEqual([])
  })

  it("returns null when the page has no posting blocks at all", () => {
    expect(parseFreshteamPage("<html><body>Nothing here</body></html>", "acme", QUERY)).toBeNull()
  })

  it("drops a block with no link or no title rather than crashing", () => {
    const malformed = `<ul>
      <li class="heading"><span class="job-title">PH - Cloud Engineer</span></li>
      <li class="heading"><a href="/jobs/aa/one"></a></li>
      ${block("/jobs/feW9IyawTFI7/ph-cloud-engineer", "PH - Cloud Engineer", "Taguig")}
    </ul>`

    expect(
      parseFreshteamPage(malformed, "acme", { role: "Cloud Engineer" })?.map((p) => p.externalId)
    ).toEqual(["feW9IyawTFI7"])
  })

  it("decodes entities in the title", () => {
    const postings = parseFreshteamPage(
      block("/jobs/aa/rd-engineer", "R&amp;D Engineer", "Taguig"),
      "acme",
      { role: "Engineer" }
    )

    expect(postings?.[0]?.title).toBe("R&D Engineer")
  })
})

describe("freshteamAdapter", () => {
  it("asks the robots-allowed listing page once and returns what matched", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse(PAGE) as never)

    const postings = await freshteamAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Never `/hire/widgets/jobs.json`: that path is robots-disallowed.
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://thinkingmachines.freshteam.com/jobs")
    expect(postings.map((posting) => posting.externalId)).toEqual([
      "feW9IyawTFI7",
      "qHDogHkvICQ_",
    ])
  })

  it("returns nothing and does not fetch when the watchlist is empty", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    expect(
      await freshteamAdapter.search(QUERY, new AbortController().signal, {
        atsWatchlist: { ...CONTEXT.atsWatchlist, freshteam: [] },
      })
    ).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns nothing for a blank query without touching the network", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    expect(
      await freshteamAdapter.search({ role: "" }, new AbortController().signal, CONTEXT)
    ).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a slug that could not be a subdomain", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    expect(
      await freshteamAdapter.search(QUERY, new AbortController().signal, {
        atsWatchlist: { ...CONTEXT.atsWatchlist, freshteam: ["evil.com/x"] },
      })
    ).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("survives a non-OK status, a thrown request and a page that is not a board", async () => {
    const signal = new AbortController().signal

    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse("", 404) as never)
    expect(await freshteamAdapter.search(QUERY, signal, CONTEXT)).toEqual([])

    clearFetchMemo()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))
    expect(await freshteamAdapter.search(QUERY, signal, CONTEXT)).toEqual([])

    clearFetchMemo()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse("<html></html>") as never)
    expect(await freshteamAdapter.search(QUERY, signal, CONTEXT)).toEqual([])
  })

  it("caps what one query can return", async () => {
    const page = `<title>Acme</title>${Array.from({ length: FRESHTEAM_RESULT_LIMIT + 10 }, (_, i) =>
      block(`/jobs/id${i}/cloud-engineer`, "Cloud Engineer", "Taguig")
    ).join("")}`
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse(page) as never)

    const postings = await freshteamAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(FRESHTEAM_RESULT_LIMIT)
  })
})
