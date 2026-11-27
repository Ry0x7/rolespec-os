// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { clearOnlinejobsRunClaims } from "@/features/discovery/services/adapters/onlinejobs.adapter"
import { CLIENT_SERVICES, customClientService, findClientService } from "../data/services"
import { buildClientSearchLinks } from "../lib/client-search-links"
import { detectEngagement, effectiveWorkType, scoreClientLead } from "../lib/lead-score"
import { clientSourcesFor, searchClientLeads } from "../services/client-leads.service"

const NOW = new Date("2026-11-27T00:00:00Z")
const va = findClientService("virtual-assistant")!
const automation = findClientService("ai-automation")!

describe("client service catalogue", () => {
  it("has unique ids, queries and lower-case terms for every service", () => {
    expect(new Set(CLIENT_SERVICES.map((service) => service.id)).size).toBe(CLIENT_SERVICES.length)
    for (const service of CLIENT_SERVICES) {
      expect(service.queries.length).toBeGreaterThan(0)
      expect(service.queries.length).toBeLessThanOrEqual(3)
      expect(service.terms.length).toBeGreaterThan(3)
      for (const term of service.terms) expect(term).toBe(term.toLowerCase())
    }
  })

  it("covers virtual assistants, AI automation and on-site work", () => {
    expect(findClientService("virtual-assistant")).toBeDefined()
    expect(findClientService("ai-automation")?.terms).toEqual(expect.arrayContaining(["zapier", "n8n", "make.com"]))
    expect(CLIENT_SERVICES.some((service) => !service.remoteFriendly)).toBe(true)
  })

  it("turns a typed service into a searchable one, or nothing for blank input", () => {
    const custom = customClientService("  Shopify   store manager ")!
    expect(custom.queries).toEqual(["Shopify store manager"])
    expect(custom.terms).toEqual(["shopify store manager", "shopify", "store", "manager"])
    expect(customClientService("   ")).toBeNull()
  })
})

describe("effectiveWorkType", () => {
  it("trusts a remote title over a source's on-site flag", () => {
    expect(effectiveWorkType({ title: "UK Remote Legal PA Support / Assistant", workType: "ONSITE" })).toBe("REMOTE")
    expect(effectiveWorkType({ title: "Work from home bookkeeper", workType: "ONSITE" })).toBe("REMOTE")
  })

  it("leaves an on-site or hybrid title and a plain title alone", () => {
    expect(effectiveWorkType({ title: "Remote or on-site admin in Cebu", workType: "ONSITE" })).toBe("ONSITE")
    expect(effectiveWorkType({ title: "Hybrid remote VA", workType: "HYBRID" })).toBe("HYBRID")
    expect(effectiveWorkType({ title: "Office assistant", workType: "ONSITE" })).toBe("ONSITE")
    expect(effectiveWorkType({ title: "Office assistant" })).toBeUndefined()
  })

  it("keeps a remote-titled post out of on-site credit", () => {
    const fit = scoreClientLead(
      { provider: "freelancer", title: "UK Remote Virtual Assistant", workType: "ONSITE", location: "On-site (location in the project)" },
      { service: va, arrangement: "ONSITE", location: "Cebu City", now: NOW }
    )
    expect(fit.cautions).toContain("Remote work, but you asked for on-site clients")
  })
})

describe("scoreClientLead", () => {
  it("ranks a fresh remote marketplace project for the service as a strong lead", () => {
    const fit = scoreClientLead(
      {
        provider: "freelancer",
        title: "Virtual Assistant for calendar and inbox",
        description: "Hourly, 10 hours a week of email management.",
        workType: "REMOTE",
        postedAt: new Date("2026-11-26T00:00:00Z"),
      },
      { service: va, arrangement: "REMOTE", now: NOW }
    )
    expect(fit.relevant).toBe(true)
    expect(fit.band).toBe("STRONG")
    expect(fit.jobType).toBe("FREELANCE")
    expect(fit.engagement).toBe("HOURLY")
    expect(fit.reasons[0]).toMatch(/virtual assistant/)
  })

  it("marks a post that never mentions the service as unrelated", () => {
    const fit = scoreClientLead(
      { provider: "freelancer", title: "Industrial Data Diode Development", description: "Firmware for OT networks." },
      { service: automation, arrangement: "REMOTE", now: NOW }
    )
    expect(fit.relevant).toBe(false)
  })

  it("matches whole words only, including dotted names", () => {
    const fit = scoreClientLead(
      { provider: "remotive", title: "Ops lead", description: "Build make.com scenarios. We use Gmail." },
      { service: automation, arrangement: "REMOTE", now: NOW }
    )
    expect(fit.matchedTerms).toContain("make.com")
    // "automation" never appears; "automate" is not inside "automatically".
    const loose = scoreClientLead(
      { provider: "remotive", title: "Analyst", description: "Reports are updated automatically." },
      { service: automation, arrangement: "REMOTE", now: NOW }
    )
    expect(loose.relevant).toBe(false)
  })

  it("demotes a scam-flagged lead and says why", () => {
    const fit = scoreClientLead(
      { provider: "freelancer", title: "Virtual assistant", workType: "REMOTE", postedAt: NOW },
      {
        service: va,
        arrangement: "REMOTE",
        risk: { level: "HIGH", reasons: ["Asks the candidate to pay a fee"] },
        now: NOW,
      }
    )
    expect(fit.band).not.toBe("STRONG")
    expect(fit.cautions[0]).toBe("Scam signal: Asks the candidate to pay a fee")
  })

  it("rewards an on-site lead near the chosen area and warns about remote ones", () => {
    const cleaning = findClientService("local-services")!
    const near = scoreClientLead(
      { provider: "freelancer", title: "Office cleaning", workType: "ONSITE", location: "Cebu City, Philippines" },
      { service: cleaning, arrangement: "ONSITE", location: "Cebu", now: NOW }
    )
    expect(near.reasons).toContain("On site in Cebu City, Philippines")
    const remote = scoreClientLead(
      { provider: "freelancer", title: "Cleaning schedule template", workType: "REMOTE" },
      { service: cleaning, arrangement: "ONSITE", location: "Cebu", now: NOW }
    )
    expect(remote.cautions).toContain("Remote work, but you asked for on-site clients")
  })

  it("only names a job type the post itself states", () => {
    expect(detectEngagement({ title: "Part-time VA" })).toBe("PART_TIME")
    expect(detectEngagement({ title: "VA", salaryText: "$250–750 USD fixed price" })).toBe("FIXED_PRICE")
    expect(scoreClientLead({ provider: "remotive", title: "Executive Assistant" }, { service: va, arrangement: "REMOTE", now: NOW }).jobType).toBeNull()
  })
})

