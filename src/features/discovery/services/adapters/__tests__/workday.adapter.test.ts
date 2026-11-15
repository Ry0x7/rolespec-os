// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  WORKDAY_PAGE_LIMIT,
  WORKDAY_RESULT_LIMIT,
  parseWorkdayPosting,
  parseWorkdayResponse,
  workdayAdapter,
  workdayPostedAt,
} from "../workday.adapter"
import { parseWorkdayBoardUrl } from "../../../constants/workday-board"
import { clearFetchMemo } from "../fetch-memo"

const BOARD_URL = "https://globe.wd3.myworkdayjobs.com/GLB_Careers"
const BOARD = parseWorkdayBoardUrl(BOARD_URL)!

// Pinned so the test does not move whenever the default watchlist is edited.
const CONTEXT = {
  atsWatchlist: {
    greenhouse: [],
    lever: [],
    ashby: [],
    bamboohr: [],
    freshteam: [],
    workday: [BOARD_URL],
  },
}

/** Trimmed from the real Globe `searchText: "developer"` response of 2026-09-14. */
const WORKDAY_SEARCH = {
  total: 3,
  jobPostings: [
    {
      title: "Fullstack Developer (AI)",
      externalPath: "/job/26F-The-Globe-Tower/Fullstack-Developer--AI-_R0000021436",
      locationsText: "26F The Globe Tower",
      postedOn: "Posted 10 Days Ago",
      bulletFields: ["R0000021436"],
    },
    {
      title: "AI Software Developer",
      externalPath: "/job/12F-The-Globe-Tower/AI-Software-Developer_R0000020646",
      locationsText: "12F The Globe Tower",
      postedOn: "Posted 30+ Days Ago",
      bulletFields: ["R0000020646"],
    },
    {
      // Workday matches the whole posting, so a non-matching title comes back too.
      title: "Solutions Architect / Solutions Designer",
      externalPath: "/job/16F-The-Globe-Tower/Solutions-Architect_R0000020651",
      locationsText: "16F The Globe Tower",
      postedOn: "Posted 30+ Days Ago",
      bulletFields: ["R0000020651"],
    },
  ],
}

const NOW = new Date("2026-09-14T00:00:00.000Z")
const QUERY = { role: "Developer", keywords: [] }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  clearFetchMemo()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("workdayPostedAt", () => {
  it("reads an exact day count back from now", () => {
    expect(workdayPostedAt("Posted 10 Days Ago", NOW)).toBe("2026-09-04T00:00:00.000Z")
  })

  it("reads Today and Yesterday", () => {
    expect(workdayPostedAt("Posted Today", NOW)).toBe("2026-09-14T00:00:00.000Z")
    expect(workdayPostedAt("Posted Yesterday", NOW)).toBe("2026-09-13T00:00:00.000Z")
  })

  it.each([
    "Posted 30+ Days Ago",
    "Posted Sometime",
    "",
    "30 Days Ago",
    "Posted 4000 Days Ago",
  ])("refuses to invent a date for %p", (value) => {
    // "30+" is an open-ended floor. Calling it 30 days would tell opportunity
    // confidence the posting is fresher than anything actually known.
    expect(workdayPostedAt(value, NOW)).toBeUndefined()
  })

  it.each([null, undefined, 7, {}])("is undefined for the non-string %p", (value) => {
    expect(workdayPostedAt(value, NOW)).toBeUndefined()
  })
})

describe("parseWorkdayResponse", () => {
  it("maps the fields the live search returns and drops a non-matching title", () => {
    const postings = parseWorkdayResponse(WORKDAY_SEARCH, BOARD, QUERY, NOW)

    expect(postings).toEqual([
      {
        provider: "workday",
        externalId: "/job/26F-The-Globe-Tower/Fullstack-Developer--AI-_R0000021436",
        title: "Fullstack Developer (AI)",
        // The payload never names the company, so the humanized tenant stands in.
        companyName: "Globe",
        url: "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/26F-The-Globe-Tower/Fullstack-Developer--AI-_R0000021436",
        location: "26F The Globe Tower",
        postedAt: "2026-09-04T00:00:00.000Z",
        raw: WORKDAY_SEARCH.jobPostings[0],
      },
      {
        provider: "workday",
        externalId: "/job/12F-The-Globe-Tower/AI-Software-Developer_R0000020646",
        title: "AI Software Developer",
        companyName: "Globe",
        url: "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/12F-The-Globe-Tower/AI-Software-Developer_R0000020646",
        location: "12F The Globe Tower",
        // "Posted 30+ Days Ago" carries no usable date.
        raw: WORKDAY_SEARCH.jobPostings[1],
      },
    ])
  })

  it("returns an empty list for a site with no matches", () => {
    expect(parseWorkdayResponse({ total: 0, jobPostings: [] }, BOARD, QUERY, NOW)).toEqual([])
  })

  it.each([null, undefined, "nope", 7, [], { jobPostings: {} }, { total: 1 }])(
    "returns null for the unrecognised body %p",
    (body) => {
      expect(parseWorkdayResponse(body, BOARD, QUERY, NOW)).toBeNull()
    }
  )

  it("drops an entry with no title or no posting path rather than crashing", () => {
    const postings = parseWorkdayResponse(
      {
        jobPostings: [
          { title: "Developer" },
          { externalPath: "/job/a/b" },
          { title: "Developer", externalPath: "/not-a-job/a/b" },
          null,
          "nope",
          WORKDAY_SEARCH.jobPostings[0],
        ],
      },
      BOARD,
      QUERY,
      NOW
    )

    expect(postings?.map((posting) => posting.title)).toEqual(["Fullstack Developer (AI)"])
  })
})

