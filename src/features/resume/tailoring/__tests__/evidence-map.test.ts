import { describe, expect, it } from "vitest"

import {
  extractRequirements,
  mapRequirements,
  profileEvidenceAtoms,
  resumeEvidenceAtoms,
  serializeEvidence,
} from "../evidence-map"
import type { ResumeSectionSnapshot } from "../types"

function sourceSections(): ResumeSectionSnapshot[] {
  return [
    {
      id: "sec-summary",
      type: "SUMMARY",
      title: "Summary",
      order: 0,
      visible: true,
      items: [
        {
          id: "item-summary",
          order: 0,
          content: { text: "Backend engineer focused on reliable TypeScript services." },
        },
      ],
    },
    {
      id: "sec-exp",
      type: "EXPERIENCE",
      title: "Experience",
      order: 1,
      visible: true,
      items: [
        {
          id: "item-exp",
          order: 0,
          metadata: { adapter: "resume-text", locator: "experience:1", kind: "EXPERIENCE" },
          content: {
            role: "Backend Engineer",
            company: "Acme",
            bullets: ["Built TypeScript APIs with PostgreSQL.", "Organized the office party."],
          },
        },
      ],
    },
    {
      id: "sec-skills",
      type: "SKILLS",
      title: "Skills",
      order: 2,
      visible: true,
      items: [
        {
          id: "item-skills",
          order: 0,
          content: { category: "Languages", skills: ["TypeScript", "SQL"] },
        },
      ],
    },
  ]
}

describe("resumeEvidenceAtoms", () => {
  it("emits one addressable atom per fact with stable refs", () => {
    const atoms = resumeEvidenceAtoms(sourceSections())
    const refs = atoms.map((atom) => atom.ref)

    expect(refs).toContain("sec:sec-exp/item:item-exp/bullets:0")
    expect(refs).toContain("sec:sec-skills/item:item-skills/skills:0")
    expect(refs).toContain("sec:sec-summary/item:item-summary/text")
    expect(atoms.find((atom) => atom.ref.endsWith("/bullets:0"))?.text).toBe(
      "Built TypeScript APIs with PostgreSQL."
    )
  })

  it("keeps provenance metadata and marks resume facts approved", () => {
    const bullet = resumeEvidenceAtoms(sourceSections()).find(
      (atom) => atom.ref === "sec:sec-exp/item:item-exp/bullets:0"
    )

    expect(bullet).toMatchObject({
      origin: "resume",
      approved: true,
      source: { adapter: "resume-text", locator: "experience:1", kind: "EXPERIENCE" },
    })
  })

  it("falls back to positional refs when ids are absent", () => {
    const atoms = resumeEvidenceAtoms([
      {
        type: "SUMMARY",
        title: "Summary",
        order: 0,
        visible: true,
        items: [{ order: 0, content: { text: "Engineer" } }],
      },
    ])

    expect(atoms[0]?.ref).toBe("sec:section-0/item:item-0-0/text")
  })
})

describe("profileEvidenceAtoms", () => {
  const rows = [
    {
      id: "ev-1",
      kind: "EXPERIENCE",
      title: "Led migration",
      details: "Moved billing to PostgreSQL.",
      outcome: "Cut costs",
      status: "CONFIRMED",
    },
    {
      id: "ev-2",
      kind: "PROJECT",
      title: "Unconfirmed project",
      details: "Should never be trusted yet.",
      status: "CANDIDATE",
    },
  ]

  it("includes only CONFIRMED evidence and labels its origin", () => {
    const atoms = profileEvidenceAtoms(rows, "profile-1")

    expect(atoms.some((atom) => atom.ref.startsWith("profile:profile-1/item:ev-1/"))).toBe(true)
    expect(atoms.some((atom) => atom.itemId === "ev-2")).toBe(false)
    expect(atoms.every((atom) => atom.origin === "profile" && atom.approved)).toBe(true)
  })
})

