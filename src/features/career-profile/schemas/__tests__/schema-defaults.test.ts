// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it, expect } from "vitest"

/**
 * Guards two schema decisions that are invisible from the TypeScript side but
 * change runtime behaviour, and that a future edit could quietly undo.
 */
const SCHEMA = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8")

function modelBody(name: string): string {
  const match = new RegExp(`\\nmodel ${name} \\{([\\s\\S]*?)\\n\\}`).exec(SCHEMA)
  if (!match) throw new Error(`model ${name} not found in prisma/schema.prisma`)
  return match[1]
}

describe("CareerProfile scalar lists", () => {
  const body = modelBody("CareerProfile")

  // Without an explicit `@default([])` the column is SQL NULL on insert. Prisma
  // reads that back as `[]`, which hides the problem, but list filters such as
  // `isEmpty` skip the row entirely.
  it.each(["locations", "workModes"])("declares an empty-array default on %s", (field) => {
    const line = body.split("\n").find((l) => l.trim().startsWith(`${field} `))

    expect(line, `${field} not found on CareerProfile`).toBeDefined()
    expect(line).toContain("[]")
    expect(line).toMatch(/@default\(\[\]\)/)
  })
})

describe("CareerEvidence provenance", () => {
  const body = modelBody("CareerEvidence")

  it("defaults status to CANDIDATE so nothing is pre-confirmed by omission", () => {
    expect(body).toMatch(/status\s+CareerEvidenceStatus\s+@default\(CANDIDATE\)/)
  })

  it("holds no resume foreign key, which the database could not scope to an owner", () => {
    expect(body).not.toMatch(/sourceResume/)
    expect(body).not.toMatch(/Resume/)
  })

  it("keeps the Resume model free of a career-evidence back-relation", () => {
    expect(modelBody("Resume")).not.toMatch(/CareerEvidence/)
  })
})
