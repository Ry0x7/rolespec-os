import { describe, expect, it } from "vitest"

import { readPostingSignals } from "../signals"
import {
  DEFAULT_OPPORTUNITY_SETTINGS,
  PRESET_WEIGHTS,
  type OpportunityInput,
  type OpportunityPosting,
  type OpportunitySettings,
} from "../types"
import { computeOpportunityValue, payScore } from "../value"
import { expectationFromProfile, settingsFromPreferences } from "../services/opportunity-value.service"

const URL = "https://example.com/jobs/42"

function posting(overrides: Partial<OpportunityPosting> = {}): OpportunityPosting {
  return {
    title: "Senior Platform Engineer",
    companyName: "Example",
    url: URL,
    description: null,
    salary: {
      min: 200000,
      max: 240000,
      currency: "USD",
      period: "YEARLY",
      text: "$200,000 - $240,000 per year",
      verified: true,
    },
    ...overrides,
  }
}

function input(overrides: Partial<OpportunityInput> = {}): OpportunityInput {
  return {
    posting: posting(),
    expectation: { annualMin: 200000, annualMax: 220000, currency: "USD" },
    context: { fitScore: 80, eligibility: "GOOD", confidence: "HIGH", risk: "LOW" },
    settings: { ...DEFAULT_OPPORTUNITY_SETTINGS },
    ...overrides,
  }
}

function settings(overrides: Partial<OpportunitySettings> = {}): OpportunitySettings {
  return { ...DEFAULT_OPPORTUNITY_SETTINGS, ...overrides }
}

function ids(signals: Array<{ id: string }>): string[] {
  return signals.map((signal) => signal.id)
}

describe("pay curve", () => {
  it("is monotonic and anchored", () => {
    expect(payScore(0.5)).toBe(0)
    expect(payScore(0.8)).toBe(45)
    expect(payScore(1)).toBe(85)
    expect(payScore(1.2)).toBe(100)
    expect(payScore(1.15)).toBeGreaterThan(payScore(1))
    expect(payScore(0.9)).toBeGreaterThan(payScore(0.8))
  })
})

describe("compensation", () => {
  it("compares the posting midpoint with the expectation in the same currency", () => {
    const value = computeOpportunityValue(input())
    // (200k + 240k) / 2 = 220k against a (200k + 220k) / 2 = 210k expectation.
    expect(value.compensation.ratio).toBeCloseTo(220000 / 210000, 5)
    expect(value.compensation.score).toBeGreaterThan(85)
    expect(value.compensation.state).toBe("SUPPORTED")
  })

  it("never assumes USD when the posting states no currency", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({
          salary: { min: 200000, max: 240000, currency: null, period: "YEARLY", text: "200,000 - 240,000" },
        }),
      })
    )
    expect(value.compensation.currency).toBeNull()
    expect(value.compensation.score).toBeNull()
    expect(value.compensation.state).toBe("UNKNOWN")
    expect(ids(value.compensation.signals)).toContain("PAY_CURRENCY_UNKNOWN")
  })

  it("refuses to compare across currencies", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({
          salary: { min: 12000000, max: 14000000, currency: "PHP", period: "YEARLY", text: "₱12M-₱14M" },
        }),
      })
    )
    expect(value.compensation.score).toBeNull()
    expect(ids(value.compensation.signals)).toContain("PAY_INCOMPARABLE_CURRENCY")
    expect(value.compensation.reason).toMatch(/different currency|exchange rate/i)
  })

  it("reports a missing salary without failing", () => {
    const value = computeOpportunityValue(input({ posting: posting({ salary: null }) }))
    expect(value.compensation.score).toBeNull()
    expect(ids(value.compensation.signals)).toContain("PAY_MISSING")
    expect(value.rejections.some((rejection) => rejection.code === "UNKNOWN_PAY")).toBe(true)
  })
})

