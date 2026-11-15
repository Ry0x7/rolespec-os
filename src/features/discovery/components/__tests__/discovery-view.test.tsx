import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { DiscoveryView } from "../discovery-view"
import type {
  DiscoveryCandidate,
  DiscoverySourceReport,
} from "../../actions/discovery.actions"

const runDiscovery = vi.fn()
const addJobByUrl = vi.fn()
const saveDiscoveredJob = vi.fn()

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("../../actions/discovery.actions", () => ({
  runDiscovery: (...args: unknown[]) => runDiscovery(...args),
  addJobByUrl: (...args: unknown[]) => addJobByUrl(...args),
  saveDiscoveredJob: (...args: unknown[]) => saveDiscoveredJob(...args),
  probeCompanyBoards: vi.fn(),
}))

// Pulled in by the watchlist dialog, which reaches the auth config and, through
// it, `next/server` — nothing this file exercises.
vi.mock("../../actions/watchlist.actions", () => ({
  updateAtsWatchlist: vi.fn(),
}))

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}))

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    provider: "remotive",
    externalId: "1",
    title: "Frontend Engineer",
    companyName: "Globex",
    url: "https://example.com/jobs/1",
    canonicalUrl: "https://example.com/jobs/1",
    alreadySaved: false,
    confidence: {
      level: "MEDIUM",
      score: 2,
      signals: [
        { key: "provenance", label: "Job board listing", tone: "neutral" },
        { key: "freshness", label: "Posted 3 days ago", tone: "positive" },
        { key: "employer", label: "Named employer", tone: "positive" },
      ],
      summary: "Job board listing, posted 3 days ago, named employer.",
    },
    qualification: {
      worthIt: { signal: "GOOD", reasons: [] },
      eligible: { signal: "NEUTRAL", reasons: [] },
      match: { signal: "NEUTRAL", reasons: [], matched: [], confirmedCount: 0 },
      risk: { signal: "GOOD", reasons: [], level: "LOW" },
      verdict: "STRONG",
      nextAction: "Worth a read.",
      requirementFlags: [],
      marketFit: {
        fit: "UNKNOWN",
        reason: "The posting does not say where you need to be based.",
        label: "Location unstated",
      },
    },
    ...overrides,
  }
}

async function runWith(
  candidates: DiscoveryCandidate[],
  requiresSponsorship = false,
  sources: DiscoverySourceReport[] = []
) {
  runDiscovery.mockResolvedValue({ queries: ["Frontend Engineer"], candidates, sources })
  render(
    <DiscoveryView
      queries={["Frontend Engineer"]}
      activeTargetRoleCount={1}
      atsWatchlist={{ greenhouse: [], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] }}
      requiresSponsorship={requiresSponsorship}
      marketCountry={null}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Search" }))
  await screen.findByText("Frontend Engineer")
}