describe("parseWorkdayPosting", () => {
  it("reads the description off the CXS detail endpoint", () => {
    const body = {
      jobPostingInfo: {
        id: "539d39fad429100089e5ec386abf0000",
        title: "AI Engineer",
        jobDescription: "<p>Build a robust enterprise engineering foundation.</p>",
        location: "26F The Globe Tower",
        startDate: "2026-08-20",
        remoteType: "Hybrid",
      },
    }

    expect(parseWorkdayPosting(body, BOARD, "/job/26F/AI-Engineer_R1")).toEqual({
      provider: "workday",
      externalId: "/job/26F/AI-Engineer_R1",
      title: "AI Engineer",
      companyName: "Globe",
      url: "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/26F/AI-Engineer_R1",
      location: "26F The Globe Tower",
      workTypeHint: "Hybrid",
      description: "<p>Build a robust enterprise engineering foundation.</p>",
      postedAt: "2026-08-20",
      raw: body.jobPostingInfo,
    })
  })

  it.each([null, {}, { jobPostingInfo: null }, { jobPostingInfo: {} }])(
    "returns null for the unrecognised detail body %p",
    (body) => {
      expect(parseWorkdayPosting(body, BOARD, "/job/a/b")).toBeNull()
    }
  )
})

describe("workdayAdapter", () => {
  it("posts the role as searchText to the CXS endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(WORKDAY_SEARCH) as never)

    const postings = await workdayAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://globe.wd3.myworkdayjobs.com/wday/cxs/globe/GLB_Careers/jobs"
    )
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({
      appliedFacets: {},
      limit: WORKDAY_PAGE_LIMIT,
      offset: 0,
      searchText: "Developer",
    })
    expect(postings).toHaveLength(2)
  })

  it("does not share a memo entry between two different searches", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(WORKDAY_SEARCH) as never)
    const signal = new AbortController().signal

    await workdayAdapter.search({ role: "Developer" }, signal, CONTEXT)
    await workdayAdapter.search({ role: "Designer" }, signal, CONTEXT)
    await workdayAdapter.search({ role: "Developer" }, signal, CONTEXT)

    // Two distinct bodies against one URL, and the repeat is served from the memo.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("returns nothing and does not fetch when the watchlist is empty", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    expect(
      await workdayAdapter.search(QUERY, new AbortController().signal, {
        atsWatchlist: { ...CONTEXT.atsWatchlist, workday: [] },
      })
    ).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns nothing for a blank query without touching the network", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    expect(await workdayAdapter.search({ role: "" }, new AbortController().signal, CONTEXT)).toEqual(
      []
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a watched entry that is not a Workday board URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    expect(
      await workdayAdapter.search(QUERY, new AbortController().signal, {
        atsWatchlist: { ...CONTEXT.atsWatchlist, workday: ["https://example.com/careers"] },
      })
    ).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("survives a non-OK status, a thrown request and an unparseable body", async () => {
    const signal = new AbortController().signal

    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 404) as never)
    expect(await workdayAdapter.search(QUERY, signal, CONTEXT)).toEqual([])

    clearFetchMemo()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))
    expect(await workdayAdapter.search(QUERY, signal, CONTEXT)).toEqual([])

    clearFetchMemo()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>", { status: 200 }) as never)
    expect(await workdayAdapter.search(QUERY, signal, CONTEXT)).toEqual([])
  })

  it("caps what one query can return", async () => {
    // More than one real page could hold, to prove the cap is applied locally too.
    const jobPostings = Array.from({ length: WORKDAY_RESULT_LIMIT + 10 }, (_, index) => ({
      title: "Developer",
      externalPath: `/job/Tower/Developer_R${index}`,
      locationsText: "Taguig",
      postedOn: "Posted Today",
    }))
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ jobPostings }) as never)

    const postings = await workdayAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(WORKDAY_RESULT_LIMIT)
  })
})
