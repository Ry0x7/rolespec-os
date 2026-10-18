// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { fetchAtsPosting, recognizeAtsPostingUrl } from "../ats-posting.service"

const LEVER_UUID = "c8c616bc-7449-43e1-ac53-1637e7d183cc"
const ASHBY_UUID = "d3bc1ced-3ce4-4086-a050-555055dbb1ff"

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

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("recognizeAtsPostingUrl", () => {
  it.each([
    ["https://boards.greenhouse.io/gitlab/jobs/8503792002", "greenhouse", "gitlab", "8503792002"],
    [
      "https://job-boards.greenhouse.io/gitlab/jobs/8503792002",
      "greenhouse",
      "gitlab",
      "8503792002",
    ],
    // Trailing path and query on the same shape.
    [
      "https://boards.greenhouse.io/GitLab/jobs/8503792002?utm_source=x",
      "greenhouse",
      "gitlab",
      "8503792002",
    ],
    // EU-resident boards answer from the same boards-api.greenhouse.io origin.
    [
      "https://boards.eu.greenhouse.io/gitlab/jobs/8503792002",
      "greenhouse",
      "gitlab",
      "8503792002",
    ],
    [
      "https://job-boards.eu.greenhouse.io/proton/jobs/4945751101",
      "greenhouse",
      "proton",
      "4945751101",
    ],
    [`https://jobs.lever.co/ro/${LEVER_UUID}`, "lever", "ro", LEVER_UUID],
    [`https://jobs.lever.co/ro/${LEVER_UUID}/apply`, "lever", "ro", LEVER_UUID],
    [`https://jobs.ashbyhq.com/linear/${ASHBY_UUID}`, "ashby", "linear", ASHBY_UUID],
    [
      `https://jobs.ashbyhq.com/linear/${ASHBY_UUID}/application`,
      "ashby",
      "linear",
      ASHBY_UUID,
    ],
  ])("recognizes %s", (url, provider, slug, postingId) => {
    expect(recognizeAtsPostingUrl(new URL(url))).toEqual({ provider, slug, postingId })
  })

  it("reads gh_jid when the host is a Greenhouse board host", () => {
    expect(
      recognizeAtsPostingUrl(new URL("https://boards.greenhouse.io/gitlab/jobs?gh_jid=8503792002"))
    ).toEqual({ provider: "greenhouse", slug: "gitlab", postingId: "8503792002" })
  })

  it("reads gh_jid on an EU Greenhouse board host", () => {
    expect(
      recognizeAtsPostingUrl(
        new URL("https://job-boards.eu.greenhouse.io/proton/jobs?gh_jid=4945751101")
      )
    ).toEqual({ provider: "greenhouse", slug: "proton", postingId: "4945751101" })
  })

  it("does not recognize gh_jid on a company's own domain — there is no slug to call with", () => {
    expect(
      recognizeAtsPostingUrl(new URL("https://stripe.com/jobs/search?gh_jid=8172487"))
    ).toBeNull()
  })

  it.each([
    // A board root names no single posting.
    "https://boards.greenhouse.io/gitlab",
    "https://boards.greenhouse.io/gitlab/jobs",
    // Greenhouse posting ids are numeric.
    "https://boards.greenhouse.io/gitlab/jobs/not-an-id",
    // Lever and Ashby posting ids are uuids.
    "https://jobs.lever.co/ro/12345",
    "https://jobs.ashbyhq.com/linear/12345",
    "https://jobs.lever.co/ro",
    // Look-alike hosts must not be treated as the ATS.
    `https://jobs.lever.co.evil.example/ro/${LEVER_UUID}`,
    "https://greenhouse.io/gitlab/jobs/8503792002",
    // Ordinary company pages keep the HTML path.
    "https://example.com/careers/senior-engineer",
    // BambooHR posting ids are numeric and live under /careers.
    "https://kumu.bamboohr.com/careers",
    "https://kumu.bamboohr.com/careers/not-an-id",
    "https://kumu.bamboohr.com/jobs/336",
    "https://bamboohr.com/careers/336",
    "https://kumu.bamboohr.com.evil.example/careers/336",
    // Workday needs a full posting path.
    "https://globe.wd3.myworkdayjobs.com/GLB_Careers",
    "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers",
    "https://globe.myworkdayjobs.com/en-US/GLB_Careers/job/Tower/AI-Engineer_R1",
    // Freshteam is deliberately left to the HTML extraction: its posting JSON is
    // robots-disallowed and its posting page is server-rendered with the body.
    "https://thinkingmachines.freshteam.com/jobs/feW9IyawTFI7/ph-cloud-engineer",
  ])("does not recognize %s", (url) => {
    expect(recognizeAtsPostingUrl(new URL(url))).toBeNull()
  })

  it("recognizes a BambooHR posting page", () => {
    expect(recognizeAtsPostingUrl(new URL("https://kumu.bamboohr.com/careers/336"))).toEqual({
      provider: "bamboohr",
      slug: "kumu",
      postingId: "336",
    })
  })

  it("recognizes a Workday posting page and keeps the three parts its API needs", () => {
    expect(
      recognizeAtsPostingUrl(
        new URL(
          "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/26F-The-Globe-Tower/AI-Engineer_R0000021435"
        )
      )
    ).toEqual({
      provider: "workday",
      // The tenant stands in for the company name.
      slug: "globe",
      postingId: "/job/26F-The-Globe-Tower/AI-Engineer_R0000021435",
      board: {
        tenant: "globe",
        wd: "wd3",
        site: "GLB_Careers",
        boardUrl: "https://globe.wd3.myworkdayjobs.com/GLB_Careers",
      },
    })
  })
})

