import { describe, it, expect } from "vitest"

import {
  CONFIDENCE_RANK,
  assessOpportunityConfidence,
  type ConfidenceSignal,
  type OpportunityConfidenceInput,
} from "../opportunity-confidence.service"

const NOW = new Date("2026-09-13T12:00:00.000Z")

/** ISO string for a date `days` before `NOW`. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

function assess(input: Partial<OpportunityConfidenceInput> = {}) {
  return assessOpportunityConfidence({ now: NOW, ...input })
}

function signal(
  result: { signals: ConfidenceSignal[] },
  key: ConfidenceSignal["key"],
): ConfidenceSignal | undefined {
  return result.signals.find((entry) => entry.key === key)
}

describe("assessOpportunityConfidence — provenance", () => {
  it.each(["greenhouse", "lever", "ashby"])(
    "credits %s as an official ATS board",
    (provider) => {
      expect(signal(assess({ provider }), "provenance")).toEqual({
        key: "provenance",
        label: "Official ATS board",
        tone: "positive",
      })
    },
  )

  it("credits an ATS host even when no provider was recorded", () => {
    const result = assess({ url: "https://boards.greenhouse.io/acme/jobs/123" })

    expect(signal(result, "provenance")?.label).toBe("Official ATS board")
  })

  it("treats an unrecognized host as a company site or direct link", () => {
    const result = assess({ url: "https://careers.acme.com/roles/42", source: "EXTENSION" })

    expect(signal(result, "provenance")).toEqual({
      key: "provenance",
      label: "Company site or direct link",
      tone: "positive",
    })
  })

  it.each([
    "https://remotive.com/remote-jobs/1",
    "https://www.linkedin.com/jobs/view/1",
    "https://ph.indeed.com/viewjob?jk=1",
    "https://www.kalibrr.com/c/acme/jobs/1/dev",
    "https://www.onlinejobs.ph/jobseekers/job/1",
    "https://bossjob.ph/jobs/1",
  ])("treats %s as a job board listing", (url) => {
    const result = assess({ url })

    expect(signal(result, "provenance")).toEqual({
      key: "provenance",
      label: "Job board listing",
      tone: "neutral",
    })
  })

  it("strips www. before classifying the host", () => {
    expect(signal(assess({ url: "https://www.remotive.com/x" }), "provenance")?.label).toBe(
      "Job board listing",
    )
  })

  it("matches subdomains of an aggregator", () => {
    expect(signal(assess({ url: "https://jobs.jora.com/x" }), "provenance")?.label).toBe(
      "Job board listing",
    )
  })

  it("does not treat a lookalike host as an aggregator", () => {
    expect(signal(assess({ url: "https://notlinkedin.com/x" }), "provenance")?.label).toBe(
      "Company site or direct link",
    )
  })

  it("falls back to a job board listing for an unlabelled provider with no URL", () => {
    expect(signal(assess({ provider: "remotive" }), "provenance")?.label).toBe(
      "Job board listing",
    )
  })

  it("reports an unusable URL with no provider as an unknown source", () => {
    expect(signal(assess({ url: "not a url" }), "provenance")).toEqual({
      key: "provenance",
      label: "Source unknown",
      tone: "unknown",
    })
  })

  it("reports no URL and no provider as an unknown source", () => {
    expect(signal(assess({}), "provenance")?.tone).toBe("unknown")
  })
})

describe("assessOpportunityConfidence — freshness", () => {
  it("calls a posting from today fresh", () => {
    const result = assess({ postedAt: daysAgo(0) })

    expect(signal(result, "freshness")).toEqual({
      key: "freshness",
      label: "Posted today",
      tone: "positive",
    })
  })

  it("says '1 day ago' rather than '1 days ago'", () => {
    expect(signal(assess({ postedAt: daysAgo(1) }), "freshness")?.label).toBe(
      "Posted 1 day ago",
    )
  })

  it.each([5, 14])("scores a posting %s days old as fresh", (days) => {
    const result = assess({ postedAt: daysAgo(days), companyName: "Acme" })

    expect(signal(result, "freshness")).toEqual({
      key: "freshness",
      label: `Posted ${days} days ago`,
      tone: "positive",
    })
    // fresh 2 + employer 1 = 3, with no provenance credit from a bare date.
    expect(result.score).toBe(3)
  })

  it.each([15, 45])("scores a posting %s days old as recent", (days) => {
    const result = assess({ postedAt: daysAgo(days), companyName: "Acme" })

    expect(signal(result, "freshness")?.tone).toBe("positive")
    expect(result.score).toBe(2)
  })

  it.each([46, 90])("scores a posting %s days old as aging and neutral", (days) => {
    const result = assess({ postedAt: daysAgo(days), companyName: "Acme" })

    expect(signal(result, "freshness")).toEqual({
      key: "freshness",
      label: `Posted ${days} days ago`,
      tone: "neutral",
    })
    expect(result.score).toBe(1)
  })

  it("penalises a posting over three months old", () => {
    const result = assess({ postedAt: daysAgo(91), companyName: "Acme" })

    expect(signal(result, "freshness")).toEqual({
      key: "freshness",
      label: "Posted over 3 months ago",
      tone: "negative",
    })
    expect(result.score).toBe(-1)
  })

  it("falls back to discoveredAt, says the posting date is unknown, and caps the credit", () => {
    const result = assess({ discoveredAt: daysAgo(3) })

    expect(signal(result, "freshness")).toEqual({
      key: "freshness",
      label: "Seen 3 days ago · posting date unknown",
      tone: "neutral",
    })
    // Capped at +1 where a real posted date 3 days old would have earned +2.
    expect(result.score).toBe(1 - 1)
  })

  it("caps a fallback date in the 46-90 band at zero", () => {
    const result = assess({ discoveredAt: daysAgo(60), companyName: "Acme" })

    expect(signal(result, "freshness")?.label).toBe("Seen 60 days ago · posting date unknown")
    expect(result.score).toBe(1)
  })

  it("falls back to createdAt when there is no posted or discovered date", () => {
    const result = assess({ createdAt: daysAgo(200), companyName: "Acme" })

    expect(signal(result, "freshness")).toEqual({
      key: "freshness",
      label: "Not seen in over 3 months · posting date unknown",
      tone: "negative",
    })
    // Half the penalty a real stale posted date would carry.
    expect(result.score).toBe(0)
  })

  it("only lets a real posted date earn the full credit or the full penalty", () => {
    expect(assess({ postedAt: daysAgo(3), companyName: "Acme" }).score).toBe(3)
    expect(assess({ discoveredAt: daysAgo(3), companyName: "Acme" }).score).toBe(2)
    expect(assess({ postedAt: daysAgo(200), companyName: "Acme" }).score).toBe(-1)
    expect(assess({ createdAt: daysAgo(200), companyName: "Acme" }).score).toBe(0)
  })

  it("prefers postedAt over the fallbacks", () => {
    const result = assess({ postedAt: daysAgo(2), discoveredAt: daysAgo(40), createdAt: daysAgo(90) })

    expect(signal(result, "freshness")?.label).toBe("Posted 2 days ago")
  })

  it("prefers discoveredAt over createdAt when neither is a posted date", () => {
    const result = assess({ discoveredAt: daysAgo(5), createdAt: daysAgo(50) })

    expect(signal(result, "freshness")?.label).toBe("Seen 5 days ago · posting date unknown")
  })

  it("accepts a Date as readily as an ISO string", () => {
    const fromString = assess({ postedAt: daysAgo(7) })
    const fromDate = assess({ postedAt: new Date(daysAgo(7)) })

    expect(fromDate.signals).toEqual(fromString.signals)
  })

  it("ignores an unparseable date and reports the date as unknown", () => {
    expect(signal(assess({ postedAt: "never" }), "freshness")).toEqual({
      key: "freshness",
      label: "Posting date unknown",
      tone: "unknown",
    })
  })

  it("clamps a future posted date to today rather than reporting negative days", () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString()

    expect(signal(assess({ postedAt: future }), "freshness")?.label).toBe("Posted today")
  })

  it("caps a board listing of unknown age at MEDIUM, however good the rest is", () => {
    // The bossjob-style case: no posted date, an aggregator host, a named
    // employer and a long description. Score alone would say HIGH.
    const result = assess({
      url: "https://bossjob.ph/jobs/1",
      source: "EXTENSION",
      createdAt: daysAgo(3),
      companyName: "Four13 Digital",
      descriptionLength: 4_000,
    })

    expect(result.score).toBe(3)
    expect(result.level).toBe("MEDIUM")
  })

  it("caps an unknown source of unknown age at MEDIUM too", () => {
    const result = assess({
      createdAt: daysAgo(1),
      companyName: "Acme",
      descriptionLength: 4_000,
      // Provenance unknown, freshness inferred: 0 + 1 + 1 + 1 = 3 either way,
      // but the cap has to hold if the bands ever move.
    })

    expect(result.level).toBe("MEDIUM")
  })

  it("does not cap a company-site link of unknown age", () => {
    const result = assess({
      url: "https://careers.acme.com/jobs/1",
      createdAt: daysAgo(2),
      companyName: "Acme",
      descriptionLength: 4_000,
    })

    expect(result.score).toBe(4)
    expect(result.level).toBe("HIGH")
  })

  it("does not cap a board listing that carries a real posted date", () => {
    const result = assess({
      url: "https://remotive.com/remote-jobs/1",
      postedAt: daysAgo(2),
      companyName: "Acme",
      descriptionLength: 4_000,
    })

    expect(result.level).toBe("HIGH")
  })

  it("moves with the injected now", () => {
    const posted = "2026-09-01T12:00:00.000Z"

    expect(
      signal(
        assessOpportunityConfidence({ postedAt: posted, now: new Date("2026-09-03T12:00:00.000Z") }),
        "freshness",
      )?.label,
    ).toBe("Posted 2 days ago")
    expect(
      signal(
        assessOpportunityConfidence({ postedAt: posted, now: new Date("2026-12-25T12:00:00.000Z") }),
        "freshness",
      )?.label,
    ).toBe("Posted over 3 months ago")
    expect(
      signal(
        assessOpportunityConfidence({
          discoveredAt: posted,
          now: new Date("2026-12-25T12:00:00.000Z"),
        }),
        "freshness",
      )?.label,
    ).toBe("Not seen in over 3 months · posting date unknown")
  })
})

describe("assessOpportunityConfidence — employer", () => {
  it("credits a named employer", () => {
    expect(signal(assess({ companyName: "Acme Corp" }), "employer")).toEqual({
      key: "employer",
      label: "Named employer",
      tone: "positive",
    })
  })

  it.each([
    "Undisclosed",
    "Confidential Company",
    "Private Employer",
    "hiring company",
  ])("penalises %s as an undisclosed employer", (companyName) => {
    expect(signal(assess({ companyName }), "employer")).toEqual({
      key: "employer",
      label: "Employer undisclosed",
      tone: "negative",
    })
  })

  it.each([null, undefined, "", "   "])("penalises an empty employer (%s)", (companyName) => {
    expect(signal(assess({ companyName }), "employer")?.label).toBe("Employer undisclosed")
  })
})

describe("assessOpportunityConfidence — completeness", () => {
  it("credits a detailed posting at 600 characters", () => {
    expect(signal(assess({ descriptionLength: 600 }), "completeness")).toEqual({
      key: "completeness",
      label: "Detailed posting",
      tone: "positive",
    })
  })

  it.each([200, 599])("calls %s characters a brief posting", (descriptionLength) => {
    expect(signal(assess({ descriptionLength }), "completeness")).toEqual({
      key: "completeness",
      label: "Brief posting",
      tone: "neutral",
    })
  })

  it.each([1, 199])("penalises %s characters as a very short posting", (descriptionLength) => {
    expect(signal(assess({ descriptionLength }), "completeness")).toEqual({
      key: "completeness",
      label: "Very short posting",
      tone: "negative",
    })
  })

  it("reports an empty body as no posting text", () => {
    expect(signal(assess({ description: "" }), "completeness")).toEqual({
      key: "completeness",
      label: "No posting text",
      tone: "negative",
    })
  })

  it("measures the description when no explicit length is given", () => {
    expect(signal(assess({ description: "x".repeat(700) }), "completeness")?.label).toBe(
      "Detailed posting",
    )
  })

  it("prefers descriptionLength over the description itself", () => {
    expect(
      signal(assess({ description: "short", descriptionLength: 900 }), "completeness")?.label,
    ).toBe("Detailed posting")
  })

  it("omits the signal entirely when the caller loaded no body", () => {
    const result = assess({ provider: "greenhouse", postedAt: daysAgo(1), companyName: "Acme" })

    expect(signal(result, "completeness")).toBeUndefined()
    expect(result.signals).toHaveLength(3)
  })
})

describe("assessOpportunityConfidence — level", () => {
  it("is UNKNOWN when both provenance and freshness are unknown", () => {
    const result = assess({ companyName: "Acme", descriptionLength: 5_000 })

    expect(result.level).toBe("UNKNOWN")
    // The score would otherwise have cleared MEDIUM.
    expect(result.score).toBe(2)
  })

  it("is not UNKNOWN when only one of the two is unknown", () => {
    expect(assess({ postedAt: daysAgo(1), companyName: "Acme" }).level).toBe("MEDIUM")
    expect(assess({ url: "https://remotive.com/x", companyName: "Acme" }).level).toBe("LOW")
  })

  it("is HIGH at a score of 4", () => {
    const result = assess({
      provider: "greenhouse",
      postedAt: daysAgo(3),
      companyName: "Acme",
      descriptionLength: 100,
    })

    expect(result.score).toBe(4)
    expect(result.level).toBe("HIGH")
  })

  it("is MEDIUM at a score of 3", () => {
    const result = assess({
      provider: "greenhouse",
      postedAt: daysAgo(3),
      companyName: "Undisclosed",
      descriptionLength: 300,
    })

    expect(result.score).toBe(3)
    expect(result.level).toBe("MEDIUM")
  })

  it("is MEDIUM at a score of 2 and LOW at 1", () => {
    const medium = assess({ url: "https://careers.acme.com/x", companyName: "Acme", postedAt: daysAgo(60) })
    expect(medium.score).toBe(2)
    expect(medium.level).toBe("MEDIUM")

    const low = assess({ url: "https://remotive.com/x", companyName: "Acme", postedAt: daysAgo(60) })
    expect(low.score).toBe(1)
    expect(low.level).toBe("LOW")
  })

  it("is LOW for a stale undisclosed job-board listing", () => {
    const result = assess({
      provider: "onlinejobsph",
      url: "https://www.onlinejobs.ph/jobseekers/job/1",
      postedAt: daysAgo(200),
      companyName: "Undisclosed",
      descriptionLength: 50,
    })

    expect(result.score).toBe(-4)
    expect(result.level).toBe("LOW")
  })
})

describe("assessOpportunityConfidence — summary", () => {
  it("reads as one sentence built from the signal labels", () => {
    const result = assess({
      provider: "greenhouse",
      postedAt: daysAgo(5),
      companyName: "Acme",
      descriptionLength: 1_200,
    })

    expect(result.summary).toBe(
      "Official ATS board, posted 5 days ago, named employer, detailed posting.",
    )
  })

  it("says what is unknown rather than staying silent", () => {
    expect(assess({}).summary).toBe("Source unknown, posting date unknown, employer undisclosed.")
  })
})

describe("CONFIDENCE_RANK", () => {
  it("sorts HIGH first and LOW below UNKNOWN", () => {
    const order = (["LOW", "UNKNOWN", "HIGH", "MEDIUM"] as const)
      .slice()
      .sort((a, b) => CONFIDENCE_RANK[a] - CONFIDENCE_RANK[b])

    expect(order).toEqual(["HIGH", "MEDIUM", "UNKNOWN", "LOW"])
  })
})
