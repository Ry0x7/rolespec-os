// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { normalizePosting } from "../../normalize.service"
import {
  FREELANCER_CLIENT_NAME,
  FREELANCER_RESULT_LIMIT,
  freelancerAdapter,
  freelancerBudgetText,
  mapFreelancerProject,
  parseFreelancerResponse,
} from "../freelancer.adapter"

const CONTEXT = { atsWatchlist: { greenhouse: [], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] } }

/** Shaped from a real `projects/active` response captured on 2026-11-27. */
const HOURLY_PROJECT = {
  id: 40837788,
  title: "Integrasi Gmail WhatsApp Instagram",
  seo_url: "zapier/Integrasi-Gmail-WhatsApp-Instagram",
  status: "active",
  type: "hourly",
  currency: { code: "USD", sign: "$" },
  budget: { minimum: 15, maximum: 25 },
  hourly_project_info: { commitment: { hours: 40, interval: "week" } },
  description: "Saya membutuhkan bantuan untuk menyiapkan satu akun Gmail bisnis.",
  preview_description: "Saya membutuhkan bantuan",
  time_submitted: 1795736835,
  local: false,
  location: { country: {} },
  jobs: [
    { id: 1977, name: "Automation" },
    { id: 2050, name: "Zapier" },
  ],
  owner_id: null,
}

const FIXED_LOCAL_PROJECT = {
  id: 40836996,
  title: "Mudroom and Garage Addition Blueprint",
  seo_url: "structural-engineering/Mudroom-Garage-Addition",
  type: "fixed",
  currency: { code: "AUD", sign: "$" },
  budget: { minimum: 250, maximum: 750 },
  description: "Drawings for a small addition.",
  time_submitted: 1795695229,
  local: true,
  location: { country: { name: "Australia" }, city: "Brisbane" },
  jobs: [],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("mapFreelancerProject", () => {
  it("maps a remote hourly project onto a lead with the buyer's own budget", () => {
    const posting = mapFreelancerProject(HOURLY_PROJECT)!
    expect(posting).toMatchObject({
      provider: "freelancer",
      externalId: "40837788",
      title: "Integrasi Gmail WhatsApp Instagram",
      companyName: FREELANCER_CLIENT_NAME,
      url: "https://www.freelancer.com/projects/zapier/Integrasi-Gmail-WhatsApp-Instagram",
      location: "Remote",
      workTypeHint: "remote",
      salaryText: "$15–25 USD per hour",
      postedAt: new Date(1795736835 * 1000).toISOString(),
    })
    expect(posting.description).toContain("Skills requested: Automation, Zapier")
  })

  it("keeps an on-site project on-site with its own place", () => {
    const posting = mapFreelancerProject(FIXED_LOCAL_PROJECT)!
    expect(posting.location).toBe("Brisbane, Australia")
    expect(posting.workTypeHint).toBe("onsite")
    expect(posting.salaryText).toBe("$250–750 AUD fixed price")
    expect(normalizePosting(posting)?.workType).toBe("ONSITE")
  })

  it("drops a project without an id, title or page slug", () => {
    expect(mapFreelancerProject({ ...HOURLY_PROJECT, id: undefined })).toBeNull()
    expect(mapFreelancerProject({ ...HOURLY_PROJECT, title: " " })).toBeNull()
    expect(mapFreelancerProject({ ...HOURLY_PROJECT, seo_url: undefined })).toBeNull()
  })
})

describe("freelancerBudgetText", () => {
  it("states an open-ended or single figure without inventing the other end", () => {
    expect(freelancerBudgetText({ type: "hourly", currency: { code: "USD", sign: "$" }, budget: { minimum: 50, maximum: null } })).toBe(
      "from $50 USD per hour"
    )
    expect(freelancerBudgetText({ type: "fixed", currency: { code: "EUR", sign: "€" }, budget: { minimum: 30, maximum: 30 } })).toBe(
      "€30 EUR fixed price"
    )
    expect(freelancerBudgetText({ type: "fixed", budget: {} })).toBeUndefined()
  })
})

describe("parseFreelancerResponse", () => {
  it("reads result.projects and rejects any other shape", () => {
    expect(parseFreelancerResponse({ status: "success", result: { projects: [HOURLY_PROJECT, null, {}] } })).toHaveLength(1)
    expect(parseFreelancerResponse({ status: "error" })).toBeNull()
    expect(parseFreelancerResponse(null)).toBeNull()
  })
})

describe("freelancerAdapter.search", () => {
  it("sends one capped query with the full description and skill tags", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ status: "success", result: { projects: [HOURLY_PROJECT], total_count: 1 } }))
    const postings = await freelancerAdapter.search(
      { role: "AI automation", keywords: ["n8n"] },
      new AbortController().signal,
      CONTEXT
    )
    expect(postings).toHaveLength(1)
    const url = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(url.origin + url.pathname).toBe("https://www.freelancer.com/api/projects/0.1/projects/active/")
    expect(url.searchParams.get("query")).toBe("AI automation n8n")
    expect(url.searchParams.get("limit")).toBe(String(FREELANCER_RESULT_LIMIT))
    expect(url.searchParams.get("full_description")).toBe("true")
    expect(url.searchParams.get("job_details")).toBe("true")
  })

  it("returns an empty list on an error status, a bad shape or a network failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503))
    expect(await freelancerAdapter.search({ role: "Virtual assistant" }, new AbortController().signal, CONTEXT)).toEqual([])
    fetchMock.mockResolvedValueOnce(jsonResponse({ unexpected: true }))
    expect(await freelancerAdapter.search({ role: "Virtual assistant" }, new AbortController().signal, CONTEXT)).toEqual([])
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    expect(await freelancerAdapter.search({ role: "Virtual assistant" }, new AbortController().signal, CONTEXT)).toEqual([])
  })

  it("makes no request for a blank query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    expect(await freelancerAdapter.search({ role: "  " }, new AbortController().signal, CONTEXT)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
