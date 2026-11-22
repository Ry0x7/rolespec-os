import { describe, it, expect } from "vitest"
import { updateJobApplicationSchema, createJobApplicationSchema } from "../job-application.schema"

function parse(entries: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return updateJobApplicationSchema.safeParse(Object.fromEntries(fd))
}

/** Mirrors the salary expressions in `updateJobApplication`. */
function prismaData(parsed: Record<string, unknown>) {
  const {
    jobType,
    workType,
    salaryMin,
    salaryMax,
    salaryPeriod,
    salaryCurrency,
    salaryTermMonths,
    salaryText,
  } = parsed as {
    jobType?: string
    workType?: string
    salaryMin?: number | ""
    salaryMax?: number | ""
    salaryPeriod?: string
    salaryCurrency?: string
    salaryTermMonths?: number
    salaryText?: string
  }
  return {
    ...(jobType !== undefined ? { jobType: jobType || null } : {}),
    ...(workType !== undefined ? { workType: workType || null } : {}),
    ...(salaryMin !== undefined ? { salaryMin: salaryMin === "" ? null : salaryMin } : {}),
    ...(salaryMax !== undefined ? { salaryMax: salaryMax === "" ? null : salaryMax } : {}),
    ...(salaryCurrency !== undefined ? { salaryCurrency: salaryCurrency || null } : {}),
    ...(salaryPeriod !== undefined ? { salaryPeriod: salaryPeriod || null } : {}),
    ...(salaryTermMonths !== undefined ? { salaryTermMonths } : {}),
    ...(salaryText !== undefined ? { salaryText: salaryText || null } : {}),
  }
}

