import { describe, it, expect } from "vitest"
import { updateJobApplicationSchema, createJobApplicationSchema } from "../job-application.schema"

function parse(entries: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return updateJobApplicationSchema.safeParse(Object.fromEntries(fd))
}

/** Mirrors the expression in updateJobApplication. */
function prismaData(parsed: Record<string, unknown>) {
  const { jobType, workType, salary, salaryPeriod, salaryCurrency } = parsed as {
    jobType?: string
    workType?: string
    salary?: number | ""
    salaryPeriod?: string
    salaryCurrency?: string
  }
  return {
    ...(jobType !== undefined ? { jobType: jobType || null } : {}),
    ...(workType !== undefined ? { workType: workType || null } : {}),
    ...(salary !== undefined ? { salary: salary === "" ? null : salary } : {}),
    ...(salaryPeriod !== undefined ? { salaryPeriod: salaryPeriod || null } : {}),
    ...(salaryCurrency ? { salaryCurrency } : {}),
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

  it("salary empty string maps to null", () => {
    const r = parse({ salary: "" })
    expect(r.success).toBe(true)
    expect(prismaData(r.success ? r.data : {})).toEqual({ salary: null })
  })

  it("salary number maps to int", () => {
    const r = parse({ salary: "85000" })
    expect(prismaData(r.success ? r.data : {})).toEqual({ salary: 85000 })
  })

  it("salary rejects zero / negative / non-numeric", () => {
    expect(parse({ salary: "0" }).success).toBe(false)
    expect(parse({ salary: "-5" }).success).toBe(false)
    expect(parse({ salary: "abc" }).success).toBe(false)
    expect(parse({ salary: "1.5" }).success).toBe(false)
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

  it("salaryPeriod garbage rejected", () => {
    expect(parse({ salaryPeriod: "WEEKLY" }).success).toBe(false)
  })

  it("salaryCurrency real value maps through", () => {
    const r = parse({ salaryCurrency: "PHP" })
    expect(r.success).toBe(true)
    expect(prismaData(r.success ? r.data : {})).toEqual({ salaryCurrency: "PHP" })
  })

  it("salaryCurrency empty string is no change, not a clear", () => {
    const r = parse({ salaryCurrency: "" })
    expect(r.success).toBe(true)
    expect(prismaData(r.success ? r.data : {})).toEqual({})
  })

  it("salaryCurrency garbage rejected", () => {
    expect(parse({ salaryCurrency: "EUR" }).success).toBe(false)
  })

  it("absent fields produce no prisma keys", () => {
    const r = parse({ companyName: "Acme" })
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
      salary: "",
    })
    expect(c2.success).toBe(true)
    expect(c2.success && c2.data.salary).toBeUndefined()
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
      salaryPeriod: "WEEKLY",
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

  it("create path accepts a salaryCurrency and rejects an unknown one", () => {
    const ok = createJobApplicationSchema.safeParse({
      companyName: "A",
      jobTitle: "B",
      salaryCurrency: "PHP",
    })
    expect(ok.success).toBe(true)
    expect(ok.success && ok.data.salaryCurrency).toBe("PHP")

    const bad = createJobApplicationSchema.safeParse({
      companyName: "A",
      jobTitle: "B",
      salaryCurrency: "EUR",
    })
    expect(bad.success).toBe(false)
  })
})
