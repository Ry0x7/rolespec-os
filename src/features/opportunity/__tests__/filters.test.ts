import { describe, expect, it } from "vitest"

import type { FilterableOpportunity, OpportunityFilterCriteria } from "../filters"
import {
  DEFAULT_CRITERIA,
  QUICK_PRESETS,
  criteriaForPreset,
  evaluateCriteria,
  groupOpportunities,
  hasActiveCriteria,
  parseFilterParams,
  presetForCriteria,
  sortOpportunities,
  writeFilterParams,
} from "../filters"

function item(overrides: Partial<FilterableOpportunity> = {}): FilterableOpportunity {
  return {
    id: "job-1",
    salary: { min: "50000", max: "60000", currency: "PHP", period: "MONTHLY", termMonths: null },
    workType: "REMOTE",
    location: "Manila, Philippines",
    experience: "MID",
    risk: "LOW",
    ageDays: 3,
    value: {
      score: 72,
      grade: "DECENT",
      coverage: 0.8,
      accepted: true,
      rejections: [],
      workload: { score: 70, indicators: [{ id: "ON_CALL" }] },
      friction: { score: 80 },
    },
    ...overrides,
  }
}

function criteria(overrides: Partial<OpportunityFilterCriteria> = {}): OpportunityFilterCriteria {
  return { ...DEFAULT_CRITERIA, ...overrides }
}

describe("presets", () => {
  it("gives every preset a distinct, working configuration", () => {
    const seen = new Set<string>()
    for (const preset of QUICK_PRESETS) {
      const built = criteriaForPreset(preset.id)
      // Best overall *is* the default view; the others must actually narrow it.
      if (preset.id === "BEST_OVERALL") expect(hasActiveCriteria(built)).toBe(false)
      else expect(hasActiveCriteria(built)).toBe(true)
      seen.add(JSON.stringify(built))
    }
    expect(seen.size).toBe(QUICK_PRESETS.length)
  })

  it("round-trips a preset through the criteria it produces", () => {
    for (const preset of QUICK_PRESETS) {
      expect(presetForCriteria(criteriaForPreset(preset.id))).toBe(preset.id)
    }
  })

  it("reports CUSTOM once the user narrows a preset", () => {
    const narrowed = { ...criteriaForPreset("HIGH_PAY"), minPay: "900000" }
    expect(presetForCriteria(narrowed)).toBe("CUSTOM")
  })

  it("treats the default criteria as Best overall and inactive", () => {
    expect(presetForCriteria(DEFAULT_CRITERIA)).toBe("BEST_OVERALL")
    expect(hasActiveCriteria(DEFAULT_CRITERIA)).toBe(false)
  })
})

describe("known pay", () => {
  it("puts a posting without stated pay in unknown, never in eligible", () => {
    const noPay = item({ salary: { min: null, max: null, currency: null, period: null } })
    const grouped = groupOpportunities([noPay], criteriaForPreset("HIGH_PAY"))

    expect(grouped.eligible).toHaveLength(0)
    expect(grouped.unknown).toHaveLength(1)
    expect(grouped.excluded).toHaveLength(0)
  })

  it("keeps a payless posting eligible under Best overall", () => {
    const noPay = item({ salary: { min: null, max: null, currency: null, period: null } })
    expect(groupOpportunities([noPay], DEFAULT_CRITERIA).eligible).toHaveLength(1)
  })
})

describe("minimum pay", () => {
  const floor = { minPay: "600000", currency: "PHP" as const }

  it("excludes a posting whose stated range is below the floor, with a reason", () => {
    // 50,000 PHP/month = 600,000/year — exactly on the floor.
    const below = item({
      salary: { min: "30000", max: "40000", currency: "PHP", period: "MONTHLY" },
    })
    const grouped = groupOpportunities([below], criteria(floor))

    expect(grouped.excluded).toHaveLength(1)
    expect(grouped.excluded[0]!.reasons[0]).toMatch(/below PHP 600000/)
  })

  it("does not convert: a different currency is unknown, not below", () => {
    const dollars = item({
      salary: { min: "2000", max: "3000", currency: "USD", period: "MONTHLY" },
    })
    const grouped = groupOpportunities([dollars], criteria(floor))

    expect(grouped.eligible).toHaveLength(0)
    expect(grouped.excluded).toHaveLength(0)
    expect(grouped.unknown).toHaveLength(1)
  })

  it("compares annualized values, so an hourly rate can clear an annual floor", () => {
    const hourly = item({
      salary: { min: "600", max: "700", currency: "PHP", period: "HOURLY" },
    })
    expect(evaluateCriteria(hourly, criteria(floor)).pass).toBe(true)
  })

  it("handles a zero-decimal currency without rounding drift", () => {
    const yen = item({
      salary: { min: "11000000", max: "12000000", currency: "JPY", period: "YEARLY" },
    })
    const evaluation = evaluateCriteria(yen, criteria({ minPay: "10000000", currency: "JPY" }))
    expect(evaluation.pass).toBe(true)
    expect(evaluation.unknown).toBe(false)
  })
})

