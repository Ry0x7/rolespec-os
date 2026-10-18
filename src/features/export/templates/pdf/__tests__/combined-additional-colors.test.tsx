// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { ReactElement } from "react"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import { CombinedAdditionalSection } from "../primitives"
import { resolvePdfConfig } from "../customize"
import { DEFAULT_CUSTOMIZATION } from "@/features/resume/types/customization"

const TEMPLATES = ["MINIMAL", "MODERN", "HARVARD", "CORPORATE"] as const

/** The literal greys `CombinedAdditionalPreview` paints on every template. */
const SUB_LABEL = "#9ca3af" // text-gray-400
const BODY = "#374151" // text-gray-700
const ORG = "#4b5563" // text-gray-600
const META = "#6b7280" // text-gray-500

const skillsSection: Section = {
  id: "s-skills",
  resumeId: "r1",
  type: "SKILLS",
  title: "Skills",
  order: 1,
  visible: true,
  items: [
    {
      id: "i-skill",
      sectionId: "s-skills",
      content: { category: "Clinical", skills: ["Triage", "Charting"] },
      order: 0,
    },
  ],
}

const certSection: Section = {
  id: "s-certs",
  resumeId: "r1",
  type: "CERTIFICATIONS",
  title: "Certifications",
  order: 2,
  visible: true,
  items: [
    {
      id: "i-cert-1",
      sectionId: "s-certs",
      content: { name: "BLS Provider", organization: "AHA", dateObtained: "2024-06" },
      order: 0,
    },
    // Two undated ones under one organisation take the grouped branch (a dated
    // cert is "detailed" and never merges).
    {
      id: "i-cert-2",
      sectionId: "s-certs",
      content: { name: "CCRN", organization: "AACN" },
      order: 1,
    },
    {
      id: "i-cert-3",
      sectionId: "s-certs",
      content: { name: "PCCN", organization: "AACN" },
      order: 2,
    },
  ],
}

interface Node {
  props?: { style?: { color?: string } | { color?: string }[]; children?: unknown }
}

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit))
    return
  }
  if (!node || typeof node !== "object") return
  const el = node as Node
  visit(el)
  walk(el.props?.children, visit)
}

/** Every colour the block paints, and the concatenated text it renders. */
function render(template: string, accent: string = DEFAULT_CUSTOMIZATION.accent) {
  const config = resolvePdfConfig(template, { ...DEFAULT_CUSTOMIZATION, accent })
  const tree = CombinedAdditionalSection({
    skillsSection,
    certSection,
    title: "Additional Information",
    config,
  }) as ReactElement

  const colors = new Set<string>()
  let text = ""
  walk(tree, (node) => {
    const style = node.props?.style
    const styles = Array.isArray(style) ? style : [style]
    for (const entry of styles) {
      if (entry?.color) colors.add(entry.color.toLowerCase())
    }
    if (typeof node.props?.children === "string") text += node.props.children
  })
  return { colors, text }
}

describe("combined Skills + Certifications block colours", () => {
  // The block hardcodes greys in the preview, so the export may not tint it per
  // template — MODERN used to print these in its blue accent.
  it("paints the same greys on every template", () => {
    const expected = [...TEMPLATES].map((template) => [...render(template).colors].sort().join(","))
    expect(new Set(expected).size).toBe(1)
    expect(expected[0].split(",")).toEqual([BODY, ORG, SUB_LABEL, META].sort())
  })

  it("ignores a custom accent", () => {
    const accent = "#166534"
    for (const template of TEMPLATES) {
      expect(render(template, accent).colors.has(accent)).toBe(false)
    }
  })

  // The section heading above the block still follows the accent, as it does in
  // the preview — only the block's own text is literal.
  it("keeps the section heading on the accent", () => {
    const config = resolvePdfConfig("MINIMAL", { ...DEFAULT_CUSTOMIZATION, accent: "#166534" })
    expect(config.colors.heading).toBe("#166534")
  })

  // The preview prefixes each certification entry with a grey bullet.
  it("bullets every certification entry", () => {
    for (const template of TEMPLATES) {
      const { text } = render(template)
      expect(text.match(/•/g)?.length).toBe(2)
    }
  })
})