describe("fetchAtsPosting — BambooHR", () => {
  const ref = { provider: "bamboohr" as const, slug: "kumu", postingId: "336" }

  it("reads the description and the date off the detail endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        result: {
          jobOpening: {
            jobOpeningName: "Business Development Associate",
            location: { city: "Makati", state: "Metro Manila" },
            description: "<p>Are you a fan of social gaming?</p>",
            datePosted: "2026-01-12",
          },
        },
      }) as never
    )

    const posting = await fetchAtsPosting(ref, signal())

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://kumu.bamboohr.com/careers/336/detail"
    )
    expect(posting).toMatchObject({
      provider: "bamboohr",
      externalId: "336",
      title: "Business Development Associate",
      url: "https://kumu.bamboohr.com/careers/336",
      description: "<p>Are you a fan of social gaming?</p>",
      postedAt: "2026-01-12",
    })
  })

  it("returns null rather than throwing when the detail endpoint is unhappy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, { status: 404 }) as never)
    expect(await fetchAtsPosting(ref, signal())).toBeNull()

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))
    expect(await fetchAtsPosting(ref, signal())).toBeNull()
  })
})

describe("fetchAtsPosting — Workday", () => {
  const board = {
    tenant: "globe",
    wd: "wd3",
    site: "GLB_Careers",
    boardUrl: "https://globe.wd3.myworkdayjobs.com/GLB_Careers",
  }
  const ref = {
    provider: "workday" as const,
    slug: "globe",
    postingId: "/job/26F-The-Globe-Tower/AI-Engineer_R0000021435",
    board,
  }

  it("reads the description off the CXS detail endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        jobPostingInfo: {
          title: "AI Engineer",
          jobDescription: "<p>Build a robust enterprise engineering foundation.</p>",
          location: "26F The Globe Tower",
          startDate: "2026-08-20",
        },
      }) as never
    )

    const posting = await fetchAtsPosting(ref, signal())

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://globe.wd3.myworkdayjobs.com/wday/cxs/globe/GLB_Careers/job/26F-The-Globe-Tower/AI-Engineer_R0000021435"
    )
    expect(posting).toMatchObject({
      provider: "workday",
      title: "AI Engineer",
      companyName: "Globe",
      url: "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/26F-The-Globe-Tower/AI-Engineer_R0000021435",
      description: "<p>Build a robust enterprise engineering foundation.</p>",
      postedAt: "2026-08-20",
    })
  })

  it("returns null without fetching when the ref carries no board", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    expect(await fetchAtsPosting({ ...ref, board: undefined }, signal())).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("fetchAtsPosting — Greenhouse", () => {
  const ref = { provider: "greenhouse" as const, slug: "gitlab", postingId: "8503792002" }

  it("maps the single-posting response and decodes its escaped HTML body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        id: 8503792002,
        title: "Account Executive - Italy",
        company_name: "GitLab",
        absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/8503792002",
        location: { name: "Remote, Italy" },
        updated_at: "2026-08-31T17:56:36-04:00",
        // The live shape: HTML with every angle bracket entity-escaped.
        content: "&lt;p&gt;Ship &lt;b&gt;pipelines&lt;/b&gt;.&lt;/p&gt;",
      })
    )

    const posting = await fetchAtsPosting(ref, signal())

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8503792002"
    )
    expect(posting).toMatchObject({
      provider: "greenhouse",
      externalId: "8503792002",
      title: "Account Executive - Italy",
      companyName: "GitLab",
      url: "https://job-boards.greenhouse.io/gitlab/jobs/8503792002",
      location: "Remote, Italy",
    })
    // Decoded back into real HTML so `normalizePosting`'s strip pass can work.
    expect(posting?.description).toBe("<p>Ship <b>pipelines</b>.</p>")
  })

  it("returns null on a 404 rather than throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ status: 404, error: "Job not found" }, { status: 404 })
    )

    expect(await fetchAtsPosting(ref, signal())).toBeNull()
  })

  it("returns null when the request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"))

    expect(await fetchAtsPosting(ref, signal())).toBeNull()
  })

  it("returns null when the response is not the documented shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ nothing: true }))

    expect(await fetchAtsPosting(ref, signal())).toBeNull()
  })
})