describe("workload and friction", () => {
  it("does not call a posting light when it never describes its workload", () => {
    const silent = item({
      value: { ...item().value!, workload: { score: null, indicators: [] } },
    })
    const grouped = groupOpportunities([silent], criteriaForPreset("HIGH_PAY_LIGHT_LOAD"))

    expect(grouped.eligible).toHaveLength(0)
    expect(grouped.unknown).toHaveLength(1)
  })

  it("excludes a heavy workload from the light-workload preset", () => {
    const heavy = item({ value: { ...item().value!, workload: { score: 20, indicators: [] } } })
    const grouped = groupOpportunities([heavy], criteriaForPreset("HIGH_PAY_LIGHT_LOAD"))
    expect(grouped.excluded[0]!.reasons[0]).toMatch(/heavier/)
  })

  it("only matches selected workload indicators that the posting actually states", () => {
    const evaluation = evaluateCriteria(item(), criteria({ workload: ["OVERTIME"] }))
    expect(evaluation.pass).toBe(false)

    const matching = evaluateCriteria(item(), criteria({ workload: ["ON_CALL"] }))
    expect(matching.pass).toBe(true)
  })

  it("keeps an unknown friction score out of Easy to apply", () => {
    const unknownFriction = item({ value: { ...item().value!, friction: { score: null } } })
    const grouped = groupOpportunities([unknownFriction], criteriaForPreset("EASY_APPLY"))

    expect(grouped.eligible).toHaveLength(0)
    expect(grouped.unknown).toHaveLength(1)
  })

  it("excludes postings with more friction than the preset allows", () => {
    const painful = item({ value: { ...item().value!, friction: { score: 40 } } })
    expect(groupOpportunities([painful], criteriaForPreset("EASY_APPLY")).excluded).toHaveLength(1)
  })
})

describe("eligibility-style filters", () => {
  it("treats an unstated work mode as unknown under a remote filter", () => {
    const unstated = item({ workType: null })
    const grouped = groupOpportunities([unstated], criteria({ remote: "REMOTE" }))
    expect(grouped.unknown).toHaveLength(1)
  })

  it("accepts hybrid under remote-or-hybrid but not under remote-only", () => {
    const hybrid = item({ workType: "HYBRID" })
    expect(groupOpportunities([hybrid], criteria({ remote: "REMOTE" })).excluded).toHaveLength(1)
    expect(groupOpportunities([hybrid], criteria({ remote: "REMOTE_OR_HYBRID" })).eligible).toHaveLength(1)
  })

  it("excludes a stale posting and treats an unknown age as unknown", () => {
    expect(groupOpportunities([item({ ageDays: 40 })], criteria({ maxAgeDays: 14 })).excluded).toHaveLength(1)
    expect(groupOpportunities([item({ ageDays: null })], criteria({ maxAgeDays: 14 })).unknown).toHaveLength(1)
  })

  it("filters by risk only when risk is known", () => {
    expect(groupOpportunities([item({ risk: "HIGH" })], criteria({ risk: "LOW" })).excluded).toHaveLength(1)
    expect(groupOpportunities([item({ risk: null })], criteria({ risk: "LOW" })).unknown).toHaveLength(1)
  })

  it("treats an unstated pay period as unknown under a period filter", () => {
    const unstated = item({ salary: { min: "50000", max: "60000", currency: "PHP", period: null } })
    expect(groupOpportunities([unstated], criteria({ period: "MONTHLY" })).unknown).toHaveLength(1)
  })

  it("excludes on the posting's own BLOCK reason before any filter runs", () => {
    const blocked = item({
      value: {
        ...item().value!,
        accepted: false,
        grade: "BLOCKED",
        rejections: [{ severity: "BLOCK", message: "Pay is below your minimum." }],
      },
    })
    const grouped = groupOpportunities([blocked], DEFAULT_CRITERIA)

    expect(grouped.excluded).toHaveLength(1)
    expect(grouped.excluded[0]!.reasons).toEqual(["Pay is below your minimum."])
  })
})

