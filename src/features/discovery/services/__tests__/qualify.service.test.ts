import { describe, it, expect } from "vitest"

import { JOB_REQUIREMENT_FLAGS } from "@/features/jobs/services/job-requirements.service"

import {
  countKeywordMentions,
  matchesAnyRoleTitle,
  qualifyCandidate,
  titleRelevance,
  toQualificationProfile,
  type QualificationPosting,
  type QualificationProfile,
} from "../qualify.service"

function profile(overrides: Partial<QualificationProfile> = {}): QualificationProfile {
  return {
    targetRoleTitles: ["Frontend Engineer"],
    locations: [],
    openToRelocation: false,
    workModes: [],
    requiresSponsorship: null,
    experienceLevel: null,
    capabilities: [],
    ...overrides,
  }
}

function posting(overrides: Partial<QualificationPosting> = {}): QualificationPosting {
  return {
    title: "Frontend Engineer",
    companyName: "Acme",
    url: "https://boards.example.com/acme/jobs/1",
    ...overrides,
  }
}

describe("toQualificationProfile", () => {
  it("keeps only active target roles and defaults every missing field", () => {
    const result = toQualificationProfile({
      targetRoles: [
        { title: "Frontend Engineer", active: true },
        { title: "Paused", active: false },
      ],
    })

    expect(result).toEqual({
      targetRoleTitles: ["Frontend Engineer"],
      locations: [],
      openToRelocation: false,
      workModes: [],
      requiresSponsorship: null,
      experienceLevel: null,
      capabilities: [],
    })
  })

  it("survives a profile read that returned nothing at all", () => {
    expect(() => toQualificationProfile({})).not.toThrow()
    expect(toQualificationProfile({}).targetRoleTitles).toEqual([])
  })
})

describe("qualifyCandidate — Worth it?", () => {
  it("flags a work mode the user did not ask for", () => {
    const result = qualifyCandidate(
      posting({ workType: "ONSITE" }),
      profile({ workModes: ["REMOTE"] })
    )

    expect(result.worthIt.signal).toBe("CONCERN")
    expect(result.worthIt.reasons.join(" ")).toMatch(/onsite/i)
  })

  it("reads GOOD when the work mode is one the user wants", () => {
    const result = qualifyCandidate(
      posting({ workType: "REMOTE" }),
      profile({ workModes: ["REMOTE", "HYBRID"] })
    )

    expect(result.worthIt.signal).toBe("GOOD")
  })

  it("does not hold location against a remote posting", () => {
    const result = qualifyCandidate(
      posting({ workType: "REMOTE", location: "Worldwide" }),
      profile({ workModes: ["REMOTE"], locations: ["Berlin"] })
    )

    expect(result.worthIt.signal).toBe("GOOD")
    expect(result.worthIt.reasons.join(" ")).not.toMatch(/outside your preferred/i)
  })

  it("matches a preferred location inside a longer posting location", () => {
    const result = qualifyCandidate(
      posting({ workType: "ONSITE", location: "Berlin, Germany" }),
      profile({ workModes: ["ONSITE"], locations: ["Berlin"] })
    )

    expect(result.worthIt.signal).toBe("GOOD")
  })

  it("does not flag a far location when the user is open to relocation", () => {
    const result = qualifyCandidate(
      posting({ workType: "ONSITE", location: "Tokyo, Japan" }),
      profile({ workModes: ["ONSITE"], locations: ["Berlin"], openToRelocation: true })
    )

    expect(result.worthIt.signal).not.toBe("CONCERN")
  })

  it("flags a title that shares nothing with any target role", () => {
    const result = qualifyCandidate(
      posting({ title: "Warehouse Associate" }),
      profile({ targetRoleTitles: ["Frontend Engineer"] })
    )

    expect(result.worthIt.reasons.join(" ")).toMatch(/target roles/i)
  })

  it("does not let a seniority word alone carry a title match", () => {
    const result = qualifyCandidate(
      posting({ title: "Senior Accountant" }),
      profile({ targetRoleTitles: ["Senior Frontend Engineer"] })
    )

    expect(result.worthIt.reasons.join(" ")).toMatch(/target roles/i)
  })
})

