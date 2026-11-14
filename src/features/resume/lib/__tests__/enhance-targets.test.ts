import { describe, it, expect } from "vitest"
import type { SectionType } from "@/generated/prisma/enums"
import { collectEnhanceTargets, skillsToText } from "../enhance-targets"
import type { Section, SectionItem } from "../../hooks/use-resume-store"
import {
  MAX_ENHANCE_JOB_DESCRIPTION_LENGTH,
  MAX_ENHANCE_LABEL_LENGTH,
  MAX_ENHANCE_TARGET_TEXT_LENGTH,
  MAX_ENHANCE_TARGETS,
} from "../../constants/enhance"

const makeSection = (
  id: string,
  type: SectionType,
  items: Array<Pick<SectionItem, "id" | "content">>
): Section => ({
  id,
  resumeId: "resume-1",
  type,
  title: id,
  order: 0,
  visible: true,
  items: items.map((item, index) => ({
    ...item,
    sectionId: id,
    metadata: null,
    order: index,
  })),
})

describe("collectEnhanceTargets", () => {
  it("mints '<sectionId>::<itemId>::summary' for the summary text", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-sum", "SUMMARY", [
        { id: "item-sum", content: { text: "  Engineer who ships.  " } },
      ]),
    ])

    expect(targets).toEqual([
      {
        targetId: "sec-sum::item-sum::summary",
        sectionId: "sec-sum",
        itemId: "item-sum",
        field: "summary",
        label: "Professional summary",
        text: "Engineer who ships.",
      },
    ])
  })

  it("skips a blank summary", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-sum", "SUMMARY", [{ id: "item-sum", content: { text: "   " } }]),
    ])

    expect(targets).toEqual([])
  })

  it("mints '<sectionId>::<itemId>::b<i>' per bullet and keeps the raw array index", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-exp", "EXPERIENCE", [
        {
          id: "item-exp",
          content: { role: "Engineer", company: "Acme", bullets: ["First", "Second"] },
        },
      ]),
    ])

    expect(targets.map((t) => t.targetId)).toEqual([
      "sec-exp::item-exp::b0",
      "sec-exp::item-exp::b1",
    ])
    expect(targets.map((t) => t.bulletIndex)).toEqual([0, 1])
    expect(targets.every((t) => t.field === "bullet")).toBe(true)
  })

  it("drops empty bullets but keeps the surviving ones on their original index", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-exp", "EXPERIENCE", [
        { id: "item-exp", content: { bullets: ["", "  ", "Real bullet", 42] } },
      ]),
    ])

    // The gap matters: bulletIndex has to address `content.bullets`, not the
    // filtered list, or Apply would write to the wrong slot.
    expect(targets).toHaveLength(1)
    expect(targets[0].targetId).toBe("sec-exp::item-exp::b2")
    expect(targets[0].bulletIndex).toBe(2)
    expect(targets[0].text).toBe("Real bullet")
  })

  it("builds experience and project labels, falling back when fields are blank", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-exp", "EXPERIENCE", [
        { id: "a", content: { role: "Engineer", company: "Acme", bullets: ["x"] } },
        { id: "b", content: { company: "Acme", bullets: ["x"] } },
        { id: "c", content: { bullets: ["x"] } },
      ]),
      makeSection("sec-proj", "PROJECTS", [
        { id: "d", content: { name: "RoleSpec", bullets: ["x"] } },
        { id: "e", content: { bullets: ["x"] } },
      ]),
    ])

    expect(targets.map((t) => t.label)).toEqual([
      "Experience — Engineer @ Acme",
      "Experience — Acme",
      "Experience — Untitled role",
      "Project — RoleSpec",
      "Project — Untitled project",
    ])
  })

  it("ignores sections and items that carry no rewritable text", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-edu", "EDUCATION", [{ id: "x", content: { school: "MIT" } }]),
      makeSection("sec-exp", "EXPERIENCE", [{ id: "y", content: { role: "No bullets key" } }]),
    ])

    expect(targets).toEqual([])
  })

  it("truncates oversized bullet text and labels to the server caps", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-exp", "EXPERIENCE", [
        {
          id: "item-exp",
          content: {
            role: "R".repeat(400),
            bullets: ["b".repeat(MAX_ENHANCE_TARGET_TEXT_LENGTH + 500)],
          },
        },
      ]),
      makeSection("sec-sum", "SUMMARY", [
        { id: "item-sum", content: { text: "s".repeat(MAX_ENHANCE_TARGET_TEXT_LENGTH + 500) } },
      ]),
    ])

    expect(targets[0].text).toHaveLength(MAX_ENHANCE_TARGET_TEXT_LENGTH)
    expect(targets[0].label).toHaveLength(MAX_ENHANCE_LABEL_LENGTH)
    expect(targets[1].text).toHaveLength(MAX_ENHANCE_TARGET_TEXT_LENGTH)
  })

  it("caps the list at MAX_ENHANCE_TARGETS", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-exp", "EXPERIENCE", [
        {
          id: "item-exp",
          content: {
            bullets: Array.from({ length: MAX_ENHANCE_TARGETS + 20 }, (_, i) => `bullet ${i}`),
          },
        },
      ]),
    ])

    expect(targets).toHaveLength(MAX_ENHANCE_TARGETS)
    expect(targets[MAX_ENHANCE_TARGETS - 1].bulletIndex).toBe(MAX_ENHANCE_TARGETS - 1)
  })

  it("mints '<sectionId>::<itemId>::skills' per skills category", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-skills", "SKILLS", [
        { id: "item-lang", content: { category: "Languages", skills: ["TypeScript", "Go"] } },
        { id: "item-tools", content: { category: "Tools", skills: ["Docker"] } },
      ]),
    ])

    expect(targets).toEqual([
      {
        targetId: "sec-skills::item-lang::skills",
        sectionId: "sec-skills",
        itemId: "item-lang",
        field: "skills",
        label: "Skills — Languages",
        text: "TypeScript, Go",
      },
      {
        targetId: "sec-skills::item-tools::skills",
        sectionId: "sec-skills",
        itemId: "item-tools",
        field: "skills",
        label: "Skills — Tools",
        text: "Docker",
      },
    ])
  })

  it("falls back to a generic skills label when the category is blank", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-skills", "SKILLS", [
        { id: "a", content: { category: "  ", skills: ["Rust"] } },
        { id: "b", content: { skills: ["Elixir"] } },
      ]),
    ])

    expect(targets.map((t) => t.label)).toEqual([
      "Skills — Untitled category",
      "Skills — Untitled category",
    ])
  })

  it("skips skills categories with nothing usable in them", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-skills", "SKILLS", [
        { id: "a", content: { category: "Empty", skills: [] } },
        { id: "b", content: { category: "Blanks", skills: ["", "   "] } },
        { id: "c", content: { category: "Missing" } },
        { id: "d", content: { category: "Wrong type", skills: "TypeScript" } },
      ]),
    ])

    expect(targets).toEqual([])
  })

  it("truncates an oversized skills list and category label to the server caps", () => {
    const targets = collectEnhanceTargets([
      makeSection("sec-skills", "SKILLS", [
        {
          id: "a",
          content: {
            category: "C".repeat(400),
            skills: Array.from({ length: 400 }, (_, i) => `skill-number-${i}`),
          },
        },
      ]),
    ])

    expect(targets[0].text).toHaveLength(MAX_ENHANCE_TARGET_TEXT_LENGTH)
    expect(targets[0].label).toHaveLength(MAX_ENHANCE_LABEL_LENGTH)
  })

  it("skillsToText joins trimmed, non-empty entries with a comma and space", () => {
    expect(skillsToText([" React ", "", "  ", "Node.js", 7])).toBe("React, Node.js")
    expect(skillsToText(undefined)).toBe("")
    expect(skillsToText("React")).toBe("")
  })

  it("keeps the shared caps in step with the enhance action's schema", () => {
    expect(MAX_ENHANCE_TARGETS).toBe(80)
    expect(MAX_ENHANCE_LABEL_LENGTH).toBe(200)
    expect(MAX_ENHANCE_TARGET_TEXT_LENGTH).toBe(2000)
    expect(MAX_ENHANCE_JOB_DESCRIPTION_LENGTH).toBe(5000)
  })
})
