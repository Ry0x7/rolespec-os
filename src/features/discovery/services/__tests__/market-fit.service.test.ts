import { describe, expect, it } from "vitest"

import { classifyMarketFit, resolveProfileCountry } from "../market-fit.service"

/** A rooted Philippines-based profile: the case the feature exists for. */
const PH_PROFILE = {
  locations: ["Cagayan de Oro, PH"],
  openToRelocation: false,
}

function fit(location: string | null, profile = PH_PROFILE) {
  return classifyMarketFit({ location }, profile)
}

describe("classifyMarketFit — board host hint", () => {
  it("reads a PH-only board host as in market when the posting states no location", () => {
    const result = classifyMarketFit(
      { location: null, url: "https://bossjob.ph/en-us/job/web-developer-remote-500169" },
      PH_PROFILE
    )
    expect(result.fit).toBe("IN_MARKET")
    expect(result.label).toBe("Open to PH")
    expect(result.reason).toBe("Listed on a Philippine job board (bossjob.ph).")
  })

  it("ignores the www. prefix the same board sometimes carries", () => {
    expect(
      classifyMarketFit(
        { location: null, url: "https://www.kalibrr.com/c/acme/jobs/1" },
        PH_PROFILE
      ).fit
    ).toBe("IN_MARKET")
  })

  it("says nothing about a host it does not publish for one country", () => {
    const result = classifyMarketFit(
      { location: null, url: "https://boards.greenhouse.io/acme/jobs/1" },
      PH_PROFILE
    )
    expect(result.fit).toBe("UNKNOWN")
    expect(result.label).toBe("Location unstated")
  })

  it("never outranks what the posting actually said", () => {
    // The board is Philippine; the role is not.
    const result = classifyMarketFit(
      { location: "USA Only", url: "https://bossjob.ph/en-us/job/1" },
      PH_PROFILE
    )
    expect(result.fit).toBe("RESTRICTED")
    expect(result.restrictedTo).toBe("US")
  })

  it("is ignored when the profile resolves to another country", () => {
    expect(
      classifyMarketFit(
        { location: null, url: "https://bossjob.ph/en-us/job/1" },
        { locations: ["Berlin, Germany"], openToRelocation: false }
      ).fit
    ).toBe("UNKNOWN")
  })

  it("shrugs at a link that is not a URL at all", () => {
    expect(classifyMarketFit({ location: null, url: "not a url" }, PH_PROFILE).fit).toBe(
      "UNKNOWN"
    )
  })
})