describe("qualifyCandidate — Worth it? seniority", () => {
  it("flags a senior-titled posting for a mid-level profile", () => {
    const result = qualifyCandidate(
      posting({ title: "Senior Frontend Engineer" }),
      profile({ experienceLevel: "MID" })
    )

    expect(result.worthIt.signal).toBe("CONCERN")
    expect(result.worthIt.reasons.join(" ")).toMatch(
      /Looks like a Senior-level role; your profile targets Mid\./
    )
  })

  it("does not flag a senior posting for a senior profile", () => {
    const result = qualifyCandidate(
      posting({ title: "Senior Frontend Engineer" }),
      profile({ experienceLevel: "SENIOR" })
    )

    expect(result.worthIt.reasons.join(" ")).not.toMatch(/Looks like a/i)
  })

  it("does not flag a posting below the user's level", () => {
    const result = qualifyCandidate(
      posting({ title: "Junior Frontend Engineer" }),
      profile({ experienceLevel: "SENIOR" })
    )

    expect(result.worthIt.reasons.join(" ")).not.toMatch(/Looks like a/i)
  })

  it("never flags seniority when the profile has no level", () => {
    const result = qualifyCandidate(
      posting({ title: "VP of Engineering, Frontend" }),
      profile({ experienceLevel: null })
    )

    expect(result.worthIt.reasons.join(" ")).not.toMatch(/Looks like a/i)
  })

  it("falls back to the description's years-of-experience bar", () => {
    const result = qualifyCandidate(
      posting({
        title: "Frontend Engineer",
        description: "You have 9+ years of experience shipping web products.",
      }),
      profile({ experienceLevel: "MID" })
    )

    expect(result.worthIt.signal).toBe("CONCERN")
    expect(result.worthIt.reasons.join(" ")).toMatch(
      /Looks like a Lead-level role; your profile targets Mid\./
    )
  })

  it("ignores a years number that is not about experience", () => {
    const result = qualifyCandidate(
      posting({
        title: "Frontend Engineer",
        description: "We have been profitable for 12 years and are still growing.",
      }),
      profile({ experienceLevel: "JUNIOR" })
    )

    expect(result.worthIt.reasons.join(" ")).not.toMatch(/Looks like a/i)
  })

  it("does not read 'seniority' as a seniority marker", () => {
    const result = qualifyCandidate(
      posting({ title: "Frontend Engineer (any seniority)" }),
      profile({ experienceLevel: "JUNIOR" })
    )

    expect(result.worthIt.reasons.join(" ")).not.toMatch(/Looks like a/i)
  })

  it("lets an explicit target role outrank the profile's level", () => {
    const result = qualifyCandidate(
      posting({ title: "Senior Frontend Engineer" }),
      profile({ experienceLevel: "MID", targetRoleTitles: ["Senior Frontend Engineer"] })
    )

    expect(result.worthIt.reasons.join(" ")).not.toMatch(/Looks like a/i)
  })
})

describe("qualifyCandidate — Eligible?", () => {
  const NO_SPONSORSHIP = "We are unable to offer visa sponsorship for this role."

  it("blocks a no-sponsorship posting for a user who needs sponsorship", () => {
    const result = qualifyCandidate(
      posting({ description: NO_SPONSORSHIP }),
      profile({ requiresSponsorship: true })
    )

    expect(result.eligible.signal).toBe("BLOCKER")
    expect(result.verdict).toBe("BLOCKED")
    expect(result.nextAction).toMatch(/skip/i)
  })

  it("does not block the same posting for a user who does not need sponsorship", () => {
    const result = qualifyCandidate(
      posting({ description: NO_SPONSORSHIP }),
      profile({ requiresSponsorship: false })
    )

    expect(result.eligible.signal).not.toBe("BLOCKER")
    expect(result.verdict).not.toBe("BLOCKED")
  })

  it("never blocks on an unanswered sponsorship question, and says why", () => {
    const result = qualifyCandidate(
      posting({ description: NO_SPONSORSHIP }),
      profile({ requiresSponsorship: null })
    )

    expect(result.eligible.signal).toBe("CONCERN")
    expect(result.eligible.reasons.join(" ")).toMatch(/Career Profile/i)
  })

  it("blocks a citizenship demand for a user who needs sponsorship", () => {
    const result = qualifyCandidate(
      posting({ description: "Applicants must be a US citizen." }),
      profile({ requiresSponsorship: true })
    )

    expect(result.eligible.signal).toBe("BLOCKER")
  })

  it("reads GOOD when sponsorship is offered and the user needs it", () => {
    const result = qualifyCandidate(
      posting({ description: "Visa sponsorship is available for the right candidate." }),
      profile({ requiresSponsorship: true })
    )

    expect(result.eligible.signal).toBe("GOOD")
  })

  it("treats a required clearance as a caveat, never a block", () => {
    const result = qualifyCandidate(
      posting({ description: "An active security clearance is required." }),
      profile({ requiresSponsorship: false })
    )

    expect(result.eligible.signal).toBe("CONCERN")
    expect(result.verdict).not.toBe("BLOCKED")
  })

  it("says nothing when the posting stated no requirements", () => {
    const result = qualifyCandidate(
      posting({ description: "Build and ship features with a small team." }),
      profile()
    )

    expect(result.eligible).toEqual({ signal: "NEUTRAL", reasons: [] })
  })

  it("exposes the stated requirements for the badge row", () => {
    const result = qualifyCandidate(
      posting({ description: NO_SPONSORSHIP }),
      profile({ requiresSponsorship: false })
    )

    expect(result.requirementFlags).toContain("NO_SPONSORSHIP")
  })
})