describe("DiscoveryView save", () => {
  it("links a saved posting to its job without leaving the page", async () => {
    saveDiscoveredJob.mockResolvedValue({ id: "job-7", duplicate: false })
    await runWith([candidate()])

    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    const open = await screen.findByRole("link", { name: "Open" })
    expect(open.getAttribute("href")).toBe("/jobs/job-7")
    expect(push).not.toHaveBeenCalled()
  })

  it("opens the job once Save & open lands", async () => {
    saveDiscoveredJob.mockResolvedValue({ id: "job-8", duplicate: false })
    await runWith([candidate()])

    fireEvent.click(screen.getByRole("button", { name: "Save & open" }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/jobs/job-8"))
    expect(saveDiscoveredJob).toHaveBeenCalledTimes(1)
  })

  it("stays put when Save & open fails", async () => {
    saveDiscoveredJob.mockResolvedValue({ error: "Could not save" })
    await runWith([candidate()])

    fireEvent.click(screen.getByRole("button", { name: "Save & open" }))

    await waitFor(() => expect(saveDiscoveredJob).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save & open" })).toBeTruthy()
    )
    expect(push).not.toHaveBeenCalled()
  })
})

describe("DiscoveryView card chips", () => {
  it("shows the posting's stated work mode on the collapsed card", async () => {
    await runWith([candidate({ workType: "REMOTE" })])

    expect(screen.getByText("Remote")).toBeTruthy()
  })

  it("shows nothing when the posting never stated a work mode", async () => {
    await runWith([candidate()])

    expect(screen.queryByText("Remote")).toBeNull()
    expect(screen.queryByText("Hybrid")).toBeNull()
    expect(screen.queryByText("On-site")).toBeNull()
  })

  it("flags sponsorship as unknown only when the user needs it and the posting is silent", async () => {
    await runWith([candidate({ workType: "HYBRID" })], true)

    expect(screen.getByText("Hybrid")).toBeTruthy()
    expect(screen.getByText("Sponsorship unknown")).toBeTruthy()
  })

  it("does not flag sponsorship when the user does not need it", async () => {
    await runWith([candidate()], false)

    expect(screen.queryByText("Sponsorship unknown")).toBeNull()
  })

  it("does not flag sponsorship when the qualification says it is not relevant", async () => {
    await runWith(
      [
        candidate({
          qualification: { ...candidate().qualification, sponsorshipRelevant: false },
        }),
      ],
      true
    )

    expect(screen.queryByText("Sponsorship unknown")).toBeNull()
  })

  it("does not flag sponsorship when the posting stated it either way", async () => {
    const stated = (flag: "SPONSORSHIP_AVAILABLE" | "NO_SPONSORSHIP") =>
      candidate({
        qualification: {
          ...candidate().qualification,
          requirementFlags: [flag],
        },
      })

    await runWith([stated("SPONSORSHIP_AVAILABLE")], true)
    expect(screen.queryByText("Sponsorship unknown")).toBeNull()

    cleanup()
    vi.clearAllMocks()

    await runWith([stated("NO_SPONSORSHIP")], true)
    expect(screen.queryByText("Sponsorship unknown")).toBeNull()
  })
})

describe("DiscoveryView market fit", () => {
  const restricted = (externalId: string) =>
    candidate({
      externalId,
      title: `Restricted ${externalId}`,
      url: `https://example.com/jobs/${externalId}`,
      canonicalUrl: `https://example.com/jobs/${externalId}`,
      qualification: {
        ...candidate().qualification,
        verdict: "WEAK",
        marketFit: {
          fit: "RESTRICTED",
          reason: "Posting is limited to US; your profile location is the Philippines.",
          label: "US only",
        },
      },
    })

  it("labels each card with where the posting will hire from", async () => {
    const open = candidate({
      externalId: "2",
      title: "Worldwide Engineer",
      url: "https://example.com/jobs/2",
      canonicalUrl: "https://example.com/jobs/2",
      qualification: {
        ...candidate().qualification,
        marketFit: {
          fit: "OPEN",
          reason: "Open worldwide — no location restriction stated.",
          label: "Worldwide",
        },
      },
    })
    await runWith([candidate(), open])

    expect(screen.getByText("Location unstated")).toBeTruthy()
    expect(screen.getByText("Worldwide")).toBeTruthy()
  })

  it("hides other-region postings by default and puts them back on request", async () => {
    await runWith([candidate(), restricted("2"), restricted("3")])

    const toggle = screen.getByRole("checkbox", {
      name: /Hide postings limited to other regions \(2\)/,
    }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(screen.queryByText("Restricted 2")).toBeNull()

    fireEvent.click(toggle)

    expect(screen.getByText("Restricted 2")).toBeTruthy()
    expect(screen.getByText("Restricted 3")).toBeTruthy()
  })

  it("hides other-region postings even for a user who would relocate", async () => {
    await runWith([candidate(), restricted("2")])

    const toggle = screen.getByRole("checkbox", {
      name: /Hide postings limited to other regions \(1\)/,
    }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(screen.queryByText("Restricted 2")).toBeNull()

    fireEvent.click(toggle)

    expect(screen.getByText("Restricted 2")).toBeTruthy()
    expect(screen.getByText("US only")).toBeTruthy()
  })

  it("offers no toggle when nothing was restricted", async () => {
    await runWith([candidate()])

    expect(screen.queryByRole("checkbox", { name: /Hide postings/ })).toBeNull()
  })
})

describe("DiscoveryView order explanation", () => {
  it("explains the ranking only once the user asks", async () => {
    await runWith([candidate()])

    const toggle = screen.getByRole("button", { name: /How this is ordered/ })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText(/Fit first, then where the role is open/)).toBeNull()

    fireEvent.click(toggle)

    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(
      screen.getByText(
        "Fit first, then where the role is open (Philippines, APAC, worldwide, then elsewhere), then how much evidence the posting is current and actionable. A Strong fit with low confidence sorts with Worth-a-look."
      )
    ).toBeTruthy()
  })
})

describe("DiscoveryView header count", () => {
  it("counts a candidate added by URL", async () => {
    await runWith([candidate()])
    expect(screen.getByText("1 posting")).toBeTruthy()

    addJobByUrl.mockResolvedValue({
      candidate: candidate({
        externalId: "2",
        title: "Backend Engineer",
        url: "https://example.com/jobs/2",
        canonicalUrl: "https://example.com/jobs/2",
      }),
      extractionMethod: "json-ld",
    })

    fireEvent.change(screen.getByLabelText("Have a link already?"), {
      target: { value: "https://example.com/jobs/2" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Add by URL/ }))

    await waitFor(() => expect(screen.getByText("2 postings")).toBeTruthy())
  })
})

describe("DiscoveryView careers listing", () => {
  const LISTING_PAGE = "https://acme.com/careers/"

  function listingResult(overrides: Record<string, unknown> = {}) {
    return {
      listing: {
        pageUrl: LISTING_PAGE,
        pageTitle: "Careers at Acme",
        host: "acme.com",
        totalLinks: 21,
        fetched: 8,
        skipped: 0,
        remaining: Array.from({ length: 13 }, (_, index) => `${LISTING_PAGE}jobs/${index}`),
        ...overrides,
      },
      candidates: [
        candidate({ externalId: "l1", title: "Role 0", canonicalUrl: `${LISTING_PAGE}jobs/a` }),
        candidate({ externalId: "l2", title: "Role 1", canonicalUrl: `${LISTING_PAGE}jobs/b` }),
      ],
    }
  }

  async function addListing() {
    await runWith([candidate()])
    addJobByUrl.mockResolvedValue(listingResult())

    fireEvent.change(screen.getByLabelText("Have a link already?"), {
      target: { value: LISTING_PAGE },
    })
    fireEvent.click(screen.getByRole("button", { name: /Add by URL/ }))

    await screen.findByText("8 postings from acme.com")
    // The summary text lands a commit before the add transition finishes, so the
    // Fetch more button can still be rendering its "Reading…" busy label. Wait
    // for it to settle, otherwise a later click races the pending state.
    const fetchMore = await screen.findByRole("button", { name: "Fetch more" })
    await waitFor(() => expect(fetchMore.getAttribute("aria-busy")).not.toBe("true"))
    return fetchMore
  }

  it("shows how many postings came off the page and how many links were not fetched", async () => {
    await addListing()

    expect(screen.getByText(/13 more links not fetched/)).toBeTruthy()
    expect(screen.getByText("Role 0")).toBeTruthy()
    expect(screen.getByText("Role 1")).toBeTruthy()
  })

  it("says how many links answered with nothing", async () => {
    await runWith([candidate()])
    addJobByUrl.mockResolvedValue(listingResult({ fetched: 8, skipped: 3 }))

    fireEvent.change(screen.getByLabelText("Have a link already?"), {
      target: { value: LISTING_PAGE },
    })
    fireEvent.click(screen.getByRole("button", { name: /Add by URL/ }))

    await screen.findByText(/3 could not be read/)
    expect(screen.getByText(/13 more links not fetched · 3 could not be read/)).toBeTruthy()
  })

  it("asks for the next slice of links when Fetch more is pressed", async () => {
    const fetchMore = await addListing()
    expect(addJobByUrl).toHaveBeenCalledTimes(1)

    addJobByUrl.mockResolvedValue(
      listingResult({ fetched: 16, remaining: [`${LISTING_PAGE}jobs/20`] })
    )
    fireEvent.click(fetchMore)

    await waitFor(() => expect(addJobByUrl).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText("16 postings from acme.com")).toBeTruthy())
    expect(addJobByUrl).toHaveBeenLastCalledWith(LISTING_PAGE, { offset: 8 })
    expect(screen.getByText(/1 more link not fetched/)).toBeTruthy()
  })

  it("can be dismissed", async () => {
    await addListing()

    fireEvent.click(screen.getByRole("button", { name: "Dismiss listing summary" }))

    await waitFor(() =>
      expect(screen.queryByText("8 postings from acme.com")).toBeNull()
    )
    // The postings it brought in stay in the list.
    expect(screen.getByText("Role 0")).toBeTruthy()
  })

  it("keeps the single-posting path unchanged", async () => {
    await runWith([candidate()])
    addJobByUrl.mockResolvedValue({
      candidate: candidate({ externalId: "2", canonicalUrl: "https://example.com/jobs/2" }),
      extractionMethod: "json-ld",
    })

    fireEvent.change(screen.getByLabelText("Have a link already?"), {
      target: { value: "https://example.com/jobs/2" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Add by URL/ }))

    await waitFor(() => expect(screen.getByText("2 postings")).toBeTruthy())
    expect(addJobByUrl).toHaveBeenLastCalledWith("https://example.com/jobs/2", undefined)
    expect(screen.queryByRole("button", { name: "Fetch more" })).toBeNull()
  })
})

describe("DiscoveryView query cap", () => {
  function renderWith(activeTargetRoleCount: number) {
    render(
      <DiscoveryView
        queries={["Backend Developer", "Frontend Developer"]}
        activeTargetRoleCount={activeTargetRoleCount}
        atsWatchlist={{ greenhouse: [], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] }}
        requiresSponsorship={false}
        marketCountry={null}
      />
    )
  }

  it("says which roles the run is searching when the profile has more", () => {
    renderWith(8)

    expect(
      screen.getByText(/Searching the top 2 of 8 target roles by priority/i)
    ).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "reorder them in your Career Profile" })
        .getAttribute("href")
    ).toBe("/career-profile#target-roles")
  })

  it("says nothing when every active role is searched", () => {
    renderWith(2)

    expect(screen.queryByText(/Searching the top/i)).toBeNull()
  })
})