describe("fetchAtsPosting — Lever", () => {
  const ref = { provider: "lever" as const, slug: "ro", postingId: LEVER_UUID }

  it("maps the single-posting response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        id: LEVER_UUID,
        text: "Associate Director, Customer Experience Operations",
        hostedUrl: `https://jobs.lever.co/ro/${LEVER_UUID}`,
        categories: { location: "New York, NY or Remote" },
        workplaceType: "hybrid",
        descriptionPlain: "Run the operation.",
        createdAt: 1788562971519,
      })
    )

    const posting = await fetchAtsPosting(ref, signal())

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.lever.co/v0/postings/ro/${LEVER_UUID}`
    )
    expect(posting).toMatchObject({
      provider: "lever",
      externalId: LEVER_UUID,
      title: "Associate Director, Customer Experience Operations",
      companyName: "ro",
      workTypeHint: "hybrid",
      description: "Run the operation.",
    })
  })

  it("returns null when the body is the board array rather than one posting", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([{ id: LEVER_UUID }]))

    expect(await fetchAtsPosting(ref, signal())).toBeNull()
  })
})

describe("fetchAtsPosting — Ashby", () => {
  const ref = { provider: "ashby" as const, slug: "linear", postingId: ASHBY_UUID }

  function board(jobs: unknown[]) {
    return jsonResponse({ apiVersion: 1, jobs })
  }

  it("finds the posting inside the board response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      board([
        { id: "00000000-0000-0000-0000-000000000000", title: "Other", jobUrl: "https://x/y" },
        {
          id: ASHBY_UUID,
          title: "Product Engineer",
          jobUrl: `https://jobs.ashbyhq.com/linear/${ASHBY_UUID}`,
          location: "Remote",
          workplaceType: "Remote",
          descriptionPlain: "Build Linear.",
          publishedAt: "2026-08-01T00:00:00+00:00",
        },
      ])
    )

    const posting = await fetchAtsPosting(ref, signal())

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true"
    )
    expect(posting).toMatchObject({
      provider: "ashby",
      externalId: ASHBY_UUID,
      title: "Product Engineer",
      companyName: "linear",
      description: "Build Linear.",
    })
  })

  it("returns null when the board does not carry that posting", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(board([{ id: "other", title: "x" }]))

    expect(await fetchAtsPosting(ref, signal())).toBeNull()
  })

  it("returns null for a posting the board marks unlisted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      board([
        {
          id: ASHBY_UUID,
          title: "Product Engineer",
          jobUrl: `https://jobs.ashbyhq.com/linear/${ASHBY_UUID}`,
          isListed: false,
        },
      ])
    )

    expect(await fetchAtsPosting(ref, signal())).toBeNull()
  })
})