describe("strict minimum pay", () => {
  const belowFloor = settings({
    minimumAnnualPay: "300000",
    minimumPayCurrency: "USD",
  })

  it("blocks a verified below-floor posting only when strict", () => {
    const strict = computeOpportunityValue(input({ settings: { ...belowFloor, minimumPayStrict: true } }))
    expect(strict.rejections).toContainEqual(
      expect.objectContaining({ code: "MINIMUM_PAY", severity: "BLOCK" })
    )
    expect(strict.accepted).toBe(false)
    expect(strict.grade).toBe("BLOCKED")

    const soft = computeOpportunityValue(input({ settings: { ...belowFloor, minimumPayStrict: false } }))
    expect(soft.rejections).toContainEqual(
      expect.objectContaining({ code: "MINIMUM_PAY", severity: "WARN" })
    )
    expect(soft.accepted).toBe(true)
  })

  it("does not apply a floor set in another currency", () => {
    const value = computeOpportunityValue(
      input({ settings: { ...belowFloor, minimumAnnualPay: "9000000", minimumPayCurrency: "PHP" } })
    )
    expect(value.rejections).toContainEqual(
      expect.objectContaining({ code: "MINIMUM_PAY", severity: "WARN", message: expect.stringMatching(/different currency/i) })
    )
    expect(value.accepted).toBe(true)
  })

  it("cannot hard-block a commission-only figure", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({
          description: "Commission-only role. OTE $180,000.",
          salary: { min: 180000, max: 180000, currency: "USD", period: "YEARLY", text: "$180,000 OTE" },
        }),
        settings: { ...belowFloor, minimumPayStrict: true },
      })
    )
    expect(value.compensation.state).toBe("UNCERTAIN")
    expect(value.accepted).toBe(true)
  })
})

describe("unknown-pay policy", () => {
  const noPay = posting({ salary: null })

  it("ALLOW keeps it with no rejection", () => {
    const value = computeOpportunityValue(input({ posting: noPay, settings: settings({ unknownPay: "ALLOW" }) }))
    expect(value.rejections.some((rejection) => rejection.code === "UNKNOWN_PAY")).toBe(false)
    expect(value.accepted).toBe(true)
  })

  it("FLAG warns but keeps it", () => {
    const value = computeOpportunityValue(input({ posting: noPay, settings: settings({ unknownPay: "FLAG" }) }))
    expect(value.rejections).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_PAY", severity: "WARN" })
    )
    expect(value.accepted).toBe(true)
  })

  it("REJECT removes it", () => {
    const value = computeOpportunityValue(input({ posting: noPay, settings: settings({ unknownPay: "REJECT" }) }))
    expect(value.rejections).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_PAY", severity: "BLOCK" })
    )
    expect(value.accepted).toBe(false)
  })
})

describe("effective hourly pay", () => {
  it("is unknown when the posting states no hours — 40 is never assumed", () => {
    const value = computeOpportunityValue(input())
    expect(value.hourly.hoursPerWeek).toBeNull()
    expect(value.hourly.effectiveHourly).toBeNull()
    expect(value.hourly.score).toBeNull()
    expect(value.hourly.state).toBe("UNKNOWN")
    expect(value.hourly.reason).toMatch(/does not state working hours/i)
  })

  it("uses the stated hours and quotes the sentence", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({
          description: "This is a 32 hours per week role with a flexible schedule.",
        }),
      })
    )
    expect(value.hourly.hoursPerWeek).toBe(32)
    // 220,000 midpoint / (32 × 52) = 132.21/hour
    expect(value.hourly.effectiveHourly?.toFixed(2)).toBe("132.21")
    expect(value.hourly.evidence?.excerpt).toContain("32 hours per week")
    expect(value.hourly.evidence?.sourceUrl).toBe(URL)
    expect(value.hourly.score).not.toBeNull()
  })

  it("annualizes hourly pay on the posting's stated hours, not a 40-hour week", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({
          salary: {
            min: 50,
            max: 60,
            currency: "USD",
            period: "HOURLY",
            text: "$50 - $60 per hour",
          },
          description: "This is a 20 hours per week role.",
        }),
        expectation: { annualMin: 100000, annualMax: 120000, currency: "USD" },
      })
    )
    // $55/hour × 20 × 52 = $57,200/year, so the effective rate stays $55.
    expect(value.compensation.annualMidpoint?.toFixed(2)).toBe("57200.00")
    expect(value.hourly.effectiveHourly?.toFixed(2)).toBe("55.00")
  })

  it("lowers effective hourly pay when the same salary takes more hours", () => {
    const short = computeOpportunityValue(
      input({ posting: posting({ description: "35 hours per week." }) })
    )
    const long = computeOpportunityValue(
      input({ posting: posting({ description: "50 hours per week." }) })
    )
    expect(long.hourly.effectiveHourly!.lt(short.hourly.effectiveHourly!)).toBe(true)
  })
})