describe("buildClientSearchLinks", () => {
  it("builds marketplace and hiring-post searches for remote work", () => {
    const links = buildClientSearchLinks({ service: va, arrangement: "REMOTE" })
    const byId = Object.fromEntries(links.map((link) => [link.id, link]))
    expect(new URL(byId.upwork!.url).searchParams.get("q")).toBe("virtual assistant")
    expect(byId.freelancer!.url).toBe("https://www.freelancer.com/job-search/virtual-assistant/")
    expect(new URL(byId.onlinejobsph!.url).searchParams.get("jobkeyword")).toBe("virtual assistant")
    expect(byId["linkedin-posts"]!.signInRequired).toBe(true)
    expect(new URL(byId["reddit-forhire"]!.url).searchParams.get("q")).toBe("[Hiring] virtual assistant")
    expect(links.some((link) => link.kind === "LOCAL")).toBe(false)
  })

  it("adds local prospects and drops remote marketplaces for on-site work", () => {
    const links = buildClientSearchLinks({ service: va, arrangement: "ONSITE", location: "Davao" })
    expect(links.some((link) => link.kind === "MARKETPLACE")).toBe(false)
    const maps = links.find((link) => link.id === "maps-real-estate-agencies")!
    expect(maps.label).toBe("Real estate agencies near Davao")
    expect(new URL(maps.url).searchParams.get("query")).toBe("real estate agencies near Davao")
    expect(new URL(links.find((link) => link.id === "indeed-local")!.url).searchParams.get("l")).toBe("Davao")
  })

  it("encodes a typed service safely", () => {
    const custom = customClientService('C++ "embedded" dev')!
    for (const link of buildClientSearchLinks({ service: custom, arrangement: "ANY" })) {
      expect(() => new URL(link.url)).not.toThrow()
      expect(new URL(link.url).protocol).toBe("https:")
    }
  })
})

describe("searchClientLeads", () => {
  beforeEach(() => {
    clearOnlinejobsRunClaims()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("asks only Freelancer.com for on-site work", () => {
    expect(clientSourcesFor("ONSITE").map((adapter) => adapter.id)).toEqual(["freelancer"])
    expect(clientSourcesFor("REMOTE").map((adapter) => adapter.id)).toEqual(["freelancer", "remotive", "onlinejobsph"])
  })

  it("scores, filters and sorts leads from every source, and survives a dead source", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.hostname === "www.freelancer.com") {
        return new Response(
          JSON.stringify({
            status: "success",
            result: {
              projects: [
                {
                  id: 1,
                  title: "Virtual assistant for inbox",
                  seo_url: "admin/va-inbox",
                  type: "hourly",
                  budget: { minimum: 5, maximum: 8 },
                  currency: { code: "USD", sign: "$" },
                  time_submitted: Math.floor(NOW.getTime() / 1000) - 3600,
                  local: false,
                },
                { id: 2, title: "PCB layout", seo_url: "pcb/layout", type: "fixed", local: false },
              ],
            },
          }),
          { status: 200 }
        )
      }
      if (url.hostname === "remotive.com") {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 9,
                url: "https://remotive.com/remote-jobs/x/executive-assistant-9",
                title: "Executive Assistant (part-time)",
                company_name: "Acme",
                publication_date: "2026-11-10T00:00:00",
                description: "<p>Calendar and travel</p>",
              },
            ],
          }),
          { status: 200 }
        )
      }
      throw new Error("offline")
    })

    const result = await searchClientLeads({ service: va, arrangement: "REMOTE", now: NOW })
    expect(result.leads.map((lead) => lead.title)).toEqual([
      "Virtual assistant for inbox",
      "Executive Assistant (part-time)",
    ])
    expect(result.unrelatedCount).toBe(1)
    expect(result.leads[0]!.fit.jobType).toBe("FREELANCE")
    expect(result.leads[1]!.fit.jobType).toBe("PART_TIME")
    expect(result.sources.find((source) => source.provider === "freelancer")?.count).toBe(1)
    expect(result.sources.find((source) => source.provider === "onlinejobsph")?.count).toBe(0)
  })
})
