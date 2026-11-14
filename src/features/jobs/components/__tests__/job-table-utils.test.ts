import { describe, it, expect } from "vitest"
import { ApplicationStatus, JobType } from "@/generated/prisma/enums"
import type { JobFormApplication } from "../job-form-application"
import {
  EMPTY_NEW_ROW_DRAFT,
  buildCreateFormData,
  buildFieldFormData,
  getEditableCellValue,
  hasCellChanged,
  needsAppliedStatusFollowUp,
  toDateInputValue,
  toDateTimeInputValue,
} from "../job-table-utils"
import { formatCalendarDate } from "@/shared/lib/dates"

function makeApp(
  overrides: Partial<JobFormApplication> = {},
): JobFormApplication {
  return {
    id: "app-1",
    companyName: "Acme Corp",
    jobTitle: "Engineer",
    status: ApplicationStatus.APPLIED,
    location: null,
    salary: null,
    salaryPeriod: null,
    salaryCurrency: "USD",
    dateApplied: null,
    deadline: null,
    interviewDate: null,
    followUpAt: null,
    jobLink: null,
    contact: null,
    jobDescription: null,
    notes: null,
    jobType: null,
    workType: null,
    ...overrides,
  }
}

describe("toDateInputValue", () => {
  it("returns an empty string for null", () => {
    expect(toDateInputValue(null)).toBe("")
  })

  it("returns the UTC YYYY-MM-DD slice", () => {
    expect(toDateInputValue(new Date("2024-03-07T00:00:00.000Z"))).toBe("2024-03-07")
  })

  it("does not shift the day for UTC midnight dates", () => {
    // @db.Date values arrive as UTC midnight; a locale-based format would
    // roll back a day in negative-offset timezones.
    expect(toDateInputValue(new Date("2024-01-01T00:00:00.000Z"))).toBe("2024-01-01")
  })
})

describe("toDateInputValue / detail page agreement", () => {
  it("offers the edit dialog the same day the detail page prints", () => {
    // The audited mismatch: a follow-up stored at 2026-09-15T23:00Z read as
    // "Sep 16" on the page and "2026-09-15" in the dialog. Calendar dates are
    // stored at UTC midnight now, so both sides read the same day.
    const followUpAt = new Date("2026-09-16T00:00:00.000Z")

    expect(formatCalendarDate(followUpAt)).toBe("Sep 16, 2026")
    expect(toDateInputValue(followUpAt)).toBe("2026-09-16")
  })
})

describe("toDateTimeInputValue", () => {
  it("returns an empty string for null", () => {
    expect(toDateTimeInputValue(null)).toBe("")
  })

  it("round-trips through the local wall clock a datetime-local input uses", () => {
    // `interviewDate` is an instant, and the action parses the submitted value
    // as local time, so what the input shows has to be local too.
    const instant = new Date(2026, 8, 16, 14, 30)

    const value = toDateTimeInputValue(instant)

    expect(value).toBe("2026-09-16T14:30")
    expect(new Date(value).getTime()).toBe(instant.getTime())
  })
})

describe("getEditableCellValue", () => {
  it("reads plain text fields", () => {
    const row = makeApp({ companyName: "Globex", jobTitle: "Designer" })
    expect(getEditableCellValue(row, "companyName")).toBe("Globex")
    expect(getEditableCellValue(row, "jobTitle")).toBe("Designer")
  })

  it("maps null text fields to an empty string", () => {
    const row = makeApp({ location: null, jobLink: null })
    expect(getEditableCellValue(row, "location")).toBe("")
    expect(getEditableCellValue(row, "jobLink")).toBe("")
  })

  it("formats date fields for a date input", () => {
    const row = makeApp({
      dateApplied: new Date("2024-05-20T00:00:00.000Z"),
      deadline: new Date("2024-06-01T00:00:00.000Z"),
    })
    expect(getEditableCellValue(row, "dateApplied")).toBe("2024-05-20")
    expect(getEditableCellValue(row, "deadline")).toBe("2024-06-01")
  })

  it("stringifies salary and keeps zero distinct from null", () => {
    expect(getEditableCellValue(makeApp({ salary: 85000 }), "salary")).toBe("85000")
    expect(getEditableCellValue(makeApp({ salary: 0 }), "salary")).toBe("0")
    expect(getEditableCellValue(makeApp({ salary: null }), "salary")).toBe("")
  })

  it("reads jobType as its enum value", () => {
    expect(getEditableCellValue(makeApp({ jobType: JobType.CONTRACT }), "jobType")).toBe(
      "CONTRACT"
    )
    expect(getEditableCellValue(makeApp({ jobType: null }), "jobType")).toBe("")
  })
})