describe("contract work", () => {
  it("annualizes a stated contract total with its term", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({
          salary: {
            min: 120000,
            max: 120000,
            currency: "USD",
            period: "CONTRACT",
            termMonths: 6,
            text: "$120,000 total for a 6-month contract",
          },
        }),
      })
    )
    expect(value.compensation.annualMidpoint?.toFixed(0)).toBe("240000")
    expect(value.compensation.score).not.toBeNull()
  })

  it("refuses a contract total with no term, and says why", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({
          salary: { min: 120000, max: 120000, currency: "USD", period: "CONTRACT", text: "$120,000 contract" },
        }),
      })
    )
    expect(value.compensation.annualMidpoint).toBeNull()
    expect(value.compensation.score).toBeNull()
    expect(value.rejections).toContainEqual(
      expect.objectContaining({ code: "CONTRACT_TERM", severity: "WARN" })
    )
  })

  it("reads contract language in prose without inventing a term", () => {
    const signals = readPostingSignals({
      title: "Data Engineer",
      description: "This is a fixed-term contract position for a maternity cover.",
      url: URL,
    })
    expect(signals.contractLanguage).toBe(true)
  })
})

describe("commission-only compensation", () => {
  it("treats OTE as unverified rather than guaranteed", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({
          description: "100% commission. Uncapped commission with an OTE of $180,000.",
          salary: { min: 180000, max: 180000, currency: "USD", period: "YEARLY", text: "OTE $180,000" },
        }),
      })
    )
    expect(value.compensation.state).toBe("UNCERTAIN")
    expect(value.compensation.score).toBeLessThanOrEqual(60)
    expect(value.rejections).toContainEqual(
      expect.objectContaining({ code: "COMMISSION_ONLY", severity: "WARN" })
    )
  })

  it("does not claim commission-only when a base salary is stated too", () => {
    const signals = readPostingSignals({
      title: "Account Executive",
      description: "Commission-only? No. A base salary of $90,000 plus commission.",
      url: URL,
    })
    expect(signals.commissionOnly).toBe(false)
    expect(signals.variableComponent).toBe(true)
  })
})

describe("contradictory descriptions", () => {
  it("reports both sides of an overtime contradiction instead of choosing one", () => {
    const description =
      "There is no overtime in this role. Overtime is required during quarterly close."
    const value = computeOpportunityValue(input({ posting: posting({ description }) }))
    const overtime = value.workload.indicators.find((signal) => signal.id === "OVERTIME")
    expect(overtime?.state).toBe("UNCERTAIN")
    expect(value.contradictions.some((entry) => entry.id === "OVERTIME")).toBe(true)
    const entry = value.contradictions.find((item) => item.id === "OVERTIME")!
    // The burden and its denial are both kept, in posting order.
    expect(entry.excerpts[0]).toContain("required")
    expect(entry.excerpts[1]).toContain("no overtime")
  })

  it("does not score 'no travel' as travel", () => {
    const value = computeOpportunityValue(
      input({ posting: posting({ description: "No travel is required for this role." }) })
    )
    const travel = value.workload.indicators.find((signal) => signal.id === "TRAVEL")
    expect(travel?.state).toBe("UNKNOWN")
    expect(travel?.reason).toMatch(/no travel/i)
  })

  it("flags travel that contradicts a no-travel sentence", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({ description: "No travel. Expect 50% travel to customer sites." }),
      })
    )
    const travel = value.workload.indicators.find((signal) => signal.id === "TRAVEL")
    expect(travel?.state).toBe("UNCERTAIN")
  })
})