describe("updateJobApplicationSchema clearing", () => {
  it("jobType empty string parses and maps to null", () => {
    const r = parse({ jobType: "" })
    expect(r.success).toBe(true)
    expect(r.success && r.data.jobType).toBe("")
    expect(prismaData(r.success ? r.data : {})).toEqual({ jobType: null })
  })

  it("jobType real value maps through", () => {
    const r = parse({ jobType: "CONTRACT" })
    expect(prismaData(r.success ? r.data : {})).toEqual({ jobType: "CONTRACT" })
  })

  it("jobType garbage rejected", () => {
    expect(parse({ jobType: "NOPE" }).success).toBe(false)
  })

  it("workType empty string parses and maps to null", () => {
    const r = parse({ workType: "" })
    expect(r.success).toBe(true)
    expect(r.success && r.data.workType).toBe("")
    expect(prismaData(r.success ? r.data : {})).toEqual({ workType: null })
  })

  it("workType real value maps through", () => {
    const r = parse({ workType: "HYBRID" })
    expect(prismaData(r.success ? r.data : {})).toEqual({ workType: "HYBRID" })
  })

  it("workType garbage rejected", () => {
    expect(parse({ workType: "WFH" }).success).toBe(false)
  })

  it("an emptied pay box is a clear, not a zero", () => {
    const r = parse({ salaryMin: "", salaryMax: "" })
    expect(r.success).toBe(true)
    expect(prismaData(r.success ? r.data : {})).toEqual({ salaryMin: null, salaryMax: null })
  })

  it("a typed amount keeps its decimals", () => {
    const r = parse({ salaryMin: "85000.50", salaryMax: "95000" })
    expect(prismaData(r.success ? r.data : {})).toEqual({
      salaryMin: 85000.5,
      salaryMax: 95000,
    })
  })

  it("rejects negative, non-numeric and out-of-column amounts", () => {
    expect(parse({ salaryMin: "-5" }).success).toBe(false)
    expect(parse({ salaryMin: "abc" }).success).toBe(false)
    expect(parse({ salaryMin: "1000000000000" }).success).toBe(false)
  })

  it("rejects an inverted range", () => {
    const r = parse({ salaryMin: "120000", salaryMax: "90000" })
    expect(r.success).toBe(false)
  })

  it("a contract total needs a term", () => {
    expect(parse({ salaryPeriod: "CONTRACT" }).success).toBe(false)
    const ok = parse({ salaryPeriod: "CONTRACT", salaryTermMonths: "6" })
    expect(ok.success).toBe(true)
  })

  it("salaryPeriod real value maps through", () => {
    const r = parse({ salaryPeriod: "MONTHLY" })
    expect(r.success).toBe(true)
    expect(prismaData(r.success ? r.data : {})).toEqual({ salaryPeriod: "MONTHLY" })
  })

  it("salaryPeriod empty string maps to null", () => {
    const r = parse({ salaryPeriod: "" })
    expect(r.success).toBe(true)
    expect(prismaData(r.success ? r.data : {})).toEqual({ salaryPeriod: null })
  })

  it("every supported period is accepted", () => {
    for (const period of ["HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]) {
      expect(parse({ salaryPeriod: period }).success).toBe(true)
    }
    expect(parse({ salaryPeriod: "FORTNIGHTLY" }).success).toBe(false)
  })

  it("salaryCurrency real value maps through", () => {
    const r = parse({ salaryCurrency: "PHP" })
    expect(r.success).toBe(true)
    expect(prismaData(r.success ? r.data : {})).toEqual({ salaryCurrency: "PHP" })
  })

  it("salaryCurrency empty string clears an unknown currency", () => {
    const r = parse({ salaryCurrency: "" })
    expect(r.success).toBe(true)
    expect(prismaData(r.success ? r.data : {})).toEqual({ salaryCurrency: null })
  })

  it("salaryCurrency garbage rejected", () => {
    expect(parse({ salaryCurrency: "XYZ" }).success).toBe(false)
  })

  it("absent fields produce no prisma keys", () => {
    const r = parse({ companyName: "Acme" })
    expect(r.success).toBe(true)
    expect(prismaData(r.success ? r.data : {})).toEqual({})
  })

  it("create path still rejects empty jobType and ignores empty salary", () => {
    const c = createJobApplicationSchema.safeParse({
      companyName: "A",
      jobTitle: "B",
      jobType: "",
    })
    expect(c.success).toBe(false)
    const c2 = createJobApplicationSchema.safeParse({
      companyName: "A",
      jobTitle: "B",
      salaryMin: "",
    })
    expect(c2.success).toBe(true)
    expect(c2.success && c2.data.salaryMin).toBeUndefined()
  })

  it("create path accepts a salaryPeriod and rejects an unknown one", () => {
    const ok = createJobApplicationSchema.safeParse({
      companyName: "A",
      jobTitle: "B",
      salaryPeriod: "HOURLY",
    })
    expect(ok.success).toBe(true)
    expect(ok.success && ok.data.salaryPeriod).toBe("HOURLY")

    const bad = createJobApplicationSchema.safeParse({
      companyName: "A",
      jobTitle: "B",
      salaryPeriod: "FORTNIGHTLY",
    })
    expect(bad.success).toBe(false)
  })

  it("create path accepts a workType and rejects an unknown one", () => {
    const ok = createJobApplicationSchema.safeParse({
      companyName: "A",
      jobTitle: "B",
      workType: "REMOTE",
    })
    expect(ok.success).toBe(true)
    expect(ok.success && ok.data.workType).toBe("REMOTE")

    const bad = createJobApplicationSchema.safeParse({
      companyName: "A",
      jobTitle: "B",
      workType: "WFH",
    })
    expect(bad.success).toBe(false)
  })

  it("create path accepts every ISO currency and rejects an unknown one", () => {
    for (const code of ["PHP", "EUR", "GBP", "AUD", "CAD", "SGD", "JPY", "INR", "AED", "SAR", "NZD", "CHF"]) {
      const ok = createJobApplicationSchema.safeParse({
        companyName: "A",
        jobTitle: "B",
        salaryCurrency: code,
        salaryMin: "1000",
      })
      expect(ok.success, code).toBe(true)
    }

    const bad = createJobApplicationSchema.safeParse({
      companyName: "A",
      jobTitle: "B",
      salaryCurrency: "XYZ",
    })
    expect(bad.success).toBe(false)
  })
})