describe("DiscoveryView source summary", () => {
  function source(overrides: Partial<DiscoverySourceReport> = {}): DiscoverySourceReport {
    return { provider: "remotive", label: "Remotive", count: 4, ms: 800, status: "ok", ...overrides }
  }

  it("counts the sources that answered and names the ones that timed out", async () => {
    await runWith([candidate()], false, [
      source(),
      source({ provider: "arbeitnow", label: "Arbeitnow", count: 2, ms: 600 }),
      source({ provider: "workday", label: "Workday", count: 0, ms: 7001, status: "timeout" }),
    ])

    expect(
      screen.getByText("3 sources · 2 ok · 1 timed out (Workday)")
    ).toBeTruthy()
  })

  it("names the sources that failed", async () => {
    await runWith([candidate()], false, [
      source(),
      source({ provider: "lever", label: "Lever", count: 0, ms: 120, status: "error" }),
    ])

    expect(screen.getByText("2 sources · 1 ok · 1 failed (Lever)")).toBeTruthy()
  })

  it("keeps a source that answered with nothing out of the line and in the tooltip", async () => {
    await runWith([candidate()], false, [
      source(),
      source({ provider: "ashby", label: "Ashby", count: 0, ms: 310 }),
    ])

    const line = screen.getByText("2 sources · 2 ok")
    expect(line.textContent).not.toContain("Ashby")
    expect(line.parentElement?.getAttribute("title")).toBe(
      "Remotive — 4 postings · 800 ms\nAshby — 0 postings · 310 ms"
    )
  })

  it("names an unconfigured source rather than counting it as a failure", async () => {
    await runWith([candidate()], false, [
      source(),
      source({ provider: "freshteam", label: "Freshteam", count: 0, ms: 0, status: "skipped" }),
    ])

    expect(screen.getByText("2 sources · 1 ok · 1 not set up (Freshteam)")).toBeTruthy()
    expect(
      screen
        .getByText("2 sources · 1 ok · 1 not set up (Freshteam)")
        .parentElement?.getAttribute("title")
    ).toContain("Freshteam — 0 postings · 0 ms (not set up)")
  })

  it("names up to four unconfigured sources on the line", async () => {
    const skipped = (provider: string, label: string) =>
      source({ provider, label, count: 0, ms: 0, status: "skipped" })
    await runWith([candidate()], false, [
      source(),
      skipped("ashby", "Ashby"),
      skipped("bamboohr", "BambooHR"),
      skipped("freshteam", "Freshteam"),
      skipped("workday", "Workday"),
    ])

    const line = screen.getByText(
      "5 sources · 1 ok · 4 not set up (Ashby, BambooHR, Freshteam, Workday)"
    )
    expect(line.textContent!.length).toBeLessThanOrEqual(120)
  })

  it("falls back to the count when more than four sources are not set up", async () => {
    const skipped = (provider: string, label: string) =>
      source({ provider, label, count: 0, ms: 0, status: "skipped" })
    await runWith([candidate()], false, [
      source(),
      skipped("ashby", "Ashby"),
      skipped("bamboohr", "BambooHR"),
      skipped("freshteam", "Freshteam"),
      skipped("workday", "Workday"),
      skipped("greenhouse", "Greenhouse"),
    ])

    const line = screen.getByText("6 sources · 1 ok · 5 not set up")
    expect(line.textContent).not.toContain("Ashby")
  })

  it("falls back to the count when naming them would make the line too long", async () => {
    const skipped = (provider: string, label: string) =>
      source({ provider, label, count: 0, ms: 0, status: "skipped" })
    await runWith([candidate()], false, [
      source({ provider: "lever", label: "Lever", count: 0, ms: 120, status: "error" }),
      skipped("ashby", "A very long board name that nobody would use"),
      skipped("bamboohr", "Another very long board name for the same reason"),
    ])

    const line = screen.getByText(/2 not set up/)
    expect(line.textContent).not.toContain("A very long board name")
    expect(line.textContent).toContain("1 failed (Lever)")
  })

  it("shows no source line when the run reported none", async () => {
    await runWith([candidate()])

    expect(screen.queryByText(/ sources · /)).toBeNull()
  })
})

