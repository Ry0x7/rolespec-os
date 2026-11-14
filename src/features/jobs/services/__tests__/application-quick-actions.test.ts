import { describe, it, expect } from "vitest"

import { quickActionsFor } from "../application-quick-actions"
import type { NextStepInput } from "../application-next-step.service"

/** The user's day start, the value `getUserDayStart` hands the page. */
const TODAY = new Date(Date.UTC(2026, 8, 14))

/** A calendar date `days` from TODAY, stored the way `@db.Date` stores one. */
function day(days: number): Date {
  return new Date(TODAY.getTime() + days * 86_400_000)
}

function row(overrides: Partial<NextStepInput> = {}): NextStepInput {
  return {
    status: "INTERESTED",
    followUpAt: null,
    interviewDate: null,
    outcomeAt: null,
    deadline: null,
    verdict: null,
    ...overrides,
  }
}

/** The kinds only — the labels are asserted where the wording is the point. */
function kinds(input: Partial<NextStepInput>, today: Date = TODAY) {
  return quickActionsFor(row(input), today).map((action) => action.kind)
}

describe("quickActionsFor — interested", () => {
  it("offers marking it applied, plus opening it", () => {
    expect(quickActionsFor(row({ verdict: "STRONG" }), TODAY)).toEqual([
      { kind: "mark-applied", label: "Mark applied" },
      { kind: "open", label: "Open" },
    ])
  })

  it("still offers both when a deadline has already passed", () => {
    expect(kinds({ verdict: "WEAK", deadline: day(-3) })).toEqual([
      "mark-applied",
      "open",
    ])
  })
})

describe("quickActionsFor — interested with no verdict", () => {
  it("offers the fit check instead of marking it applied", () => {
    expect(quickActionsFor(row(), TODAY)).toEqual([
      { kind: "check-fit", label: "Check fit" },
      { kind: "open", label: "Open" },
    ])
  })

  it("offers it for every verdict-less INTERESTED row, deadline or not", () => {
    expect(kinds({ deadline: day(-3) })).toEqual(["check-fit", "open"])
    expect(kinds({ deadline: day(1) })).toEqual(["check-fit", "open"])
  })

  it("leaves a sent application's chase alone — fit is retrospective there", () => {
    expect(kinds({ status: "APPLIED", followUpAt: day(-3) })).toEqual([
      "follow-up-done",
      "snooze-week",
    ])
    expect(kinds({ status: "APPLIED" })).toEqual(["schedule-follow-up"])
    expect(kinds({ status: "REJECTED" })).toEqual([])
  })
})

describe("quickActionsFor — follow-up due", () => {
  it("offers done and snooze on an overdue chase", () => {
    expect(
      quickActionsFor(row({ status: "APPLIED", followUpAt: day(-3) }), TODAY),
    ).toEqual([
      { kind: "follow-up-done", label: "Done" },
      { kind: "snooze-week", label: "Snooze 1 week" },
    ])
  })

  it("treats a follow-up due today as due", () => {
    expect(kinds({ status: "SCREENING", followUpAt: day(0) })).toEqual([
      "follow-up-done",
      "snooze-week",
    ])
  })
})

describe("quickActionsFor — follow-up still ahead", () => {
  it("offers nothing while the chase is not pressing", () => {
    expect(kinds({ status: "APPLIED", followUpAt: day(5) })).toEqual([])
  })

  it("offers snooze when something else on the row is already urgent", () => {
    // An interview two days out makes the next step urgency 0, so pushing the
    // scheduled chase past it is a real move.
    expect(
      kinds({
        status: "INTERVIEW",
        followUpAt: day(5),
        interviewDate: new Date(Date.UTC(2026, 8, 16, 9)),
      }),
    ).toEqual(["snooze-week"])
  })
})

describe("quickActionsFor — no follow-up scheduled", () => {
  it("offers scheduling one on an application in flight", () => {
    expect(quickActionsFor(row({ status: "APPLIED" }), TODAY)).toEqual([
      { kind: "schedule-follow-up", label: "Schedule follow-up" },
    ])
  })
})

describe("quickActionsFor — interview already held", () => {
  it("sends the user to the job to log the outcome", () => {
    expect(
      quickActionsFor(
        row({
          status: "INTERVIEW",
          interviewDate: new Date(Date.UTC(2026, 8, 11, 9)),
          followUpAt: day(-2),
        }),
        TODAY,
      ),
    ).toEqual([{ kind: "open", label: "Log the outcome", section: "track" }])
  })

  it("does the same for a screening call that has been held", () => {
    expect(
      quickActionsFor(
        row({
          status: "SCREENING",
          interviewDate: new Date(Date.UTC(2026, 8, 13, 9)),
        }),
        TODAY,
      ),
    ).toEqual([{ kind: "open", label: "Log the outcome", section: "track" }])
  })
})

describe("quickActionsFor — offer", () => {
  it("offers only the page where the decision is made", () => {
    expect(
      quickActionsFor(
        row({ status: "OFFER", followUpAt: day(-9), interviewDate: day(-1) }),
        TODAY,
      ),
    ).toEqual([{ kind: "open", label: "Decide", section: "decide" }])
  })
})

describe("quickActionsFor — open sections", () => {
  it("leaves a plain Open at the top of the job page", () => {
    const opens = [
      ...quickActionsFor(row({ verdict: "STRONG" }), TODAY),
      ...quickActionsFor(row({ verdict: null }), TODAY),
    ].filter((action) => action.kind === "open")

    expect(opens).toHaveLength(2)
    for (const action of opens) {
      expect(action.label).toBe("Open")
      expect(action.section).toBeUndefined()
    }
  })

  it("does not deep-link an interview that is still ahead", () => {
    const actions = quickActionsFor(
      row({ status: "INTERVIEW", interviewDate: day(2) }),
      TODAY,
    )

    expect(actions.some((action) => action.section !== undefined)).toBe(false)
  })
})

describe("quickActionsFor — terminal", () => {
  it("offers nothing on a rejection", () => {
    expect(kinds({ status: "REJECTED", outcomeAt: day(-4) })).toEqual([])
  })

  it("offers nothing on a withdrawal", () => {
    expect(kinds({ status: "WITHDRAWN" })).toEqual([])
  })
})

describe("quickActionsFor — bounds", () => {
  it("never returns more than two actions in any state", () => {
    const states: Partial<NextStepInput>[] = [
      {},
      { status: "APPLIED" },
      { status: "APPLIED", followUpAt: day(-1) },
      { status: "APPLIED", followUpAt: day(4) },
      { status: "SCREENING", interviewDate: day(-1) },
      { status: "INTERVIEW", interviewDate: day(1) },
      { status: "OFFER" },
      { status: "REJECTED" },
      { status: "WITHDRAWN" },
    ]
    for (const state of states) {
      expect(quickActionsFor(row(state), TODAY).length).toBeLessThanOrEqual(2)
    }
  })
})
