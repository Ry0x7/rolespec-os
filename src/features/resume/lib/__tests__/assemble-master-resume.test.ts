import { describe, expect, it } from "vitest"
import {
  assembleMasterResume,
  type CareerEvidenceKind,
  type MasterResumeEvidenceInput,
} from "../assemble-master-resume"

describe("assembleMasterResume", () => {
  it("maps confirmed factual evidence to the matching resume section shapes", () => {
    const sections = assembleMasterResume({
      evidence: [
        {
          kind: "EXPERIENCE",
          status: "CONFIRMED",
          title: "Staff Engineer",
          organization: "Acme",
          details: "Built the billing platform.",
          outcome: "Reduced reconciliation time by 40%.",
          startDate: new Date("2023-01-31T23:30:00-05:00"),
          endDate: null,
        },
        {
          kind: "EXPERIENCE",
          status: "CONFIRMED",
          title: "Engineer",
          organization: " ",
          details: " ",
          outcome: null,
          endDate: new Date("2022-12-01T00:00:00.000Z"),
        },
        {
          kind: "EDUCATION",
          status: "CONFIRMED",
          title: "BSc Computer Science",
          organization: "State University",
          startDate: new Date("2015-08-01T00:00:00.000Z"),
          endDate: new Date("2019-05-01T00:00:00.000Z"),
        },
        {
          kind: "EDUCATION",
          status: "CONFIRMED",
          title: "MSc Computer Science",
          startDate: new Date("2025-09-01T00:00:00.000Z"),
          endDate: null,
        },
        {
          kind: "PROJECT",
          status: "CONFIRMED",
          title: "Release Dashboard",
          organization: "https://not-a-project-link.example",
          details: "Created a deployment dashboard.",
          outcome: "Used by 12 teams.",
          startDate: new Date("2024-02-01T00:00:00.000Z"),
          endDate: new Date("2024-07-01T00:00:00.000Z"),
        },
        {
          kind: "PROJECT",
          status: "CONFIRMED",
          title: "Current Project",
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          endDate: null,
        },
        {
          kind: "CERTIFICATION",
          status: "CONFIRMED",
          title: "Cloud Architect",
          organization: "Cloud Guild",
          startDate: new Date("2025-06-01T00:00:00.000Z"),
          endDate: new Date("2028-06-01T00:00:00.000Z"),
        },
        {
          kind: "CERTIFICATION",
          status: "CONFIRMED",
          title: "End-only credential",
          startDate: null,
          endDate: new Date("2027-03-01T00:00:00.000Z"),
        },
      ],
    })

    expect(sections.map(({ type, title, order }) => ({ type, title, order }))).toEqual([
      { type: "CONTACT", title: "Contact", order: 0 },
      { type: "SUMMARY", title: "Summary", order: 1 },
      { type: "EXPERIENCE", title: "Experience", order: 2 },
      { type: "EDUCATION", title: "Education", order: 3 },
      { type: "SKILLS", title: "Skills", order: 4 },
      { type: "PROJECTS", title: "Projects", order: 5 },
      { type: "CERTIFICATIONS", title: "Certifications", order: 6 },
    ])
    expect(sections[0].items.create).toEqual([])
    expect(sections[1].items.create).toEqual([])
    expect(sections[2].items.create).toEqual([
      {
        content: {
          role: "Staff Engineer",
          company: "Acme",
          startDate: "Feb 2023",
          current: true,
          bullets: ["Built the billing platform.", "Reduced reconciliation time by 40%."],
        },
        order: 0,
      },
      {
        content: {
          role: "Engineer",
          endDate: "Dec 2022",
          current: false,
          bullets: [],
        },
        order: 1,
      },
    ])
    expect(sections[3].items.create[0].content).toEqual({
      degree: "MSc Computer Science",
      startDate: "Sep 2025",
      endDate: "Present",
    })
    expect(sections[3].items.create[1].content).toEqual({
      degree: "BSc Computer Science",
      school: "State University",
      startDate: "Aug 2015",
      endDate: "May 2019",
    })
    expect(sections[5].items.create[0].content).toEqual({
      name: "Current Project",
      startDate: "Jan 2026",
      endDate: "Present",
      bullets: [],
    })
    expect(sections[5].items.create[1].content).toEqual({
      name: "Release Dashboard",
      startDate: "Feb 2024",
      endDate: "Jul 2024",
      bullets: ["Created a deployment dashboard.", "Used by 12 teams."],
    })
    expect(sections[6].items.create[0].content).toEqual({
      name: "Cloud Architect",
      organization: "Cloud Guild",
      dateObtained: "Jun 2025",
      expirationDate: "Jun 2028",
    })
    expect(sections[6].items.create[1].content).toEqual({
      name: "End-only credential",
      expirationDate: "Mar 2027",
    })
  })

  it("splits prose details into separate bullets and appends the outcome unsplit", () => {
    const sections = assembleMasterResume({
      evidence: [
        {
          kind: "EXPERIENCE",
          status: "CONFIRMED",
          title: "Charge Nurse",
          organization: "General Hospital",
          details:
            "Led a unit of 14 nurses. Rebuilt the triage workflow. Trained every new hire on the escalation policy.",
          outcome: "Cut average wait time by 35%. Sustained for four quarters.",
          startDate: new Date("2021-03-01T00:00:00.000Z"),
          endDate: null,
        },
        {
          kind: "PROJECT",
          status: "CONFIRMED",
          title: "Handoff Tool",
          details: "• Designed the shift handoff form\n- Rolled it out to three units",
          outcome: null,
        },
      ],
    })

    expect(sections[2].items.create[0].content.bullets).toEqual([
      "Led a unit of 14 nurses.",
      "Rebuilt the triage workflow.",
      "Trained every new hire on the escalation policy.",
      "Cut average wait time by 35%. Sustained for four quarters.",
    ])
    expect(sections[5].items.create[0].content.bullets).toEqual([
      "Designed the shift handoff form",
      "Rolled it out to three units",
    ])
  })

  it("excludes candidate, archived, and unconfirmed profile data", () => {
    const sections = assembleMasterResume({
      evidence: [
        { kind: "EXPERIENCE", status: "CANDIDATE", title: "Candidate role" },
        { kind: "PROJECT", status: "ARCHIVED", title: "Archived project" },
        { kind: "ACHIEVEMENT", status: "CANDIDATE", title: "Candidate achievement" },
      ],
      capabilities: [
        { name: "Confirmed skill", category: "Tools", confirmed: true },
        { name: "Unconfirmed skill", category: "Tools", confirmed: false },
      ],
    })

    expect(sections.map((section) => section.type)).toEqual([
      "CONTACT",
      "SUMMARY",
      "EXPERIENCE",
      "EDUCATION",
      "SKILLS",
    ])
    expect(sections[2].items.create).toEqual([])
    expect(sections[4].items.create).toEqual([
      { content: { category: "Tools", skills: ["Confirmed skill"] }, order: 0 },
    ])
  })

  it("keeps achievements separate and concatenates only their present factual fields", () => {
    const sections = assembleMasterResume({
      evidence: [
        {
          kind: "ACHIEVEMENT",
          status: "CONFIRMED",
          title: "Accessibility award",
          organization: "Industry Association",
          startDate: new Date("2025-03-01T00:00:00.000Z"),
          endDate: new Date("2025-04-01T00:00:00.000Z"),
          details: "Recognized for an accessible checkout.",
          outcome: "Selected from 80 entries.",
        },
        {
          kind: "ACHIEVEMENT",
          status: "CONFIRMED",
          title: "Published migration guide",
          organization: " ",
          details: null,
          outcome: "Adopted across the engineering group.",
        },
        {
          kind: "ACHIEVEMENT",
          status: "CONFIRMED",
          title: "Solo distinction",
        },
      ],
    })

    expect(sections[2].items.create).toEqual([])
    expect(sections.at(-1)).toEqual({
      type: "CUSTOM",
      title: "Achievements",
      order: 5,
      visible: true,
      items: {
        create: [
          {
            content: {
              title: "Accessibility award",
              content: [
                "Industry Association",
                "Mar 2025 – Apr 2025",
                "Recognized for an accessible checkout.",
                "Selected from 80 entries.",
              ].join("\n"),
            },
            order: 0,
          },
          {
            content: {
              title: "Published migration guide",
              content: "Adopted across the engineering group.",
            },
            order: 1,
          },
          {
            content: { title: "Solo distinction" },
            order: 2,
          },
        ],
      },
    })
  })

  it("sorts confirmed skills alphabetically within deterministic explicit-category groups", () => {
    const sections = assembleMasterResume({
      capabilities: [
        { name: "TypeScript", category: "Languages", confirmed: true },
        { name: "Azure", category: null, confirmed: true },
        { name: "Docker", category: "Tools", confirmed: true },
        { name: "JavaScript", category: "Languages", confirmed: true },
        { name: "AWS", category: "", confirmed: true },
      ],
    })

    expect(sections[4].items.create).toEqual([
      {
        content: { category: "Languages", skills: ["JavaScript", "TypeScript"] },
        order: 0,
      },
      { content: { category: "Skills", skills: ["AWS", "Azure"] }, order: 1 },
      { content: { category: "Tools", skills: ["Docker"] }, order: 2 },
    ])
  })

  it("canonically sorts every evidence section without mutating shuffled input", () => {
    const kinds: CareerEvidenceKind[] = [
      "EXPERIENCE",
      "EDUCATION",
      "PROJECT",
      "CERTIFICATION",
      "ACHIEVEMENT",
    ]
    const evidence: MasterResumeEvidenceInput[] = kinds.flatMap((kind) => [
      { kind, status: "CONFIRMED", title: `${kind} Undated` },
      {
        kind,
        status: "CONFIRMED",
        title: "zeta",
        organization: "Beta Org",
        endDate: new Date("2024-06-01T00:00:00.000Z"),
      },
      {
        kind,
        status: "CONFIRMED",
        title: "Alpha",
        organization: "Zulu Org",
        endDate: new Date("2024-06-01T00:00:00.000Z"),
      },
      {
        kind,
        status: "CONFIRMED",
        title: " alpha ",
        organization: "Alpha Org",
        endDate: new Date("2024-06-01T00:00:00.000Z"),
      },
      {
        kind,
        status: "CONFIRMED",
        title: "Recent",
        endDate: new Date("2025-01-01T00:00:00.000Z"),
      },
      {
        kind,
        status: "CONFIRMED",
        title: "Current",
        startDate: new Date("2020-01-01T00:00:00.000Z"),
        endDate: null,
      },
    ])
    const originalOrder = [...evidence]
    const expected = ["Current", "Recent", " alpha ", "Alpha", "zeta"]
    const assembled = assembleMasterResume({ evidence })

    expect(evidence).toStrictEqual(originalOrder)
    expect(assembled[2].items.create.map((item) => item.content.role)).toEqual([
      ...expected,
      "EXPERIENCE Undated",
    ])
    expect(assembled[2].items.create.at(-1)?.content).toMatchObject({
      role: "EXPERIENCE Undated",
      current: false,
    })
    expect(assembled[3].items.create.map((item) => item.content.degree)).toEqual([
      ...expected,
      "EDUCATION Undated",
    ])
    expect(assembled[5].items.create.map((item) => item.content.name)).toEqual([
      ...expected,
      "PROJECT Undated",
    ])
    expect(assembled[6].items.create.map((item) => item.content.name)).toEqual([
      ...expected,
      "CERTIFICATION Undated",
    ])
    expect(assembled[7].items.create.map((item) => item.content.title)).toEqual([
      ...expected,
      "ACHIEVEMENT Undated",
    ])

    const reshuffled = assembleMasterResume({ evidence: [...evidence].reverse() })
    expect(reshuffled).toEqual(assembled)
  })

  it("uses a stable structural tie-breaker when normalized title and organization tie", () => {
    const tied: MasterResumeEvidenceInput[] = [
      {
        kind: "PROJECT",
        status: "CONFIRMED",
        title: "Same Project",
        organization: "Same Org",
        details: "Zulu detail",
        endDate: new Date("2025-02-01T00:00:00.000Z"),
      },
      {
        kind: "PROJECT",
        status: "CONFIRMED",
        title: "Same Project",
        organization: "Same Org",
        details: "Alpha detail",
        endDate: new Date("2025-02-01T00:00:00.000Z"),
      },
    ]

    const forward = assembleMasterResume({ evidence: tied })[5].items.create
    const reversed = assembleMasterResume({ evidence: [...tied].reverse() })[5].items.create

    expect(forward.map((item) => item.content.bullets)).toEqual([
      ["Alpha detail"],
      ["Zulu detail"],
    ])
    expect(reversed).toEqual(forward)
  })

  it("creates all standard empty sections for a missing profile", () => {
    expect(assembleMasterResume(null)).toEqual([
      { type: "CONTACT", title: "Contact", order: 0, visible: true, items: { create: [] } },
      { type: "SUMMARY", title: "Summary", order: 1, visible: true, items: { create: [] } },
      {
        type: "EXPERIENCE",
        title: "Experience",
        order: 2,
        visible: true,
        items: { create: [] },
      },
      {
        type: "EDUCATION",
        title: "Education",
        order: 3,
        visible: true,
        items: { create: [] },
      },
      { type: "SKILLS", title: "Skills", order: 4, visible: true, items: { create: [] } },
    ])
  })

  it("pre-fills the contact item in the shape the contact editor writes", () => {
    const [contact] = assembleMasterResume(
      { targetRoleTitles: ["Operations Manager", "Paused direction"] },
      {
        userName: "  Ada Lovelace  ",
        userEmail: "ada@example.com",
        contactPhone: "  +234 800 000 0000  ",
        contactLocation: "  Lagos, Nigeria  ",
      }
    )

    expect(contact).toEqual({
      type: "CONTACT",
      title: "Contact",
      order: 0,
      visible: true,
      items: {
        create: [
          {
            content: {
              fullName: "Ada Lovelace",
              jobTitle: "Operations Manager",
              email: "ada@example.com",
              phone: "+234 800 000 0000",
              location: "Lagos, Nigeria",
              linkedin: "",
              github: "",
              website: "",
            },
            order: 0,
          },
        ],
      },
    })
  })

  it("prefers the career profile contact details over the account", () => {
    const [contact] = assembleMasterResume(
      { targetRoleTitles: ["Operations Manager"] },
      {
        userName: "Account Name",
        userEmail: "sign-in@example.com",
        contactFullName: "Ada Lovelace",
        contactEmail: "hire-me@example.com",
        contactPhone: "+234 800 000 0000",
        contactLocation: "Lagos, Nigeria",
        linkedinUrl: "https://linkedin.com/in/ada",
        githubUrl: "https://github.com/ada",
        websiteUrl: "https://ada.example.com",
      }
    )

    expect(contact.items.create[0].content).toEqual({
      fullName: "Ada Lovelace",
      jobTitle: "Operations Manager",
      email: "hire-me@example.com",
      phone: "+234 800 000 0000",
      location: "Lagos, Nigeria",
      linkedin: "https://linkedin.com/in/ada",
      github: "https://github.com/ada",
      website: "https://ada.example.com",
    })
  })

  it("falls back to the account name and email when the career contacts are blank", () => {
    const [contact] = assembleMasterResume(
      { targetRoleTitles: [] },
      {
        userName: "Ada Lovelace",
        userEmail: "sign-in@example.com",
        contactFullName: "   ",
        contactEmail: null,
      }
    )

    expect(contact.items.create[0].content).toMatchObject({
      fullName: "Ada Lovelace",
      email: "sign-in@example.com",
    })
  })

  it("never falls back to the preferred locations for the contact location", () => {
    const [contact] = assembleMasterResume(
      { targetRoleTitles: [] },
      { userName: "Ada Lovelace", userEmail: "ada@example.com", contactLocation: null }
    )

    expect(contact.items.create[0].content.location).toBe("")
  })

  it("fills only what is known and never invents a contact field", () => {
    const [contact] = assembleMasterResume(
      { targetRoleTitles: [] },
      { userName: null, userEmail: "ada@example.com" }
    )

    expect(contact.items.create[0].content).toEqual({
      fullName: "",
      jobTitle: "",
      email: "ada@example.com",
      phone: "",
      location: "",
      linkedin: "",
      github: "",
      website: "",
    })
  })

  it("creates no contact item when neither a name nor an email is known", () => {
    const sections = assembleMasterResume(
      { targetRoleTitles: ["Operations Manager"] },
      {
        userName: "   ",
        userEmail: null,
        contactFullName: null,
        contactEmail: "",
        // A location on its own is not enough to justify a contact block.
        contactLocation: "Lagos, Nigeria",
      }
    )

    expect(sections[0]).toEqual({
      type: "CONTACT",
      title: "Contact",
      order: 0,
      visible: true,
      items: { create: [] },
    })
  })

  it("leaves the other sections untouched when contact data is supplied", () => {
    const withoutAccount = assembleMasterResume({
      capabilities: [{ name: "TypeScript", category: "Languages", confirmed: true }],
      evidence: [
        {
          kind: "EXPERIENCE",
          status: "CONFIRMED",
          title: "Engineer",
          organization: "Acme",
          details: "Built APIs.",
          startDate: new Date("2022-01-01T00:00:00.000Z"),
          endDate: null,
        },
      ],
    })
    const withAccount = assembleMasterResume(
      {
        capabilities: [{ name: "TypeScript", category: "Languages", confirmed: true }],
        evidence: [
          {
            kind: "EXPERIENCE",
            status: "CONFIRMED",
            title: "Engineer",
            organization: "Acme",
            details: "Built APIs.",
            startDate: new Date("2022-01-01T00:00:00.000Z"),
            endDate: null,
          },
        ],
        targetRoleTitles: ["Operations Manager"],
      },
      { userName: "Ada Lovelace", userEmail: "ada@example.com" }
    )

    expect(withAccount.slice(1)).toEqual(withoutAccount.slice(1))
  })
})
