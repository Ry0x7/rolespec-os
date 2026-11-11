// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  buildSourceSnapshot,
  canonicalJson,
  hashSections,
  hashSourceSnapshot,
  parseSourceSnapshot,
  restoreSectionsFromSnapshot,
} from "../snapshot"

const SOURCE = {
  id: "resume-1",
  version: 7,
  title: "Backend resume",
  template: "MODERN",
  targetRole: "Backend Engineer",
  targetCompany: null,
  sections: [
    {
      id: "section-1",
      type: "EXPERIENCE",
      title: "Experience",
      order: 0,
      visible: true,
      items: [
        {
          id: "item-1",
          content: {
            role: "Backend Engineer",
            company: "Acme",
            bullets: ["Built TypeScript APIs.", "Cut latency by 20%."],
          },
          metadata: { evidenceKind: "EXPERIENCE", confirmed: true },
          order: 0,
        },
      ],
    },
  ],
}

describe("source snapshots", () => {
  it("captures the source version and content, not the live row identity alone", () => {
    const snapshot = buildSourceSnapshot(SOURCE, new Date("2026-11-11T00:00:00.000Z"))

    expect(snapshot).toMatchObject({
      sourceResumeId: "resume-1",
      sourceVersion: 7,
      title: "Backend resume",
      template: "MODERN",
      capturedAt: "2026-11-11T00:00:00.000Z",
    })
    expect(snapshot.sections[0].items[0].content).toEqual(SOURCE.sections[0].items[0].content)
  })

  it("hashes canonically, independent of object key order", () => {
    const left = hashSourceSnapshot(
      buildSourceSnapshot(SOURCE, new Date("2026-11-11T00:00:00.000Z"))
    )
    const reordered = {
      ...SOURCE,
      sections: [
        {
          ...SOURCE.sections[0],
          items: [
            {
              ...SOURCE.sections[0].items[0],
              content: {
                bullets: ["Built TypeScript APIs.", "Cut latency by 20%."],
                company: "Acme",
                role: "Backend Engineer",
              },
            },
          ],
        },
      ],
    }
    const right = hashSourceSnapshot(
      buildSourceSnapshot(reordered, new Date("2026-11-11T00:00:00.000Z"))
    )

    expect(left).toBe(right)
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it("changes the hash when the captured revision changes", () => {
    const first = hashSourceSnapshot(
      buildSourceSnapshot(SOURCE, new Date("2026-11-11T00:00:00.000Z"))
    )
    const edited = {
      ...SOURCE,
      version: 8,
      sections: [
        {
          ...SOURCE.sections[0],
          items: [
            {
              ...SOURCE.sections[0].items[0],
              content: {
                ...SOURCE.sections[0].items[0].content,
                bullets: ["Built TypeScript APIs at scale.", "Cut latency by 20%."],
              },
            },
          ],
        },
      ],
    }
    const second = hashSourceSnapshot(
      buildSourceSnapshot(edited, new Date("2026-11-11T00:00:00.000Z"))
    )

    expect(second).not.toBe(first)
  })

  it("restores exact content but never reuses source row ids", () => {
    const snapshot = buildSourceSnapshot(SOURCE, new Date("2026-11-11T00:00:00.000Z"))
    const restored = restoreSectionsFromSnapshot(snapshot)

    expect(restored[0].items[0].content).toEqual(SOURCE.sections[0].items[0].content)
    expect(restored[0].id).toBeUndefined()
    expect(restored[0].items[0].id).toBeUndefined()
  })

  it("rejects malformed stored payloads instead of guessing", () => {
    expect(parseSourceSnapshot(null)).toBeNull()
    expect(parseSourceSnapshot({ sourceResumeId: "x" })).toBeNull()
    expect(parseSourceSnapshot({ ...buildSourceSnapshot(SOURCE) })).not.toBeNull()
  })

  it("hashes sections without ids so an edit history ignores temp ids", () => {
    const withIds = hashSections(SOURCE.sections)
    const withoutIds = hashSections(
      SOURCE.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => ({ ...item, id: undefined })),
        id: undefined,
      }))
    )

    expect(withIds).toBe(withoutIds)
  })
})