describe("uncertain claims", () => {
  it("reads 'may include on-call' as uncertain, with the quote", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({ description: "You may include on-call in the rotation after six months." }),
      })
    )
    const onCall = value.workload.indicators.find((signal) => signal.id === "ON_CALL")
    expect(onCall?.state).toBe("UNCERTAIN")
    expect(onCall?.evidence?.excerpt).toContain("may include on-call")
  })

  it("penalizes a supported burden more than an uncertain one", () => {
    const supported = computeOpportunityValue(
      input({ posting: posting({ description: "On-call rotation is required every third week." }) })
    )
    const uncertain = computeOpportunityValue(
      input({ posting: posting({ description: "On-call may be part of the rotation." }) })
    )
    expect(supported.workload.score!).toBeLessThan(uncertain.workload.score!)
  })

  it("never invents workload from the job title alone", () => {
    const value = computeOpportunityValue(
      input({ posting: posting({ title: "Senior Site Reliability Engineer / DevOps / Platform", description: "" }) })
    )
    const onCall = value.workload.indicators.find((signal) => signal.id === "ON_CALL")
    expect(onCall?.state).toBe("UNKNOWN")
    expect(value.workload.indicators.find((signal) => signal.id === "ROLE_BREADTH")?.state).toBe(
      "SUPPORTED"
    )
  })
})

describe("workload indicators", () => {
  it("penalizes shifts, quotas, travel and rigidity, and credits flexibility", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({
          description:
            "Night shifts on a rotating pattern. You will carry a sales quota. Expect 25% travel. Fixed schedule in core hours. No flexible hours.",
        }),
      })
    )
    const byId = Object.fromEntries(value.workload.indicators.map((signal) => [signal.id, signal.state]))
    expect(byId.SHIFTS).toBe("SUPPORTED")
    expect(byId.QUOTAS).toBe("SUPPORTED")
    expect(byId.TRAVEL).toBe("SUPPORTED")
    expect(value.workload.score).toBeLessThan(60)
  })

  it("honours the lighter-workload preference by penalizing harder", () => {
    const description = "On-call rotation and occasional overtime."
    const balanced = computeOpportunityValue(input({ posting: posting({ description }) }))
    const lighter = computeOpportunityValue(
      input({ posting: posting({ description }), settings: settings({ workloadPreference: "LIGHTER" }) })
    )
    expect(lighter.workload.score!).toBeLessThanOrEqual(balanced.workload.score!)
  })
})

describe("application friction", () => {
  it("counts assessments, stages and documents, with evidence", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({
          description:
            "The process has 4 stages. You will complete a take-home assessment. Please submit a cover letter and a portfolio.",
        }),
      })
    )
    expect(value.friction.interviewStages).toBe(4)
    expect(value.friction.indicators.find((signal) => signal.id === "ASSESSMENT")?.state).toBe(
      "SUPPORTED"
    )
    expect(
      value.friction.indicators.find((signal) => signal.id === "REQUIRED_DOCUMENTS")?.state
    ).toBe("SUPPORTED")
    expect(value.friction.score!).toBeLessThan(70)
  })

  it("marks a take-home as uncertain when it does not say whether it is paid", () => {
    const value = computeOpportunityValue(
      input({ posting: posting({ description: "Expect a take-home exercise before the team interview." }) })
    )
    expect(value.friction.indicators.find((signal) => signal.id === "UNPAID_TASK")?.state).toBe(
      "UNCERTAIN"
    )
  })

  it("marks an explicit unpaid task as supported", () => {
    const value = computeOpportunityValue(
      input({ posting: posting({ description: "You will complete an unpaid trial project." }) })
    )
    expect(value.friction.indicators.find((signal) => signal.id === "UNPAID_TASK")?.state).toBe(
      "SUPPORTED"
    )
  })
})

describe("eligibility and offshore restrictions", () => {
  it("surfaces a location restriction as a warning with its quote", () => {
    const value = computeOpportunityValue(
      input({
        posting: posting({
          description:
            "We only consider candidates based in the Philippines for this remote role.",
        }),
      })
    )
    const rejection = value.rejections.find((item) => item.code === "LOCATION_RESTRICTION")
    expect(rejection?.severity).toBe("WARN")
    expect(rejection?.message).toMatch(/restricts where/i)
  })

  it("blocks when the qualification says the user is ineligible", () => {
    const value = computeOpportunityValue(
      input({ context: { fitScore: 80, eligibility: "BLOCKER", confidence: "HIGH", risk: "LOW" } })
    )
    expect(value.accepted).toBe(false)
    expect(value.grade).toBe("BLOCKED")
    expect(value.rejections).toContainEqual(
      expect.objectContaining({ code: "ELIGIBILITY", severity: "BLOCK" })
    )
  })

  it("reads a sponsorship refusal as an existing-authorization requirement", () => {
    const signals = readPostingSignals({
      title: "Backend Engineer",
      description: "No visa sponsorship is available for this position.",
      url: URL,
    })
    expect(signals.eligibility.find((signal) => signal.id === "WORK_AUTHORIZATION")?.state).toBe(
      "SUPPORTED"
    )
  })
})