describe("DiscoveryView posted-within filter", () => {
  const daysAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString()

  const dated = (title: string, id: string, days: number) =>
    candidate({
      title,
      externalId: id,
      url: `https://example.com/jobs/${id}`,
      canonicalUrl: `https://example.com/jobs/${id}`,
      postedAt: daysAgo(days),
    })

  it("keeps only postings inside the window and says how many had no date", async () => {
    // The default candidate carries no `postedAt`, which is what BambooHR and
    // Freshteam list mode return.
    await runWith([
      dated("Fresh Role", "2", 1),
      dated("Stale Role", "3", 20),
      candidate({ title: "Undated Role" }),
    ])
    await screen.findByText("Fresh Role")

    expect(screen.getByText("Fresh Role")).toBeTruthy()
    expect(screen.getByText("Stale Role")).toBeTruthy()
    expect(screen.getByText("Undated Role")).toBeTruthy()
    expect(screen.queryByText("1 without a posted date hidden")).toBeNull()

    const select = screen.getByRole("combobox", { name: "Posted within" })
    fireEvent.change(select, { target: { value: "7" } })

    expect(screen.getByText("Fresh Role")).toBeTruthy()
    expect(screen.queryByText("Stale Role")).toBeNull()
    expect(screen.queryByText("Undated Role")).toBeNull()
    expect(screen.getByText("1 without a posted date hidden")).toBeTruthy()

    fireEvent.change(select, { target: { value: "any" } })

    expect(screen.getByText("Fresh Role")).toBeTruthy()
    expect(screen.getByText("Stale Role")).toBeTruthy()
    expect(screen.getByText("Undated Role")).toBeTruthy()
    expect(screen.queryByText("1 without a posted date hidden")).toBeNull()
  })
})

