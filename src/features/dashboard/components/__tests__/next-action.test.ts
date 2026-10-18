import { describe, it, expect } from "vitest"
import { resolveNextAction } from "../next-action"

const base = {
  hasProfile: true,
  resumeCount: 1,
  applicationCount: 1,
  interestedCount: 0,
  followUpDueCount: 0,
}

describe("resolveNextAction", () => {
  it("puts the career profile first, even with everything else in place", () => {
    const action = resolveNextAction({
      ...base,
      hasProfile: false,
      resumeCount: 3,
      applicationCount: 5,
      interestedCount: 2,
      followUpDueCount: 4,
    })

    expect(action.href).toBe("/career-profile")
  })

  it("asks for a resume before discovery", () => {
    const action = resolveNextAction({ ...base, resumeCount: 0 })

    expect(action.href).toBe("/resumes")
  })

  it("sends a user with no applications to discovery", () => {
    const action = resolveNextAction({ ...base, applicationCount: 0 })

    expect(action.href).toBe("/jobs/discover")
    expect(action.cta).toBe("Discover jobs")
  })

  it("still asks for the first application before any follow-up", () => {
    const action = resolveNextAction({
      ...base,
      applicationCount: 0,
      followUpDueCount: 2,
    })

    expect(action.href).toBe("/jobs/discover")
  })

  it("counts the applications whose follow-up date has passed", () => {
    const action = resolveNextAction({ ...base, followUpDueCount: 3 })

    expect(action.title).toBe("Follow up on 3 applications")
    expect(action.href).toBe("/jobs?filter=follow-up-due")
  })

  it("deep links the follow-up CTA at the filtered list, not the whole list", () => {
    const action = resolveNextAction({ ...base, followUpDueCount: 1 })

    expect(action.href).toBe("/jobs?filter=follow-up-due")
  })

  it("keeps the count singular for one due follow-up", () => {
    const action = resolveNextAction({ ...base, followUpDueCount: 1 })

    expect(action.title).toBe("Follow up on 1 application")
  })

  it.each([
    [0, "Due today — send the nudge."],
    [1, "1 day overdue — send the nudge."],
    [5, "5 days overdue — send the nudge."],
  ])("words a top follow-up %i days overdue by its day", (days, description) => {
    const action = resolveNextAction({
      ...base,
      followUpDueCount: 2,
      topFollowUpDaysOverdue: days,
    })

    expect(action.description).toBe(description)
  })

  it("keeps the generic follow-up copy without a top row", () => {
    const action = resolveNextAction({ ...base, followUpDueCount: 1 })

    expect(action.description).toBe("The follow-up date has passed — send the nudge.")
  })

  it("ranks a due follow-up above undecided saved jobs", () => {
    const action = resolveNextAction({
      ...base,
      followUpDueCount: 1,
      interestedCount: 5,
    })

    expect(action.title).toBe("Follow up on 1 application")
  })

  it("counts the saved jobs waiting on a decision", () => {
    const action = resolveNextAction({
      ...base,
      applicationCount: 4,
      interestedCount: 3,
    })

    expect(action.title).toBe("Decide on 3 saved jobs")
    expect(action.href).toBe("/jobs")
  })

  it("keeps the count singular for one saved job", () => {
    const action = resolveNextAction({ ...base, interestedCount: 1 })

    expect(action.title).toBe("Decide on 1 saved job")
  })

  describe("with a top-ranked saved job", () => {
    const topDecide = {
      id: "app-42",
      companyName: "SourceU",
      jobTitle: "Web Developer",
      reason: "Strong fit — tailor a resume and apply",
    }

    it("names and links that job, with how many more are waiting", () => {
      const action = resolveNextAction({
        ...base,
        applicationCount: 24,
        interestedCount: 22,
        topDecide,
      })

      expect(action.title).toBe("Decide on SourceU — Web Developer")
      expect(action.description).toBe(
        "Strong fit — tailor a resume and apply · 21 more waiting",
      )
      expect(action.href).toBe("/jobs/app-42#decide")
      expect(action.cta).toBe("Open job")
    })

    it("drops the waiting suffix when it is the only saved job", () => {
      const action = resolveNextAction({ ...base, interestedCount: 1, topDecide })

      expect(action.description).toBe("Strong fit — tailor a resume and apply")
      expect(action.description).not.toContain("more waiting")
      expect(action.href).toBe("/jobs/app-42#decide")
    })

    it("keeps the list copy unchanged without a top-ranked job", () => {
      const action = resolveNextAction({ ...base, interestedCount: 22 })

      expect(action).toEqual({
        title: "Decide on 22 saved jobs",
        description: "Apply, tailor a resume, or drop it — do not let it sit.",
        href: "/jobs",
        cta: "Review saved jobs",
      })
    })

    it("still ranks a due follow-up above the named job", () => {
      const action = resolveNextAction({
        ...base,
        interestedCount: 22,
        followUpDueCount: 2,
        topDecide,
      })

      expect(action.title).toBe("Follow up on 2 applications")
      expect(action.href).toBe("/jobs?filter=follow-up-due")
    })
  })

  describe("with a past interview awaiting its outcome", () => {
    const topAwaitingOutcome = { id: "app-7", companyName: "Treantly", daysSince: 3 }
    const topDecide = {
      id: "app-42",
      companyName: "SourceU",
      jobTitle: "Web Developer",
      reason: "Strong fit — tailor a resume and apply",
    }

    it("names the job and links its Track section", () => {
      const action = resolveNextAction({ ...base, topAwaitingOutcome })

      expect(action).toEqual({
        title: "Log the interview outcome — Treantly",
        description: "Interview was 3 days ago",
        href: "/jobs/app-7#track",
        cta: "Open job",
      })
    })

    it("keeps the day singular for yesterday's interview", () => {
      const action = resolveNextAction({
        ...base,
        topAwaitingOutcome: { ...topAwaitingOutcome, daysSince: 1 },
      })

      expect(action.description).toBe("Interview was 1 day ago")
    })

    it("ranks above deciding on a saved job", () => {
      const action = resolveNextAction({
        ...base,
        interestedCount: 5,
        topDecide,
        topAwaitingOutcome,
      })

      expect(action.href).toBe("/jobs/app-7#track")
    })

    it("ranks below a due follow-up", () => {
      const action = resolveNextAction({
        ...base,
        followUpDueCount: 1,
        topAwaitingOutcome,
      })

      expect(action.href).toBe("/jobs?filter=follow-up-due")
    })
  })

  it("falls back to more discovery when nothing is pending", () => {
    const action = resolveNextAction(base)

    expect(action.href).toBe("/jobs/discover")
    expect(action.cta).toBe("Discover more jobs")
  })
})
