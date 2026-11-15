import { describe, it, expect } from "vitest"
import {
  formatCertificationDateText,
  formatCertificationNames,
  groupCertificationsByOrg,
} from "../group-certifications"

function cert(id: string, content: Record<string, unknown>) {
  return { id, content }
}

describe("groupCertificationsByOrg", () => {
  it("groups certifications sharing an organization, preserving first-occurrence order", () => {
    const groups = groupCertificationsByOrg([
      cert("1", { name: "SAA", organization: "AWS" }),
      cert("2", { name: "CKA", organization: "CNCF" }),
      cert("3", { name: "SAP", organization: "aws" }),
    ])

    expect(groups.map((g) => g.organization)).toEqual(["AWS", "CNCF"])
    expect(groups[0].certs.map((c) => c.id)).toEqual(["1", "3"])
    expect(groups[1].certs.map((c) => c.id)).toEqual(["2"])
  })

  it("drops items with neither a name nor an organization", () => {
    const groups = groupCertificationsByOrg([
      cert("1", { dateObtained: "2020" }),
      cert("2", { name: "Solo" }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].certs[0].id).toBe("2")
  })

  it("never merges items without an organization", () => {
    const groups = groupCertificationsByOrg([
      cert("1", { name: "A", organization: "" }),
      cert("2", { name: "B" }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.organization === "")).toBe(true)
  })

  it("keeps a dated cert out of its organization group", () => {
    const groups = groupCertificationsByOrg([
      cert("1", { name: "A", organization: "AWS", dateObtained: "Aug 2024" }),
      cert("2", { name: "B", organization: "AWS", dateObtained: "2020" }),
      cert("3", { name: "C", organization: "AWS" }),
    ])

    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.certs.map((c) => c.id))).toEqual([["1"], ["2"], ["3"]])
    expect(groups[0].dateRange).toBe("Aug 2024")
    expect(groups[1].dateRange).toBe("2020")
    expect(groups[2].dateRange).toBeNull()
  })

  it("keeps a cert with only an expirationDate on its own", () => {
    const groups = groupCertificationsByOrg([
      cert("1", { name: "A", organization: "Org", expirationDate: "Jan 2030" }),
      cert("2", { name: "B", organization: "Org" }),
    ])

    expect(groups.map((g) => g.certs.map((c) => c.id))).toEqual([["1"], ["2"]])
    // No obtained date, so the group has no range — the row renders per-cert.
    expect(groups[0].dateRange).toBeNull()
  })

  it("keeps a cert with only a credentialId on its own", () => {
    const groups = groupCertificationsByOrg([
      cert("1", { name: "A", organization: "Org", credentialId: "ABC-1" }),
      cert("2", { name: "B", organization: "Org", credentialId: "ABC-2" }),
    ])

    expect(groups.map((g) => g.certs.map((c) => c.id))).toEqual([["1"], ["2"]])
    expect(groups.map((g) => g.certs[0].content.credentialId)).toEqual(["ABC-1", "ABC-2"])
  })

  it("treats blank detail fields as bare and still groups them", () => {
    const groups = groupCertificationsByOrg([
      cert("1", { name: "A", organization: "Org", dateObtained: "  ", credentialId: "" }),
      cert("2", { name: "B", organization: "Org", expirationDate: " " }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].certs.map((c) => c.id)).toEqual(["1", "2"])
  })

  it("groups bare certs around a detailed one, keeping first-occurrence order", () => {
    const groups = groupCertificationsByOrg([
      cert("1", { name: "A", organization: "Org" }),
      cert("2", { name: "B", organization: "Org", dateObtained: "Jan 2020" }),
      cert("3", { name: "C", organization: "Org" }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].certs.map((c) => c.id)).toEqual(["1", "3"])
    expect(groups[1].certs.map((c) => c.id)).toEqual(["2"])
  })

  it("returns a null date range when no cert has an obtained date", () => {
    const groups = groupCertificationsByOrg([
      cert("1", { name: "A", organization: "Org" }),
      cert("2", { name: "B", organization: "Org" }),
    ])

    expect(groups[0].dateRange).toBeNull()
  })

  it("normalizes and excludes unparseable dates from a singleton range", () => {
    const groups = groupCertificationsByOrg([
      cert("1", { name: "A", organization: "Org", dateObtained: "sometime soon" }),
      cert("2", { name: "B", organization: "Other", dateObtained: "2023-05" }),
    ])

    expect(groups[0].dateRange).toBeNull()
    expect(groups[1].dateRange).toBe("May 2023")
  })
})

describe("formatCertificationDateText", () => {
  it("joins obtained and expiration dates with an en dash", () => {
    expect(formatCertificationDateText({ dateObtained: "Jan 2020", expirationDate: "Jan 2030" })).toBe(
      "Jan 2020 – Jan 2030"
    )
  })

  it("returns the obtained date alone when there is no expiration", () => {
    expect(formatCertificationDateText({ dateObtained: "Jan 2020" })).toBe("Jan 2020")
  })

  it("labels an expiration-only cert", () => {
    expect(formatCertificationDateText({ expirationDate: "Jan 2030" })).toBe("Expires Jan 2030")
  })

  it("returns undefined when both dates are blank", () => {
    expect(formatCertificationDateText({ dateObtained: "  ", expirationDate: "" })).toBeUndefined()
  })

  it("applies the supplied formatter to both values", () => {
    expect(
      formatCertificationDateText(
        { dateObtained: "2020-01", expirationDate: "2030-01" },
        (value) => `<${value}>`
      )
    ).toBe("<2020-01> – <2030-01>")
  })
})

describe("formatCertificationNames", () => {
  it("appends credential IDs per cert", () => {
    // Built directly: a cert with a credentialId is never grouped anymore.
    expect(
      formatCertificationNames([
        { id: "1", content: { name: "A", organization: "Org", credentialId: "ABC-1" } },
        { id: "2", content: { name: "B", organization: "Org" } },
      ])
    ).toBe("A (ID: ABC-1), B")
  })

  it("falls back to a placeholder name", () => {
    const groups = groupCertificationsByOrg([
      cert("1", { organization: "Org" }),
      cert("2", { name: "B", organization: "Org" }),
    ])

    expect(formatCertificationNames(groups[0].certs)).toBe("Certification, B")
  })
})