describe("DiscoveryView multi-location grouping", () => {
  const daysAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString()

  const atLocation = (id: string, location: string, days?: number) =>
    candidate({
      externalId: id,
      location,
      url: `https://example.com/jobs/${id}`,
      canonicalUrl: `https://example.com/jobs/${id}`,
      postedAt: days === undefined ? undefined : daysAgo(days),
    })

  it("renders one row for a role posted in several locations and expands the rest", async () => {
    await runWith([atLocation("1", "Manila"), atLocation("2", "Cebu")])

    expect(screen.getAllByText("Frontend Engineer", { selector: "p" })).toHaveLength(1)
    expect(screen.getByText("Globex · Manila")).toBeTruthy()
    expect(screen.queryByText("Globex · Cebu")).toBeNull()

    const toggle = screen.getByRole("button", { name: /Also posted in Cebu/ })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")

    fireEvent.click(toggle)

    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("Globex · Cebu")).toBeTruthy()
    expect(screen.getAllByText("Frontend Engineer", { selector: "p" })).toHaveLength(2)
  })

  it("names up to three other locations and counts the rest", async () => {
    await runWith([
      atLocation("1", "Manila"),
      atLocation("2", "Cebu"),
      atLocation("3", "Davao"),
      atLocation("4", "Iloilo"),
      atLocation("5", "Baguio"),
    ])

    expect(
      screen.getByRole("button", { name: "Also posted in Cebu, Davao, Iloilo, +1 more" })
    ).toBeTruthy()
  })

  it("notes how much the fold hid, and only when it hid something", async () => {
    await runWith([atLocation("1", "Manila")])
    expect(screen.queryByText(/folded under/)).toBeNull()

    cleanup()
    vi.clearAllMocks()

    await runWith([atLocation("1", "Manila"), atLocation("2", "Cebu")])
    expect(screen.getByText("2 postings")).toBeTruthy()
    expect(screen.getByText("1 other location folded under 1 role")).toBeTruthy()
    expect(screen.queryByText(/grouped into/)).toBeNull()
  })

  it("never groups postings whose employer the source did not disclose", async () => {
    await runWith([
      candidate({
        externalId: "1",
        title: "Backend Developer",
        companyName: "Undisclosed employer",
        location: "Philippines (remote)",
        url: "https://example.com/jobs/1",
        canonicalUrl: "https://example.com/jobs/1",
      }),
      candidate({
        externalId: "2",
        title: "Backend Developer",
        companyName: "Undisclosed employer",
        location: "Philippines (remote)",
        url: "https://example.com/jobs/2",
        canonicalUrl: "https://example.com/jobs/2",
      }),
    ])

    expect(screen.getAllByText("Backend Developer", { selector: "p" })).toHaveLength(2)
    expect(screen.queryByRole("button", { name: /Also posted in/ })).toBeNull()
    expect(screen.queryByText(/folded under/)).toBeNull()
  })

  it("collapses every group again when a new search result set arrives", async () => {
    await runWith([atLocation("1", "Manila"), atLocation("2", "Cebu")])

    const toggle = screen.getByRole("button", { name: /Also posted in Cebu/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")

    runDiscovery.mockResolvedValue({
      queries: ["Frontend Engineer"],
      candidates: [atLocation("1", "Manila"), atLocation("3", "Davao")],
      sources: [],
    })
    fireEvent.click(screen.getByRole("button", { name: "Search" }))

    const next = await screen.findByRole("button", { name: /Also posted in Davao/ })
    expect(next.getAttribute("aria-expanded")).toBe("false")
  })

  it("groups only after the posted-within filter, so a filtered-out variant is gone", async () => {
    await runWith([
      atLocation("1", "Manila", 1),
      atLocation("2", "Cebu", 1),
      atLocation("3", "Davao", 20),
    ])

    expect(
      screen.getByRole("button", { name: /Also posted in Cebu, Davao/ })
    ).toBeTruthy()

    fireEvent.change(screen.getByRole("combobox", { name: "Posted within" }), {
      target: { value: "7" },
    })

    const toggle = screen.getByRole("button", { name: "Also posted in Cebu" })
    fireEvent.click(toggle)

    expect(screen.getByText("Globex · Cebu")).toBeTruthy()
    expect(screen.queryByText("Globex · Davao")).toBeNull()
  })
})