describe("classifyMarketFit", () => {
  describe("in market", () => {
    it("reads a full Philippine address as in market", () => {
      const result = fit("Metro Manila, Makati City, Philippines")
      expect(result.fit).toBe("IN_MARKET")
      expect(result.label).toBe("Open to PH")
    })

    it("reads the country code as a standalone token", () => {
      expect(fit("Manila, PH").fit).toBe("IN_MARKET")
    })

    it("reads a province city with no country suffix", () => {
      expect(fit("Cagayan de Oro").fit).toBe("IN_MARKET")
    })

    it("does not read a US place name as Philippine", () => {
      // "Laguna" and "Clark" are Philippine provinces and US places both.
      expect(fit("Laguna Beach, CA").fit).not.toBe("IN_MARKET")
      expect(fit("Clark, NJ").fit).not.toBe("IN_MARKET")
      // The qualified spellings still count.
      expect(fit("Clark, Pampanga").fit).toBe("IN_MARKET")
      expect(fit("Laguna, Philippines").fit).toBe("IN_MARKET")
    })

    it("reads a Philippine initialism only when the posting shouted it", () => {
      expect(fit("NCR").fit).toBe("IN_MARKET")
      expect(fit("CDO, Misamis Oriental").fit).toBe("IN_MARKET")
      expect(fit("ncr platform team").fit).not.toBe("IN_MARKET")
    })

    it("does not read PH out of a longer word", () => {
      // Not in the city table either, so the conservative answer is UNKNOWN —
      // what matters is that "Philadelphia" never reads as the PH market.
      const result = fit("Philadelphia, PA")
      expect(result.fit).toBe("UNKNOWN")
      expect(result.label).toBe("Location unclear")
    })

    it("matches a non-PH profile against its own stated location", () => {
      const result = fit("Berlin", { locations: ["Berlin"], openToRelocation: false })
      expect(result.fit).toBe("IN_MARKET")
      expect(result.label).toBe("Your area")
    })
  })

  describe("region and open", () => {
    it("reads an APAC band as the user's region", () => {
      const result = fit("Remote - APAC")
      expect(result.fit).toBe("REGION")
      expect(result.label).toBe("APAC")
    })

    it("reads a timezone band as the user's region", () => {
      expect(fit("Remote (GMT+8)").fit).toBe("REGION")
    })

    it("does not read Seattle's airport code as South East Asia", () => {
      // Observed live: Stripe publishes "SEA, SF, NY, Toronto".
      const result = fit("SEA, SF, NY, Toronto")
      expect(result.fit).not.toBe("REGION")
      expect(result.fit).toBe("RESTRICTED")
    })

    it("reads worldwide as open", () => {
      const result = fit("Worldwide")
      expect(result.fit).toBe("OPEN")
      expect(result.label).toBe("Worldwide")
    })

    it("does not read a country-qualified remote posting as open", () => {
      expect(fit("Anywhere in the United States").fit).toBe("RESTRICTED")
    })
  })

  describe("restricted", () => {
    it("restricts a remote posting limited to one country", () => {
      const result = fit("USA Only")
      expect(result.fit).toBe("RESTRICTED")
      expect(result.label).toBe("US only")
      expect(result.reason).toContain("the Philippines")
    })

    it("restricts a European city", () => {
      expect(fit("Berlin").fit).toBe("RESTRICTED")
    })

    it("restricts a US city and state", () => {
      const result = fit("New York, NY")
      expect(result.fit).toBe("RESTRICTED")
      expect(result.label).toBe("Limited to New York")
    })

    it("reads the same restriction for a user who is open to relocation", () => {
      // What the posting said does not change with who is reading it. The
      // relocation answer lifts the verdict cap in `qualify.service` instead.
      const result = fit("USA Only", { locations: ["Cagayan de Oro, PH"], openToRelocation: true })
      expect(result.fit).toBe("RESTRICTED")
      expect(result.restrictedTo).toBe("US")
      expect(result.label).toBe("US only")
    })

    it("reads an explicit restriction from the description when the location is silent", () => {
      const result = classifyMarketFit(
        { location: "Remote", description: "This role is US only. We cannot hire elsewhere." },
        PH_PROFILE
      )
      expect(result.fit).toBe("RESTRICTED")
    })

    it("ignores a city merely mentioned in the description", () => {
      const result = classifyMarketFit(
        { location: "Remote", description: "Our office is in Berlin and we meet twice a year." },
        PH_PROFILE
      )
      expect(result.fit).toBe("UNKNOWN")
    })
  })

  describe("unknown", () => {
    it("returns unknown for an empty location", () => {
      expect(fit("").fit).toBe("UNKNOWN")
      expect(fit(null).fit).toBe("UNKNOWN")
    })

    it("separates a posting that said nothing from one it could not place", () => {
      expect(fit(null).label).toBe("Location unstated")

      const remote = fit("Remote")
      expect(remote.fit).toBe("UNKNOWN")
      expect(remote.label).toBe("Location unclear")
      expect(remote.reason).toContain("Remote")
    })

    it("returns unknown rather than restricted for an unrecognized string", () => {
      expect(fit("Kaunas").fit).toBe("UNKNOWN")
    })

    it("returns unknown for an empty profile", () => {
      expect(fit("Remote - APAC", { locations: [], openToRelocation: false }).fit).toBe("REGION")
      expect(fit("Kaunas", { locations: [], openToRelocation: false }).fit).toBe("UNKNOWN")
    })
  })
})

describe("resolveProfileCountry", () => {
  it("resolves a Philippine profile", () => {
    expect(resolveProfileCountry(["Cagayan de Oro, PH", "Remote, USA"])).toBe("PH")
  })

  it("returns null when no location names a known market", () => {
    expect(resolveProfileCountry(["Berlin", "Remote"])).toBeNull()
    expect(resolveProfileCountry([])).toBeNull()
  })
})
