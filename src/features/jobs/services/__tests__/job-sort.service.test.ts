import { describe, it, expect } from "vitest"

import {
  CONFIDENCE_SORT_PARAM,
  DEADLINE_SORT_PARAM,
  JOB_SORT_OPTIONS,
  MATCH_SORT_PARAM,
  RECENT_SORT_PARAM,
  SAVED_NEWEST_SORT_PARAM,
  SAVED_OLDEST_SORT_PARAM,
  parseJobSortParam,
  sortJobRows,
  type JobSortValue,
} from "../job-sort.service"

/** The shape `/jobs` sorts by: the row's id is carried only to assert order. */
interface Row {
  id: string
  createdAt: Date
  updatedAt: Date
  nextStep: { urgency: number }
  confidence?: { level: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" }
}

function row(
  id: string,
  urgency: number,
  updatedAtDay: number,
  level?: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN",
  savedDay = 1,
): Row {
  return {
    id,
    createdAt: new Date(Date.UTC(2026, 7, savedDay)),
    updatedAt: new Date(Date.UTC(2026, 8, updatedAtDay)),
    nextStep: { urgency },
    ...(level ? { confidence: { level } } : {}),
  }
}

function order(rows: Row[], sort: JobSortValue): string[] {
  return sortJobRows(rows, sort).map((r) => r.id)
}

describe("parseJobSortParam", () => {
  it("reads the one non-default value the page honours", () => {
    expect(parseJobSortParam(RECENT_SORT_PARAM)).toBe("RECENT")
    expect(parseJobSortParam(CONFIDENCE_SORT_PARAM)).toBe("CONFIDENCE")
    expect(parseJobSortParam(SAVED_NEWEST_SORT_PARAM)).toBe("SAVED_NEWEST")
    expect(parseJobSortParam(SAVED_OLDEST_SORT_PARAM)).toBe("SAVED_OLDEST")
    expect(parseJobSortParam(DEADLINE_SORT_PARAM)).toBe("DEADLINE")
    expect(parseJobSortParam(MATCH_SORT_PARAM)).toBe("MATCH_SCORE")
    expect(parseJobSortParam("saved-newest")).toBe("SAVED_NEWEST")
    expect(parseJobSortParam("saved-oldest")).toBe("SAVED_OLDEST")
  })

  it("falls back to needs-action for a missing or unknown value", () => {
    expect(parseJobSortParam(undefined)).toBe("NEEDS_ACTION")
    expect(parseJobSortParam("")).toBe("NEEDS_ACTION")
    expect(parseJobSortParam("needs_action")).toBe("NEEDS_ACTION")
    expect(parseJobSortParam("oldest")).toBe("NEEDS_ACTION")
    // The comparison is exact, so the uppercase spelling is not the param.
    expect(parseJobSortParam("RECENT")).toBe("NEEDS_ACTION")
  })

  it("offers exactly the values it can parse back", () => {
    expect(JOB_SORT_OPTIONS.map((option) => option.value)).toEqual([
      "NEEDS_ACTION",
      "RECENT",
      "CONFIDENCE",
      "DEADLINE",
      "MATCH_SCORE",
      "SAVED_NEWEST",
      "SAVED_OLDEST",
    ])
    expect(JOB_SORT_OPTIONS.find((o) => o.value === "DEADLINE")?.label).toBe("Deadline")
    expect(JOB_SORT_OPTIONS.find((o) => o.value === "MATCH_SCORE")?.label).toBe("Match score")
    expect(JOB_SORT_OPTIONS.find((o) => o.value === "SAVED_NEWEST")?.label).toBe("Newest saved")
    expect(JOB_SORT_OPTIONS.find((o) => o.value === "SAVED_OLDEST")?.label).toBe("Oldest saved")
  })
})

describe("sortJobRows", () => {
  it("puts the most urgent next step first", () => {
    // Urgency counts up from 0 = act now, so ascending is the urgent order.
    const rows = [row("neutral", 2, 20), row("now", 0, 20), row("soon", 1, 20)]
    expect(order(rows, "NEEDS_ACTION")).toEqual(["now", "soon", "neutral"])
  })

  it("breaks an urgency tie with the most recently updated row", () => {
    const rows = [row("older", 0, 10), row("newer", 0, 18)]
    expect(order(rows, "NEEDS_ACTION")).toEqual(["newer", "older"])
  })

  it("ignores urgency entirely under the recent order", () => {
    // The same rows the needs-action order puts urgent-first come back in
    // update order here — otherwise the sort control does nothing visible.
    const rows = [row("urgent-but-stale", 0, 3), row("calm-but-fresh", 2, 25)]
    expect(order(rows, "RECENT")).toEqual(["calm-but-fresh", "urgent-but-stale"])
    expect(order(rows, "NEEDS_ACTION")).toEqual(["urgent-but-stale", "calm-but-fresh"])
  })

  it("orders by confidence HIGH to UNKNOWN under the confidence order", () => {
    const rows = [
      row("unknown", 0, 20, "UNKNOWN"),
      row("low", 0, 20, "LOW"),
      row("high", 2, 20, "HIGH"),
      row("medium", 1, 20, "MEDIUM"),
    ]
    expect(order(rows, "CONFIDENCE")).toEqual(["high", "medium", "low", "unknown"])
  })

  it("breaks a confidence tie with the needs-action order, then recency", () => {
    const rows = [
      row("calm", 2, 25, "LOW"),
      row("urgent-older", 0, 10, "LOW"),
      row("urgent-newer", 0, 18, "LOW"),
    ]
    expect(order(rows, "CONFIDENCE")).toEqual(["urgent-newer", "urgent-older", "calm"])
  })

  it("ranks a row with no confidence alongside UNKNOWN", () => {
    const rows = [row("none", 0, 20), row("low", 1, 20, "LOW")]
    expect(order(rows, "CONFIDENCE")).toEqual(["low", "none"])
  })

  it("orders by saved date, newest first, ignoring urgency and updates", () => {
    const rows = [
      row("mid", 0, 25, undefined, 10),
      row("new", 2, 1, undefined, 20),
      row("old", 1, 28, undefined, 2),
    ]
    expect(order(rows, "SAVED_NEWEST")).toEqual(["new", "mid", "old"])
  })

  it("orders by saved date, oldest first", () => {
    const rows = [
      row("mid", 0, 25, undefined, 10),
      row("new", 2, 1, undefined, 20),
      row("old", 1, 28, undefined, 2),
    ]
    expect(order(rows, "SAVED_OLDEST")).toEqual(["old", "mid", "new"])
  })

  it("breaks a saved-date tie by id under both saved orders", () => {
    // Different urgency and update times, so only the id can decide.
    const rows = [
      row("c", 0, 25, undefined, 5),
      row("a", 2, 3, undefined, 5),
      row("b", 1, 14, undefined, 5),
    ]
    expect(order(rows, "SAVED_NEWEST")).toEqual(["a", "b", "c"])
    expect(order(rows, "SAVED_OLDEST")).toEqual(["a", "b", "c"])
  })

  it("never mutates the array it was given", () => {
    const rows = [row("b", 2, 10), row("a", 0, 10)]
    const sorted = sortJobRows(rows, "NEEDS_ACTION")
    expect(rows.map((r) => r.id)).toEqual(["b", "a"])
    expect(sorted).not.toBe(rows)
  })

  it("handles an empty list", () => {
    expect(sortJobRows([], "NEEDS_ACTION")).toEqual([])
    expect(sortJobRows([], "RECENT")).toEqual([])
  })
})