describe("extractRequirements", () => {
  it("puts the title first, then responsibilities, and assigns stable ids", () => {
    const requirements = extractRequirements(
      "Senior Backend Engineer",
      "Responsibilities:\n- Build TypeScript APIs.\n- Own PostgreSQL reliability.\n\nAbout us: we are a great place to work."
    )

    expect(requirements[0]).toEqual({
      text: "Senior Backend Engineer",
      kind: "TITLE",
    })
    expect(requirements.map((requirement) => requirement.text)).toContain(
      "Build TypeScript APIs."
    )
    expect(requirements.map((requirement) => requirement.text)).toContain(
      "Own PostgreSQL reliability."
    )
    expect(requirements.some((requirement) => /great place to work/i.test(requirement.text))).toBe(
      false
    )
  })

  it("deduplicates repeated sentences and ignores blank descriptions", () => {
    expect(extractRequirements("Engineer", null)).toEqual([
      { text: "Engineer", kind: "TITLE" },
    ])
    const requirements = extractRequirements(
      "Engineer",
      "Build APIs. Build APIs. Build APIs."
    )
    expect(requirements.filter((requirement) => requirement.text === "Build APIs.")).toHaveLength(1)
  })

  it("maps title and description requirements to req-1.. in order", () => {
    const mapped = mapRequirements({
      jobTitle: "Backend Engineer",
      jobDescription: "Build TypeScript APIs. Own PostgreSQL reliability.",
      atoms: resumeEvidenceAtoms(sourceSections()),
    })

    expect(mapped.map((entry) => entry.id)).toEqual(["req-1", "req-2", "req-3"])
    expect(mapped.map((entry) => entry.kind)).toEqual([
      "TITLE",
      "REQUIREMENT",
      "REQUIREMENT",
    ])
  })
})

describe("mapRequirements", () => {
  const atoms = resumeEvidenceAtoms(sourceSections())

  it("marks a requirement SUPPORTED when the resume backs its terms", () => {
    const [requirement] = mapRequirements({
      jobTitle: "TypeScript PostgreSQL",
      atoms,
    })

    expect(requirement?.verdict).toBe("SUPPORTED")
    expect(requirement?.matchedTerms).toEqual(expect.arrayContaining(["typescript", "postgresql"]))
    expect(requirement?.evidenceRefs.length).toBeGreaterThan(0)
    expect(requirement?.evidenceRefs[0]).toMatchObject({
      ref: expect.stringMatching(/^sec:/),
      origin: "resume",
    })
  })

  it("marks a requirement PARTIAL when only some terms are backed", () => {
    const [requirement] = mapRequirements({
      jobTitle: "Built Kubernetes Terraform AWS",
      atoms,
    })

    // One of four terms is backed: a fragment, not a claim.
    expect(requirement?.verdict).toBe("PARTIAL")
    expect(requirement?.matchedTerms).toEqual(["built"])
    expect(requirement?.matchedTerms).not.toContain("kubernetes")
  })

  it("marks a requirement UNSUPPORTED when nothing in the resume backs it", () => {
    const [requirement] = mapRequirements({
      jobTitle: "Kubernetes Terraform",
      atoms,
    })

    expect(requirement?.verdict).toBe("UNSUPPORTED")
    expect(requirement?.matchedTerms).toEqual([])
    expect(requirement?.evidenceRefs).toEqual([])
  })

  it("is deterministic for the same inputs", () => {
    const first = mapRequirements({
      jobTitle: "TypeScript PostgreSQL Kubernetes",
      atoms,
    })
    const second = mapRequirements({
      jobTitle: "TypeScript PostgreSQL Kubernetes",
      atoms,
    })

    expect(second).toEqual(first)
  })

  it("has no evidence at all when the profile has no atoms", () => {
    const [requirement] = mapRequirements({ jobTitle: "Backend Engineer", atoms: [] })

    expect(requirement?.verdict).toBe("UNSUPPORTED")
    expect(requirement?.evidenceRefs).toEqual([])
  })

  it("serializes evidence without duplicate lines and caps runaway input", () => {
    const serialized = serializeEvidence(atoms)
    expect(serialized).toContain("Skills — Languages: TypeScript")
    expect(serialized.split("\n").filter((line) => line === "Skills — Languages: TypeScript")).toHaveLength(1)

    const huge = Array.from({ length: 5000 }, (_, index) => ({
      ...atoms[0]!,
      ref: `ref-${index}`,
      text: `fact ${index} `.repeat(40),
    }))
    expect(serializeEvidence(huge).length).toBeLessThanOrEqual(120_000)
  })
})