describe("composite", () => {
  it("is deterministic", () => {
    const a = computeOpportunityValue(input())
    const b = computeOpportunityValue(input())
    expect(a).toEqual(b)
  })

  it("reports coverage instead of silently scoring unknowns", () => {
    const full = computeOpportunityValue(input())
    const sparse = computeOpportunityValue(
      input({
        posting: posting({ description: null, salary: null }),
        context: { fitScore: null, eligibility: null, confidence: null, risk: null },
      })
    )
    expect(full.coverage).toBeGreaterThan(sparse.coverage)
    expect(sparse.coverage).toBe(0)
    expect(sparse.explanation.join(" ")).toMatch(/not scored/i)
  })

  it("lets the pay-over-load preset reward pay and light workload over fit", () => {
    const lightHighPay = {
      posting: posting({
        description: "Flexible hours and no on-call. The team runs a calm, predictable week.",
        salary: { min: 400000, max: 440000, currency: "USD", period: "YEARLY", text: "$400k-$440k" },
      }),
      context: { fitScore: 40, eligibility: "GOOD" as const, confidence: "HIGH" as const, risk: "LOW" as const },
    }
    const balanced = computeOpportunityValue(input({ ...lightHighPay, settings: settings({ preset: "BALANCED" }) }))
    const payOverLoad = computeOpportunityValue(
      input({ ...lightHighPay, settings: settings({ preset: "PAY_OVER_LOAD" }) })
    )
    expect(payOverLoad.preset).toBe("PAY_OVER_LOAD")
    expect(payOverLoad.score).toBeGreaterThan(balanced.score)
  })

  it("does not reward a heavy high-pay role under the load-sensitive preset", () => {
    const heavyHighPay = {
      posting: posting({
        description: "On-call rotation, required overtime, 50% travel, rotating night shifts.",
        salary: { min: 400000, max: 440000, currency: "USD", period: "YEARLY", text: "$400k-$440k" },
      }),
    }
    const balanced = computeOpportunityValue(input({ ...heavyHighPay, settings: settings({ preset: "BALANCED" }) }))
    const payOverLoad = computeOpportunityValue(
      input({ ...heavyHighPay, settings: settings({ preset: "PAY_OVER_LOAD" }) })
    )
    expect(payOverLoad.score).toBeLessThanOrEqual(balanced.score)
  })

  it("honours explicit weights, including zero", () => {
    const value = computeOpportunityValue(
      input({
        settings: settings({
          weights: { ...PRESET_WEIGHTS.BALANCED, workload: 0, fit: 100 },
        }),
      })
    )
    expect(value.dimensions.find((dimension) => dimension.id === "WORKLOAD")?.weight).toBe(0)
    expect(value.score).toBeGreaterThan(60)
  })

  it("preserves the posting URL on every quote", () => {
    const value = computeOpportunityValue(
      input({ posting: posting({ description: "Night shifts required. On-call rotation." }) })
    )
    const quotes = value.workload.indicators
      .map((signal) => signal.evidence)
      .filter((evidence): evidence is NonNullable<typeof evidence> => Boolean(evidence))
    expect(quotes.length).toBeGreaterThan(0)
    for (const quote of quotes) expect(quote.sourceUrl).toBe(URL)
  })
})

describe("adapters", () => {
  it("reads the expectation from the stored profile without converting it", () => {
    const expectation = expectationFromProfile({
      salaryMin: "80000",
      salaryMax: "100000",
      salaryCurrency: "PHP",
      salaryPeriod: "MONTHLY",
    })
    expect(expectation.currency).toBe("PHP")
    expect(String(expectation.annualMin)).toBe("960000")
    expect(String(expectation.annualMax)).toBe("1200000")
  })

  it("has no expectation when the profile states no salary", () => {
    expect(expectationFromProfile(null)).toEqual({ annualMin: null, annualMax: null, currency: null })
  })

  it("completes missing stored settings with defaults", () => {
    expect(settingsFromPreferences(null)).toEqual(DEFAULT_OPPORTUNITY_SETTINGS)
  })
})
