import { describe, it, expect } from "vitest"

import { isPostedWithin } from "../posted-within"

const NOW = new Date("2026-09-15T12:00:00.000Z")
const DAY_MS = 86_400_000

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString()

describe("isPostedWithin", () => {
  it("keeps everything when the window is 'any'", () => {
    expect(isPostedWithin(undefined, "any", NOW)).toBe(true)
    expect(isPostedWithin(null, "any", NOW)).toBe(true)
    expect(isPostedWithin(daysAgo(400), "any", NOW)).toBe(true)
    expect(isPostedWithin("not a date", "any", NOW)).toBe(true)
  })

  it("keeps a posting just inside the window", () => {
    expect(isPostedWithin(daysAgo(6.9), "7", NOW)).toBe(true)
  })

  it("drops a posting just outside the window", () => {
    expect(isPostedWithin(daysAgo(7.1), "7", NOW)).toBe(false)
  })

  it("drops a posting with no usable date once a window is active", () => {
    expect(isPostedWithin(undefined, "7", NOW)).toBe(false)
    expect(isPostedWithin(null, "7", NOW)).toBe(false)
    expect(isPostedWithin("", "7", NOW)).toBe(false)
    expect(isPostedWithin("not a date", "7", NOW)).toBe(false)
  })

  it("counts a future date as within the window", () => {
    expect(isPostedWithin(new Date(NOW.getTime() + 2 * DAY_MS), "1", NOW)).toBe(true)
  })

  it("accepts a Date as well as an ISO string", () => {
    expect(isPostedWithin(new Date(NOW.getTime() - 2 * DAY_MS), "3", NOW)).toBe(true)
    expect(isPostedWithin(new Date(NOW.getTime() - 4 * DAY_MS), "3", NOW)).toBe(false)
  })
})
