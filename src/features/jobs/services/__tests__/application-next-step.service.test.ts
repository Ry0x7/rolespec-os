import { describe, it, expect } from "vitest"

import { formatDate } from "@/shared/lib/utils"
import {
  describeNextStep,
  type NextStepInput,
} from "../application-next-step.service"

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

describe("describeNextStep — offer", () => {
  it("outranks every date on the row", () => {
    expect(
      describeNextStep(
        row({ status: "OFFER", followUpAt: day(-30), interviewDate: day(1) }),
        TODAY,
      ),
    ).toEqual({ label: "Decide on the offer", urgency: 0, tone: "urgent" })
  })

  it("names the day the offer was recorded", () => {
    expect(
      describeNextStep(
        row({ status: "OFFER", outcomeAt: new Date(Date.UTC(2026, 8, 11)) }),
        TODAY,
      ),
    ).toEqual({
      label: "Decide on the offer — received Sep 11, 2026",
      urgency: 0,
      tone: "urgent",
    })
  })

  it("says only Decide on the offer when no outcome day was stamped", () => {
    expect(describeNextStep(row({ status: "OFFER" }), TODAY)).toEqual({
      label: "Decide on the offer",
      urgency: 0,
      tone: "urgent",
    })
  })
})

describe("describeNextStep — closed", () => {
  it("names the day a rejection was recorded", () => {
    expect(
      describeNextStep(
        row({ status: "REJECTED", outcomeAt: new Date(Date.UTC(2026, 8, 9)) }),
        TODAY,
      ),
    ).toEqual({ label: "Closed Sep 9, 2026", urgency: 3, tone: "done" })
  })

  it("says only Closed for a withdrawal stamped before outcomes existed", () => {
    expect(describeNextStep(row({ status: "WITHDRAWN" }), TODAY)).toEqual({
      label: "Closed",
      urgency: 3,
      tone: "done",
    })
  })
})

describe("describeNextStep — interview and screening", () => {
  it("calls an interview inside two days urgent", () => {
    const interviewDate = new Date(Date.UTC(2026, 8, 16, 9))
    expect(
      describeNextStep(row({ status: "INTERVIEW", interviewDate }), TODAY),
    ).toEqual({
      label: `Interview ${formatDate(interviewDate)}`,
      urgency: 0,
      tone: "urgent",
    })
  })

  it("demotes an interview further out to soon", () => {
    const interviewDate = new Date(Date.UTC(2026, 8, 20, 9))
    expect(
      describeNextStep(row({ status: "SCREENING", interviewDate }), TODAY),
    ).toEqual({
      label: `Interview ${formatDate(interviewDate)}`,
      urgency: 1,
      tone: "soon",
    })
  })

  it("asks for the outcome once the interview has passed", () => {
    expect(
      describeNextStep(
        row({ status: "INTERVIEW", interviewDate: new Date(Date.UTC(2026, 8, 11, 9)) }),
        TODAY,
      ),
    ).toEqual({ label: "Log the interview outcome", urgency: 1, tone: "soon" })
  })

  it("falls back to the chase when no interview is booked", () => {
    expect(
      describeNextStep(row({ status: "SCREENING", followUpAt: day(-2) }), TODAY),
    ).toEqual({
      label: "Follow up — 2 days overdue",
      urgency: 0,
      tone: "urgent",
    })
  })
})

describe("describeNextStep — follow-ups", () => {
  it("counts a single overdue day in the singular", () => {
    expect(
      describeNextStep(row({ status: "APPLIED", followUpAt: day(-1) }), TODAY),
    ).toEqual({ label: "Follow up — 1 day overdue", urgency: 0, tone: "urgent" })
  })

  it("counts several overdue days", () => {
    expect(
      describeNextStep(row({ status: "APPLIED", followUpAt: day(-5) }), TODAY),
    ).toEqual({ label: "Follow up — 5 days overdue", urgency: 0, tone: "urgent" })
  })

  it("treats a chase due today as due, not overdue", () => {
    expect(
      describeNextStep(row({ status: "APPLIED", followUpAt: day(0) }), TODAY),
    ).toEqual({ label: "Follow up today", urgency: 0, tone: "urgent" })
  })

  it("tints a chase inside three days amber", () => {
    expect(
      describeNextStep(row({ status: "APPLIED", followUpAt: day(3) }), TODAY),
    ).toEqual({ label: "Follow up Sep 17, 2026", urgency: 2, tone: "soon" })
  })

  it("leaves a chase further out muted", () => {
    expect(
      describeNextStep(row({ status: "APPLIED", followUpAt: day(10) }), TODAY),
    ).toEqual({ label: "Follow up Sep 24, 2026", urgency: 2, tone: "neutral" })
  })

  it("asks for a date when a sent application has none", () => {
    expect(describeNextStep(row({ status: "APPLIED" }), TODAY)).toEqual({
      label: "Schedule a follow-up",
      urgency: 1,
      tone: "soon",
    })
  })
})

describe("describeNextStep — interested", () => {
  it("forces a decision on a deadline inside two days", () => {
    expect(describeNextStep(row({ deadline: day(1) }), TODAY)).toEqual({
      label: "Deadline Sep 15, 2026 — apply or drop",
      urgency: 0,
      tone: "urgent",
    })
  })

  it("keeps a deadline inside the week one step down", () => {
    expect(describeNextStep(row({ deadline: day(6) }), TODAY)).toEqual({
      label: "Deadline Sep 20, 2026 — apply or drop",
      urgency: 1,
      tone: "soon",
    })
  })

  it("ignores a deadline beyond the week", () => {
    expect(describeNextStep(row({ deadline: day(20) }), TODAY)).toEqual({
      label: "Review and decide",
      urgency: 2,
      tone: "neutral",
    })
  })

  it("calls a deadline that has already passed overdue, not spent", () => {
    expect(describeNextStep(row({ deadline: day(-1) }), TODAY)).toEqual({
      label: "Deadline passed Sep 13, 2026 \u2014 apply or drop",
      urgency: 0,
      tone: "urgent",
    })
  })

  it("lets a passed deadline outrank a strong fit", () => {
    expect(
      describeNextStep(row({ verdict: "STRONG", deadline: day(-4) }), TODAY).label,
    ).toBe("Deadline passed Sep 10, 2026 \u2014 apply or drop")
  })

  it("pushes a strong fit towards applying", () => {
    expect(describeNextStep(row({ verdict: "STRONG" }), TODAY)).toEqual({
      label: "Strong fit — prepare and apply",
      urgency: 1,
      tone: "soon",
    })
  })

  it("lets an imminent deadline outrank a strong fit", () => {
    expect(
      describeNextStep(row({ verdict: "STRONG", deadline: day(1) }), TODAY).label,
    ).toBe("Deadline Sep 15, 2026 — apply or drop")
  })

  it("falls back to a plain review for any other verdict", () => {
    expect(describeNextStep(row({ verdict: "WEAK" }), TODAY)).toEqual({
      label: "Review and decide",
      urgency: 2,
      tone: "neutral",
    })
  })
})
