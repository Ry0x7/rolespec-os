import { describe, it, expect } from "vitest"

import { ApplicationStatus } from "@/generated/prisma/enums"
import { STALE_AFTER_DAYS, isStaleJob, type StaleCheckable } from "../job-staleness.service"

/** The user's calendar day, as `/jobs/page.tsx` hands it in. */
const TODAY = new Date(Date.UTC(2026, 9, 14))
const MS_PER_DAY = 86_400_000

function daysBefore(days: number): Date {
  return new Date(TODAY.getTime() - days * MS_PER_DAY)
}

function row(overrides: Partial<Omit<StaleCheckable, "job">> & {
  deadline?: Date | null
} = {}): StaleCheckable {
  const { deadline = null, ...rest } = overrides
  return {
    status: ApplicationStatus.INTERESTED,
    createdAt: daysBefore(1),
    dateApplied: null,
    ...rest,
    job: { deadline },
  }
}

describe("isStaleJob", () => {
  it("uses a 30-day threshold", () => {
    expect(STALE_AFTER_DAYS).toBe(30)
  })

  it("is not stale at exactly 30 days, and stale at 31", () => {
    expect(isStaleJob(row({ createdAt: daysBefore(30) }), TODAY)).toBe(false)
    expect(isStaleJob(row({ createdAt: daysBefore(31) }), TODAY)).toBe(true)
  })

  it("counts calendar days, so a late-evening save 30 days back is not stale", () => {
    const lateOnDay30 = new Date(daysBefore(30).getTime() + 23 * 3_600_000)
    expect(isStaleJob(row({ createdAt: lateOnDay30 }), TODAY)).toBe(false)
  })

  it("is stale when the deadline was yesterday, not when it is today", () => {
    expect(isStaleJob(row({ deadline: daysBefore(1) }), TODAY)).toBe(true)
    expect(isStaleJob(row({ deadline: TODAY }), TODAY)).toBe(false)
    expect(isStaleJob(row({ deadline: daysBefore(-3) }), TODAY)).toBe(false)
  })

  it("is not stale for a fresh save with no deadline", () => {
    expect(isStaleJob(row({ deadline: null }), TODAY)).toBe(false)
  })

  it("is stale for an old save with no deadline", () => {
    expect(isStaleJob(row({ createdAt: daysBefore(90), deadline: null }), TODAY)).toBe(true)
  })

  it("never marks a job past the saved status as stale", () => {
    const others = Object.values(ApplicationStatus).filter(
      (status) => status !== ApplicationStatus.INTERESTED,
    )
    expect(others.length).toBeGreaterThan(0)
    for (const status of others) {
      expect(
        isStaleJob(row({ status, createdAt: daysBefore(90), deadline: daysBefore(5) }), TODAY),
      ).toBe(false)
    }
  })

  it("never marks a saved job that carries an applied date as stale", () => {
    expect(
      isStaleJob(
        row({ createdAt: daysBefore(90), deadline: daysBefore(5), dateApplied: daysBefore(60) }),
        TODAY,
      ),
    ).toBe(false)
  })
})