describe("qualifyCandidate — Match?", () => {
  const CAPABILITIES = [
    { name: "React", confirmed: true },
    { name: "TypeScript", confirmed: true },
    { name: "Node.js", confirmed: true },
    { name: "Kubernetes", confirmed: false },
  ]

  it("reports only capabilities the profile already holds", () => {
    const result = qualifyCandidate(
      posting({
        description: "You will write React and TypeScript, and some Rust on the side.",
      }),
      profile({ capabilities: CAPABILITIES })
    )

    expect(result.match.matched).toEqual(["React", "TypeScript"])
    // The posting mentioning Rust cannot add it to the user.
    expect(result.match.matched).not.toContain("Rust")
  })

  it("reads GOOD once enough confirmed capabilities are mentioned", () => {
    const result = qualifyCandidate(
      posting({ description: "React, TypeScript and Node.js across the stack." }),
      profile({ capabilities: CAPABILITIES })
    )

    expect(result.match.confirmedCount).toBe(3)
    expect(result.match.signal).toBe("GOOD")
  })

  it("counts an unconfirmed capability as matched but not as confirmed", () => {
    const result = qualifyCandidate(
      posting({ description: "Kubernetes experience preferred." }),
      profile({ capabilities: CAPABILITIES })
    )

    expect(result.match.matched).toEqual(["Kubernetes"])
    expect(result.match.confirmedCount).toBe(0)
    expect(result.match.signal).toBe("NEUTRAL")
  })

  it("matches on whole tokens only", () => {
    const result = qualifyCandidate(
      posting({ description: "We use Reactive Streams heavily." }),
      profile({ capabilities: [{ name: "React", confirmed: true }] })
    )

    expect(result.match.matched).toEqual([])
  })

  it("keeps punctuation-bearing names as one token", () => {
    const result = qualifyCandidate(
      posting({ description: "Systems work in C++ and C#." }),
      profile({
        capabilities: [
          { name: "C++", confirmed: true },
          { name: "C#", confirmed: true },
        ],
      })
    )

    expect(result.match.matched).toEqual(["C++", "C#"])
  })

  it("matches a capability that ends a sentence", () => {
    const result = qualifyCandidate(
      posting({ description: "Our stack is React. We also run Node.js." }),
      profile({
        capabilities: [
          { name: "React", confirmed: true },
          { name: "Node.js", confirmed: true },
        ],
      })
    )

    expect(result.match.matched).toEqual(["React", "Node.js"])
  })

  it("stays NEUTRAL when the source published no description", () => {
    const result = qualifyCandidate(
      posting({ description: undefined }),
      profile({ capabilities: CAPABILITIES })
    )

    expect(result.match.signal).toBe("NEUTRAL")
    expect(result.match.reasons.join(" ")).toMatch(/no description/i)
  })

  it("asks for capabilities rather than judging when the profile has none", () => {
    const result = qualifyCandidate(
      posting({ description: "React and TypeScript." }),
      profile({ capabilities: [] })
    )

    expect(result.match.signal).toBe("NEUTRAL")
    expect(result.match.reasons.join(" ")).toMatch(/Career Profile/i)
  })
})

describe("qualifyCandidate — Risk? and the verdict", () => {
  it("demotes a posting the risk heuristics score HIGH", () => {
    const result = qualifyCandidate(
      posting({
        title: "Data Entry Assistant",
        description:
          "Earn $5000 per week working from home! No experience needed. Pay a $200 onboarding fee and contact us on Telegram at recruiter.acme@gmail.com to start immediately.",
      }),
      profile({ capabilities: [{ name: "React", confirmed: true }] })
    )

    expect(result.risk.level).toBe("HIGH")
    expect(result.verdict).toBe("WEAK")
    expect(result.nextAction).toMatch(/verify/i)
  })

  it("reads STRONG when nothing is concerning and the match is good", () => {
    const result = qualifyCandidate(
      posting({
        workType: "REMOTE",
        description:
          "You will build interfaces with React, TypeScript and Node.js alongside a small product team.",
      }),
      profile({
        workModes: ["REMOTE"],
        requiresSponsorship: false,
        capabilities: [
          { name: "React", confirmed: true },
          { name: "TypeScript", confirmed: true },
          { name: "Node.js", confirmed: true },
        ],
      })
    )

    expect(result.verdict).toBe("STRONG")
    expect(result.nextAction).toMatch(/save it/i)
  })

  it("does not call an empty profile a strong match", () => {
    const result = qualifyCandidate(
      posting({ description: "Build things." }),
      profile({ targetRoleTitles: [], capabilities: [] })
    )

    expect(result.verdict).toBe("WORTH_A_LOOK")
  })

  it("drops to WEAK once two answers are concerning", () => {
    const result = qualifyCandidate(
      posting({ workType: "ONSITE", description: "Ship Rust services." }),
      profile({
        workModes: ["REMOTE"],
        capabilities: [{ name: "React", confirmed: true }],
      })
    )

    expect(result.worthIt.signal).toBe("CONCERN")
    expect(result.match.signal).toBe("CONCERN")
    expect(result.verdict).toBe("WEAK")
  })

  it("is pure: the same inputs always produce the same verdict", () => {
    const input = posting({ workType: "REMOTE", description: "React and TypeScript." })
    const owner = profile({
      workModes: ["REMOTE"],
      capabilities: [{ name: "React", confirmed: true }],
    })

    expect(qualifyCandidate(input, owner)).toEqual(qualifyCandidate(input, owner))
  })
})