describe("group counts", () => {
  it("accounts for every input exactly once", () => {
    const items = [
      item({ id: "a" }),
      item({ id: "b", ageDays: 90 }),
      item({ id: "c", workType: null }),
      item({ id: "d", value: { ...item().value!, coverage: 0.2 } }),
    ]
    const grouped = groupOpportunities(items, criteria({ maxAgeDays: 30, remote: "REMOTE" }))
    const total = grouped.eligible.length + grouped.unknown.length + grouped.excluded.length

    expect(total).toBe(items.length)
    // Thin evidence is a badge on the card, not an exclusion from a default view.
    expect(grouped.eligible.map((entry) => entry.id)).toEqual(["a", "d"])
    expect(grouped.unknown.map((entry) => entry.id)).toEqual(["c"])
    expect(grouped.excluded.map((entry) => entry.item.id)).toEqual(["b"])
  })

  it("keeps a thin-evidence posting eligible when no filter asks for more", () => {
    const thin = item({
      value: { ...item().value!, coverage: 0.1, workload: { score: null }, friction: { score: null } },
    })
    const grouped = groupOpportunities([thin], DEFAULT_CRITERIA)

    expect(grouped.eligible).toHaveLength(1)
    expect(grouped.unknown).toHaveLength(0)
  })
})

describe("sorting", () => {
  it("never orders two currencies against each other by amount", () => {
    const php = item({
      id: "php",
      salary: { min: "500000", max: "600000", currency: "PHP", period: "MONTHLY" },
    })
    const usd = item({
      id: "usd",
      salary: { min: "1000", max: "1000", currency: "USD", period: "MONTHLY" },
    })
    const sorted = sortOpportunities([php, usd], "PAY_DESC", "USD")

    expect(sorted.map((entry) => entry.id)).toEqual(["usd", "php"])
    // Without a selected currency, the order is stable by currency code.
    expect(sortOpportunities([usd, php], "PAY_DESC").map((entry) => entry.id)).toEqual(["php", "usd"])
  })

  it("puts unscored opportunities last, not first", () => {
    const scored = item({ id: "scored", value: { ...item().value!, score: 82 } })
    const unscored = item({ id: "unscored", value: null })
    expect(sortOpportunities([unscored, scored], "BEST_VALUE").map((entry) => entry.id)).toEqual([
      "scored",
      "unscored",
    ])
  })
})

describe("URL state", () => {
  it("round-trips every advanced filter", () => {
    const state = criteria({
      minPay: "900000",
      currency: "PHP",
      period: "MONTHLY",
      remote: "REMOTE_OR_HYBRID",
      location: "Manila",
      experience: "SENIOR",
      workload: ["ON_CALL", "OVERTIME"],
      minFriction: 70,
      maxAgeDays: 14,
      risk: "LOW",
      requireKnownPay: true,
      minWorkload: 55,
      sort: "EASIEST",
    })
    const params = writeFilterParams(new URLSearchParams(), state)

    expect(parseFilterParams(params)).toEqual(state)
  })

  it("leaves unrelated URL parameters alone", () => {
    const params = writeFilterParams(new URLSearchParams("status=APPLIED&q=design"), DEFAULT_CRITERIA)
    expect(params.get("status")).toBe("APPLIED")
    expect(params.get("q")).toBe("design")
  })

  it("rewrites stale values instead of throwing on them", () => {
    const parsed = parseFilterParams(
      new URLSearchParams("preset=HIGH_PAY&remote=MARS&paycur=XYZ&fresh=-4&vsort=NOPE")
    )
    expect(parsed.remote).toBe("ANY")
    expect(parsed.currency).toBeNull()
    expect(parsed.maxAgeDays).toBeNull()
    // The preset's own ordering is the fallback when the URL's sort is garbage.
    expect(parsed.sort).toBe("PAY_DESC")
  })

  it("rejects malformed money strings that Decimal cannot parse", () => {
    for (const raw of ["%20", " ", "0x10", "1e3", "-1"]) {
      const parsed = parseFilterParams(new URLSearchParams({ paymin: raw, paycur: "USD" }))
      expect(parsed.minPay, raw).toBeNull()
      expect(parsed.currency).toBe("USD")
    }
  })

  it("clears everything on reset", () => {
    const state = criteria({ minPay: "900000", currency: "PHP", sort: "PAY_DESC" })
    const reset = writeFilterParams(writeFilterParams(new URLSearchParams(), state), DEFAULT_CRITERIA)
    expect(parseFilterParams(reset)).toEqual(DEFAULT_CRITERIA)
    expect(reset.toString()).toBe("")
  })
})