describe("hasCellChanged", () => {
  it("is false for identical values", () => {
    expect(hasCellChanged("Acme", "Acme")).toBe(false)
  })

  it("ignores surrounding whitespace", () => {
    expect(hasCellChanged("  Acme  ", "Acme")).toBe(false)
    expect(hasCellChanged("", "   ")).toBe(false)
  })

  it("is true for a real edit", () => {
    expect(hasCellChanged("Globex", "Acme")).toBe(true)
    expect(hasCellChanged("", "Acme")).toBe(true)
  })
})

describe("buildFieldFormData", () => {
  it("contains only the changed field", () => {
    const formData = buildFieldFormData("companyName", "Globex")
    expect([...formData.keys()]).toEqual(["companyName"])
    expect(formData.get("companyName")).toBe("Globex")
  })

  it("trims the value", () => {
    expect(buildFieldFormData("location", "  Berlin ").get("location")).toBe("Berlin")
  })

  it("keeps an empty string so text fields can be cleared", () => {
    const formData = buildFieldFormData("location", "   ")
    expect([...formData.keys()]).toEqual(["location"])
    expect(formData.get("location")).toBe("")
  })

  it("sends dates as YYYY-MM-DD", () => {
    expect(buildFieldFormData("dateApplied", "2024-05-20").get("dateApplied")).toBe(
      "2024-05-20"
    )
  })

  it("keeps an empty string so jobType can be cleared", () => {
    const formData = buildFieldFormData("jobType", "")
    expect([...formData.keys()]).toEqual(["jobType"])
    expect(formData.get("jobType")).toBe("")
  })

  it("keeps an empty string so salary can be cleared", () => {
    const formData = buildFieldFormData("salary", "  ")
    expect([...formData.keys()]).toEqual(["salary"])
    expect(formData.get("salary")).toBe("")
  })

  it("still sends a non-empty salary as digits", () => {
    expect(buildFieldFormData("salary", " 85000 ").get("salary")).toBe("85000")
  })
})

describe("needsAppliedStatusFollowUp", () => {
  it("is true only for an APPLIED draft", () => {
    expect(
      needsAppliedStatusFollowUp({ ...EMPTY_NEW_ROW_DRAFT, status: "APPLIED" })
    ).toBe(true)
  })

  it("is false for the default and other statuses", () => {
    expect(needsAppliedStatusFollowUp(EMPTY_NEW_ROW_DRAFT)).toBe(false)
    expect(
      needsAppliedStatusFollowUp({ ...EMPTY_NEW_ROW_DRAFT, status: "INTERVIEW" })
    ).toBe(false)
    expect(needsAppliedStatusFollowUp({ ...EMPTY_NEW_ROW_DRAFT, status: "" })).toBe(
      false
    )
  })
})

describe("buildCreateFormData", () => {
  it("omits blank optional fields", () => {
    const formData = buildCreateFormData({
      ...EMPTY_NEW_ROW_DRAFT,
      companyName: "Acme",
      jobTitle: "Engineer",
    })
    expect([...formData.keys()].sort()).toEqual(["companyName", "jobTitle", "status"])
  })

  it("includes and trims the fields that were filled in", () => {
    const formData = buildCreateFormData({
      ...EMPTY_NEW_ROW_DRAFT,
      companyName: " Acme ",
      jobTitle: "Engineer",
      status: "INTERVIEW",
      jobType: "CONTRACT",
      salary: "85000",
      dateApplied: "2024-05-20",
    })
    expect(formData.get("companyName")).toBe("Acme")
    expect(formData.get("status")).toBe("INTERVIEW")
    expect(formData.get("jobType")).toBe("CONTRACT")
    expect(formData.get("salary")).toBe("85000")
    expect(formData.get("dateApplied")).toBe("2024-05-20")
    expect(formData.has("deadline")).toBe(false)
  })

  it("produces no keys at all for a fully blank draft with no status", () => {
    const formData = buildCreateFormData({ ...EMPTY_NEW_ROW_DRAFT, status: "" })
    expect([...formData.keys()]).toEqual([])
  })

  it("omits status for an APPLIED draft so the follow-up transition awards XP", () => {
    const formData = buildCreateFormData({
      ...EMPTY_NEW_ROW_DRAFT,
      companyName: "Acme",
      jobTitle: "Engineer",
      status: "APPLIED",
    })
    expect([...formData.keys()].sort()).toEqual(["companyName", "jobTitle"])
    expect(formData.has("status")).toBe(false)
  })
})