describe("qualifyCandidate — honest indeterminacy", () => {
  it("says it could not check work mode when the posting never states one", () => {
    const result = qualifyCandidate(
      posting({ location: "Berlin, Germany" }),
      profile({ workModes: ["REMOTE"], locations: ["Manila, PH"], openToRelocation: true })
    )

    expect(result.worthIt.unchecked).toEqual(["work-mode"])
    expect(result.worthIt.reasons.join(" ")).toMatch(/Couldn't check work mode/i)
    expect(result.worthIt.signal).not.toBe("GOOD")
  })

  it("says it could not check location or work mode when the posting states neither", () => {
    const result = qualifyCandidate(
      posting(),
      profile({ workModes: ["REMOTE"], locations: ["Manila, PH"] })
    )

    expect(result.worthIt.unchecked).toEqual(["work-mode", "location"])
    expect(result.worthIt.reasons.join(" ")).toMatch(/Couldn't check location or work mode/i)
  })

  it("says it could not check the requirements when the source published no description", () => {
    const result = qualifyCandidate(posting({ description: undefined }), profile())

    expect(result.eligible.unchecked).toEqual(["requirements"])
    expect(result.eligible.reasons.join(" ")).toMatch(/Couldn't check the posting's requirements/i)
  })

  it("tells a sponsorship-needing user when the posting says nothing about sponsorship", () => {
    const result = qualifyCandidate(
      posting({ description: "Build and ship features with a small team." }),
      profile({ requiresSponsorship: true })
    )

    // Silence is an open question, never a mark against the posting.
    expect(result.eligible.signal).toBe("NEUTRAL")
    expect(result.eligible.reasons.join(" ")).toMatch(/doesn't mention visa sponsorship/i)
    expect(result.verdict).not.toBe("BLOCKED")
  })

  it("never says 'nothing to flag' by leaving a step it could not run silent", () => {
    const result = qualifyCandidate(
      posting({ description: undefined }),
      profile({ workModes: ["REMOTE"], locations: ["Manila, PH"] })
    )

    expect(result.worthIt.reasons.length).toBeGreaterThan(0)
    expect(result.eligible.reasons.length).toBeGreaterThan(0)
  })
})

describe("qualifyCandidate — the verdict cap", () => {
  const CONFIRMED = [
    { name: "React", confirmed: true },
    { name: "TypeScript", confirmed: true },
    { name: "JavaScript", confirmed: true },
  ]

  it("caps a capability-only match at WORTH_A_LOOK when no preference was confirmed", () => {
    const result = qualifyCandidate(
      posting({ description: "React, TypeScript and JavaScript across the stack." }),
      profile({ workModes: ["REMOTE"], locations: ["Manila, PH"], capabilities: CONFIRMED })
    )

    expect(result.match.signal).toBe("GOOD")
    expect(result.verdict).toBe("WORTH_A_LOOK")
    expect(result.nextAction).toMatch(/leaves too much unstated/i)
  })

  it("still reads STRONG once the posting's work mode is confirmed to fit", () => {
    const result = qualifyCandidate(
      posting({
        workType: "REMOTE",
        description: "React, TypeScript and JavaScript across the stack.",
      }),
      profile({ workModes: ["REMOTE"], locations: ["Manila, PH"], capabilities: CONFIRMED })
    )

    expect(result.verdict).toBe("STRONG")
  })

  it("caps a location-bound posting for a user who needs sponsorship and it is not stated", () => {
    const result = qualifyCandidate(
      posting({
        workType: "ONSITE",
        location: "Berlin, Germany",
        description: "React, TypeScript and JavaScript across the stack.",
      }),
      profile({
        workModes: ["ONSITE"],
        locations: ["Berlin"],
        requiresSponsorship: true,
        capabilities: CONFIRMED,
      })
    )

    // Location fit is confirmed here, so the sponsorship cap does not fire.
    expect(result.verdict).toBe("STRONG")

    const elsewhere = qualifyCandidate(
      posting({
        workType: "ONSITE",
        location: "Berlin, Germany",
        description: "React, TypeScript and JavaScript across the stack.",
      }),
      profile({
        workModes: ["ONSITE"],
        locations: ["Manila, PH"],
        openToRelocation: true,
        requiresSponsorship: true,
        capabilities: CONFIRMED,
      })
    )

    expect(elsewhere.verdict).toBe("WORTH_A_LOOK")
  })

  it("does not cap a sponsorship-needing user out of a posting that states sponsorship", () => {
    const result = qualifyCandidate(
      posting({
        workType: "ONSITE",
        location: "Berlin, Germany",
        description:
          "Visa sponsorship is available for the right candidate. React, TypeScript and JavaScript across the stack.",
      }),
      profile({
        workModes: ["ONSITE"],
        locations: ["Manila, PH"],
        openToRelocation: true,
        requiresSponsorship: true,
        capabilities: CONFIRMED,
      })
    )

    // Both halves of the question are answered — the user would move and the
    // posting sponsors — so the restriction is a note, not a concern, and the
    // posting keeps the top band.
    expect(result.verdict).toBe("STRONG")
    expect(result.eligible.signal).toBe("GOOD")
    expect(result.eligible.reasons.join(" ")).toMatch(/sponsorship is available/i)
    expect(result.eligible.reasons.join(" ")).toMatch(
      /Limited to Germany — you're open to relocation and the posting mentions sponsorship\./
    )
  })

  it("drops to WEAK when a distant posting's stated work mode is not one the user asked for", () => {
    const result = qualifyCandidate(
      posting({ workType: "ONSITE", location: "Berlin, Germany" }),
      profile({ workModes: ["REMOTE"], locations: ["Manila, PH"], openToRelocation: true })
    )

    // Relocation does not rescue an onsite role from a remote-only preference.
    expect(result.worthIt.reasons.join(" ")).toMatch(/outside your preferred locations\./)
    expect(result.verdict).toBe("WEAK")
  })
})

describe("qualifyCandidate — market fit", () => {
  const CONFIRMED = [
    { name: "React", confirmed: true },
    { name: "TypeScript", confirmed: true },
    { name: "JavaScript", confirmed: true },
  ]

  /** Rooted in the Philippines: the profile the market check exists for. */
  const ROOTED = {
    workModes: ["REMOTE"] as const,
    locations: ["Cagayan de Oro, PH"],
    openToRelocation: false,
    capabilities: CONFIRMED,
  }

  it("caps a posting limited to another country at WEAK, however well it scores", () => {
    const result = qualifyCandidate(
      posting({
        workType: "REMOTE",
        location: "USA Only",
        description: "React, TypeScript and JavaScript across the stack.",
      }),
      profile({ ...ROOTED, workModes: ["REMOTE"] })
    )

    expect(result.marketFit.fit).toBe("RESTRICTED")
    expect(result.verdict).toBe("WEAK")
    expect(result.eligible.signal).toBe("CONCERN")
    expect(result.eligible.reasons.join(" ")).toMatch(
      /limited to US; your profile location is the Philippines/i
    )
  })

  it("does not cap a user who would relocate, and tells them what it would take", () => {
    const result = qualifyCandidate(
      posting({
        workType: "REMOTE",
        location: "USA Only",
        description: "React, TypeScript and JavaScript across the stack.",
      }),
      profile({ ...ROOTED, workModes: ["REMOTE"], openToRelocation: true })
    )

    // The posting still says what it says — only the cap is lifted.
    expect(result.marketFit.fit).toBe("RESTRICTED")
    expect(result.marketFit.label).toBe("US only")
    expect(result.verdict).not.toBe("WEAK")
    expect(result.eligible.reasons.join(" ")).toMatch(
      /Limited to US — you're open to relocation; check sponsorship\./
    )
  })

  it("keeps the restriction a concern when the posting never mentioned sponsorship", () => {
    const result = qualifyCandidate(
      posting({
        workType: "ONSITE",
        location: "Berlin, Germany",
        description: "React, TypeScript and JavaScript across the stack.",
      }),
      profile({
        workModes: ["ONSITE"],
        locations: ["Manila, PH"],
        openToRelocation: true,
        requiresSponsorship: true,
        capabilities: CONFIRMED,
      })
    )

    expect(result.eligible.signal).toBe("CONCERN")
    expect(result.eligible.reasons.join(" ")).toMatch(
      /Limited to Germany — you're open to relocation; check sponsorship\./
    )
    expect(result.verdict).not.toBe("STRONG")
  })

  it("gives an in-market posting a positive reason and the top band", () => {
    const result = qualifyCandidate(
      posting({
        workType: "REMOTE",
        location: "Metro Manila, Makati City, Philippines",
        description: "React, TypeScript and JavaScript across the stack.",
      }),
      profile({ ...ROOTED, workModes: ["REMOTE"] })
    )

    expect(result.marketFit.fit).toBe("IN_MARKET")
    expect(result.worthIt.reasons.join(" ")).toMatch(/Open to candidates in the Philippines/i)
    expect(result.verdict).toBe("STRONG")
  })

  it("names the region band rather than claiming a location match", () => {
    const result = qualifyCandidate(
      posting({ workType: "REMOTE", location: "Remote - APAC" }),
      profile({ ...ROOTED, workModes: ["REMOTE"] })
    )

    expect(result.marketFit.fit).toBe("REGION")
    expect(result.marketFit.label).toBe("APAC")
    expect(result.worthIt.reasons.join(" ")).toMatch(/covers your region/i)
  })
})

describe("qualifyCandidate — the audited Berlin regression", () => {
  /** The live dev profile, as read from the database on 2026-09-09. */
  const AUDITED_PROFILE = profile({
    targetRoleTitles: ["Full Stack Developer", "Frontend Developer", "Software Engineer"],
    locations: ["Cagayan de Oro, PH", "Manila, PH", "Remote, APAC", "Remote, Europe", "Remote, USA"],
    openToRelocation: true,
    workModes: ["REMOTE"],
    requiresSponsorship: true,
    experienceLevel: "JUNIOR",
    capabilities: [
      { name: "React", confirmed: true },
      { name: "TypeScript", confirmed: true },
      { name: "JavaScript", confirmed: true },
    ],
  })

  /**
   * An Arbeitnow German-language onsite trainee posting: a location, no work
   * mode (the feed only ever flags `remote: true`), and a description whose
   * English tech nouns still match capabilities.
   */
  const BERLIN_TRAINEE = posting({
    title: "Trainee Software Developer (m/w/d)",
    companyName: "Beispiel GmbH",
    url: "https://www.arbeitnow.com/jobs/companies/beispiel/trainee-software-developer",
    location: "Berlin",
    description:
      "Wir suchen dich als Trainee in unserem Team in Berlin. Du arbeitest mit React, TypeScript und JavaScript an unseren Produkten. Sehr gute Deutschkenntnisse sind erforderlich.",
  })

  it("is no longer a Strong fit", () => {
    const result = qualifyCandidate(BERLIN_TRAINEE, AUDITED_PROFILE)

    expect(result.match.signal).toBe("GOOD")
    expect(result.verdict).not.toBe("STRONG")
    expect(result.verdict).toBe("WORTH_A_LOOK")
  })

  it("says what it could not check instead of flagging nothing", () => {
    const result = qualifyCandidate(BERLIN_TRAINEE, AUDITED_PROFILE)

    expect(result.worthIt.reasons.join(" ")).toMatch(/Berlin is outside your preferred locations/i)
    expect(result.worthIt.reasons.join(" ")).toMatch(/Couldn't check work mode/i)
    expect(result.eligible.reasons.join(" ")).toMatch(
      /doesn't mention visa sponsorship|doesn't say it sponsors/i
    )
  })

  it("still does not block it — a false BLOCKED is the expensive mistake", () => {
    const result = qualifyCandidate(BERLIN_TRAINEE, AUDITED_PROFILE)

    expect(result.verdict).not.toBe("BLOCKED")
    expect(result.eligible.signal).not.toBe("BLOCKER")
  })

  it("reads the German title's own level instead of falling back to nothing", () => {
    // "Trainee" is the posting stating its level; the audited profile is JUNIOR,
    // so it is not pitched above the user and nothing is flagged.
    const result = qualifyCandidate(BERLIN_TRAINEE, AUDITED_PROFILE)

    expect(result.worthIt.reasons.join(" ")).not.toMatch(/Looks like a/i)
    expect(
      qualifyCandidate(BERLIN_TRAINEE, { ...AUDITED_PROFILE, experienceLevel: null }).worthIt
        .reasons.join(" ")
    ).not.toMatch(/Looks like a/i)
  })

  /** The same posting, with the eligibility sentences German postings actually use. */
  const BERLIN_ONSITE = posting({
    ...BERLIN_TRAINEE,
    description:
      "Wir suchen dich als Trainee in unserem Team in Berlin. Eine gültige Arbeitserlaubnis für Deutschland ist erforderlich. Die Tätigkeit erfolgt ausschließlich vor Ort, ein Homeoffice bieten wir nicht an. Du arbeitest mit React, TypeScript und JavaScript.",
  })

  it("now flags the German eligibility sentences instead of reading them as silence", () => {
    const result = qualifyCandidate(BERLIN_ONSITE, AUDITED_PROFILE)

    expect(result.requirementFlags).toContain(JOB_REQUIREMENT_FLAGS.WORK_AUTH_REQUIRED)
    expect(result.requirementFlags).toContain(JOB_REQUIREMENT_FLAGS.ONSITE_REQUIRED)
    expect(result.eligible.reasons.join(" ")).toMatch(/work authorization/i)
  })

  it("does not turn those German flags into a BLOCKED verdict", () => {
    const result = qualifyCandidate(BERLIN_ONSITE, AUDITED_PROFILE)

    expect(result.verdict).not.toBe("BLOCKED")
    expect(result.eligible.signal).not.toBe("BLOCKER")
  })
})

describe("qualifyCandidate — German seniority and years of experience", () => {
  it.each([
    ["Teamleiter Softwareentwicklung", "MID" as const, "Lead"],
    ["Leiterin Produktentwicklung", "MID" as const, "Lead"],
    ["Geschäftsführer Technik (m/w/d)", "SENIOR" as const, "Executive"],
  ])("reads %j as a %s-level German title", (title, experienceLevel, label) => {
    const result = qualifyCandidate(posting({ title }), profile({ experienceLevel }))

    expect(result.worthIt.reasons.join(" ")).toMatch(
      new RegExp(`Looks like a ${label}-level role`)
    )
  })

  it.each([
    "Werkstudent Frontend (m/w/d)",
    "Praktikant Softwareentwicklung",
    "Trainee Frontend Developer",
  ])("does not flag the junior German title %j for a mid-level profile", (title) => {
    const result = qualifyCandidate(posting({ title }), profile({ experienceLevel: "MID" }))

    expect(result.worthIt.reasons.join(" ")).not.toMatch(/Looks like a/i)
  })

  it.each([
    "Wir erwarten mindestens 3 Jahre Berufserfahrung im Frontend.",
    "Du bringst 4 Jahren Erfahrung in der Webentwicklung mit.",
    "Mindestens 5 Jahre Berufserfahrung sind erforderlich.",
  ])("falls back to the German years-of-experience bar in %j", (description) => {
    const result = qualifyCandidate(
      posting({ title: "Softwareentwickler", description }),
      profile({ experienceLevel: "JUNIOR" })
    )

    expect(result.worthIt.reasons.join(" ")).toMatch(/Looks like a Mid-level role/)
  })

  it("ignores a German years number that is not about experience", () => {
    const result = qualifyCandidate(
      posting({
        title: "Softwareentwickler",
        description: "Unser Unternehmen ist seit 12 Jahren am Markt und wächst weiter.",
      }),
      profile({ experienceLevel: "JUNIOR" })
    )

    expect(result.worthIt.reasons.join(" ")).not.toMatch(/Looks like a/i)
  })
})

describe("countKeywordMentions", () => {
  it("counts whole-token hits in the title and the description", () => {
    expect(
      countKeywordMentions(
        posting({ title: "React Engineer", description: "You will write TypeScript." }),
        ["React", "TypeScript", "Kubernetes"]
      )
    ).toBe(2)
  })

  it("does not count a keyword that only appears inside a longer word", () => {
    expect(
      countKeywordMentions(posting({ description: "We use Go-lang tooling." }), ["Golang"])
    ).toBe(0)
  })

  it("keeps + # and . inside a keyword", () => {
    expect(
      countKeywordMentions(posting({ description: "C++, C# and Node.js." }), [
        "C++",
        "C#",
        "Node.js",
      ])
    ).toBe(3)
  })

  it("counts a repeated keyword once", () => {
    expect(
      countKeywordMentions(posting({ title: "React Engineer", description: "React, React." }), [
        "React",
      ])
    ).toBe(1)
  })

  it("returns 0 with no keywords or no description", () => {
    expect(countKeywordMentions(posting({ description: "React." }), [])).toBe(0)
    expect(countKeywordMentions(posting(), ["React"])).toBe(0)
  })
})

describe("titleRelevance", () => {
  /** The live dev profile's active target roles, as read on 2026-09-14. */
  const PH_ROLES = [
    "Backend Developer",
    "Frontend Developer",
    "Wordpress Developer",
    "Web Developer",
    "QA Software Engineer",
    "Software Engineer",
    "DevOps Engineer",
    "Full Stack Developer",
  ]

  it.each([
    ["Senior Backend Developer", "backend is a role word"],
    ["WordPress Developer (Remote)", "wordpress is a role word"],
    ["Web Developer │ Australian Client", "web is a role word"],
    ["QA Automation Engineer", "qa is a role word"],
    ["DevOps Engineer - AWS", "devops is a role word"],
    ["Full-Stack Engineer", "the full-stack spellings fold together"],
    ["Fullstack Engineer", "the full-stack spellings fold together"],
    ["Senior Software Engineer, Payments", "the whole target phrase is spelled out"],
  ])("reads %s as a MATCH — %s", (title) => {
    expect(titleRelevance(title, PH_ROLES)).toBe("MATCH")
  })

  it.each([
    ["OMG!! NEEDED NOW!! Data Engineer – PostgreSQL, Python & Warehouse Pipelines"],
    ["Data Engineer"],
    ["Machine Learning Engineer"],
    ["Salesforce Developer"],
    ["Application Developer"],
  ])("reads %s as RELATED — the only shared word is a generic role noun", (title) => {
    expect(titleRelevance(title, PH_ROLES)).toBe("RELATED")
  })

  it("needs a shared role noun, not a shared seniority word", () => {
    expect(titleRelevance("Senior Accountant", ["Senior Frontend Engineer"])).toBe("UNRELATED")
    expect(titleRelevance("Data Engineer", ["Software Engineer"])).toBe("RELATED")
    expect(titleRelevance("Application Developer", ["Web Developer"])).toBe("RELATED")
  })

  it.each([
    ["Bookkeeper │ Australian Client"],
    ["Executive Virtual Assistant"],
    ["Graphic Designer"],
    ["Warehouse Associate"],
    ["Urgently Needed: Remote Sales Closer"],
  ])("reads %s as UNRELATED", (title) => {
    expect(titleRelevance(title, PH_ROLES)).toBe("UNRELATED")
  })

  it("has nothing to say when the profile named no target role", () => {
    expect(titleRelevance("Backend Developer", [])).toBe("UNRELATED")
  })

  it("keeps matchesAnyRoleTitle loose — anything but UNRELATED still counts", () => {
    expect(matchesAnyRoleTitle("Data Engineer", PH_ROLES)).toBe(true)
    expect(matchesAnyRoleTitle("Backend Developer", PH_ROLES)).toBe(true)
    expect(matchesAnyRoleTitle("Bookkeeper │ Australian Client", PH_ROLES)).toBe(false)
  })
})

describe("qualifyCandidate — the audited PH discovery regression (2026-09-14)", () => {
  /** The live dev profile, as read from the database on 2026-09-14. */
  const PH_PROFILE = profile({
    targetRoleTitles: [
      "Backend Developer",
      "Frontend Developer",
      "Wordpress Developer",
      "Web Developer",
      "QA Software Engineer",
      "Software Engineer",
      "DevOps Engineer",
      "Full Stack Developer",
    ],
    locations: ["Cagayan de Oro, Philippines"],
    openToRelocation: true,
    workModes: ["REMOTE"],
    requiresSponsorship: true,
    capabilities: [
      { name: "PostgreSQL", confirmed: true },
      { name: "React", confirmed: true },
      { name: "TypeScript", confirmed: true },
    ],
  })

  /** The OnlineJobs.ph card that ranked second on the audited run. */
  const DATA_ENGINEER = posting({
    title: "OMG!! NEEDED NOW!! Data Engineer – PostgreSQL, Python & Warehouse Pipelines",
    companyName: "Undisclosed",
    location: "Philippines",
    workType: "REMOTE",
    description: "You will build warehouse pipelines. PostgreSQL is used across the stack.",
  })

  it("is no longer a Strong fit — the title is only adjacent", () => {
    const result = qualifyCandidate(DATA_ENGINEER, PH_PROFILE)

    expect(result.verdict).not.toBe("STRONG")
    expect(result.worthIt.reasons.join(" ")).toMatch(/Title is adjacent to your target roles/i)
  })

  it("names the target role the title is adjacent to", () => {
    const result = qualifyCandidate(DATA_ENGINEER, PH_PROFILE)

    expect(result.worthIt.reasons.join(" ")).toMatch(/\(QA Software Engineer\)/)
  })

  it("lets an adjacent title back into Strong once two capabilities are confirmed", () => {
    const twoConfirmed = qualifyCandidate(
      posting({
        title: "Data Engineer",
        location: "Philippines",
        workType: "REMOTE",
        description:
          "You will build pipelines against PostgreSQL and a small React dashboard.",
      }),
      PH_PROFILE
    )
    const oneConfirmed = qualifyCandidate(
      posting({
        title: "Data Engineer",
        location: "Philippines",
        workType: "REMOTE",
        description: "You will build pipelines against PostgreSQL every day.",
      }),
      PH_PROFILE
    )

    expect(twoConfirmed.match.confirmedCount).toBe(2)
    expect(twoConfirmed.verdict).toBe("STRONG")
    expect(oneConfirmed.match.confirmedCount).toBe(1)
    expect(oneConfirmed.verdict).toBe("WORTH_A_LOOK")
  })

  it("demotes the Bookkeeper card the audit found under Worth a look", () => {
    const result = qualifyCandidate(
      posting({
        title: "Bookkeeper │ Australian Client",
        location: "Philippines",
        workType: "REMOTE",
        description: "You will reconcile accounts for an Australian client every month.",
      }),
      PH_PROFILE
    )

    expect(result.worthIt.reasons.join(" ")).toContain("Title doesn't match your target roles.")
    // An unrelated title caps the verdict, whatever else the posting has going
    // for it: it is a bookkeeping job, not an adjacent one.
    expect(result.match.matched).toEqual([])
    expect(result.verdict).toBe("WEAK")
  })

  it("keeps an on-title PH remote posting Strong", () => {
    const result = qualifyCandidate(
      posting({
        title: "Web Developer (WordPress)",
        location: "Philippines",
        workType: "REMOTE",
        description: "You will build WordPress sites. React is a plus.",
      }),
      PH_PROFILE
    )

    expect(result.verdict).toBe("STRONG")
  })
})

describe("qualifyCandidate — sponsorship against market fit", () => {
  const NEEDS_SPONSORSHIP = profile({
    targetRoleTitles: ["Frontend Engineer"],
    locations: ["Cagayan de Oro, Philippines"],
    workModes: ["REMOTE"],
    requiresSponsorship: true,
  })

  const SILENT = "You will ship features with a small product team every week."

  it("says sponsorship is not a factor for a posting open in the user's own country", () => {
    const result = qualifyCandidate(
      posting({ location: "Philippines", workType: "REMOTE", description: SILENT }),
      NEEDS_SPONSORSHIP
    )

    expect(result.eligible.reasons).toContain(
      "Sponsorship isn't a factor — the role is open to candidates in the Philippines."
    )
    expect(result.eligible.signal).toBe("NEUTRAL")
    expect(result.sponsorshipRelevant).toBe(false)
  })

  it("says sponsorship is unlikely to apply on a worldwide remote posting", () => {
    const result = qualifyCandidate(
      posting({ location: "Worldwide", workType: "REMOTE", description: SILENT }),
      NEEDS_SPONSORSHIP
    )

    expect(result.eligible.reasons).toContain(
      "Remote worldwide — sponsorship is unlikely to apply."
    )
    expect(result.sponsorshipRelevant).toBe(false)
  })

  it("asks the user to confirm on a regional remote posting", () => {
    const result = qualifyCandidate(
      posting({ location: "Remote - APAC", workType: "REMOTE", description: SILENT }),
      NEEDS_SPONSORSHIP
    )

    expect(result.eligible.reasons).toContain(
      "Regional remote role — sponsorship is unlikely to apply; confirm if unsure."
    )
    expect(result.sponsorshipRelevant).toBe(false)
  })

  it("keeps the check-before-you-apply note when the posting hires somewhere else", () => {
    const result = qualifyCandidate(
      posting({ location: "United States only", description: SILENT }),
      NEEDS_SPONSORSHIP
    )

    expect(result.eligible.reasons.join(" ")).toMatch(/doesn't mention visa sponsorship/i)
    expect(result.sponsorshipRelevant).toBe(true)
  })

  it("keeps it when the posting never said where it hires", () => {
    const result = qualifyCandidate(posting({ description: SILENT }), NEEDS_SPONSORSHIP)

    expect(result.eligible.reasons.join(" ")).toMatch(/doesn't mention visa sponsorship/i)
    expect(result.sponsorshipRelevant).toBe(true)
  })

  it("keeps it when the posting stated a work-authorization condition, wherever it hires", () => {
    const result = qualifyCandidate(
      posting({
        location: "Philippines",
        workType: "REMOTE",
        description: "You must have valid work authorization to be considered for this role.",
      }),
      NEEDS_SPONSORSHIP
    )

    expect(result.eligible.reasons.join(" ")).toMatch(/doesn't say it sponsors/i)
    expect(result.sponsorshipRelevant).toBe(true)
  })

  it("says nothing at all when the user does not need sponsorship", () => {
    const result = qualifyCandidate(
      posting({ location: "Philippines", workType: "REMOTE", description: SILENT }),
      { ...NEEDS_SPONSORSHIP, requiresSponsorship: false }
    )

    expect(result.eligible.reasons.join(" ")).not.toMatch(/sponsorship/i)
    expect(result.sponsorshipRelevant).toBe(false)
  })
})
