import { describe, expect, it } from "vitest"
import { computeResumeDiff, skillsDiffStatus } from "../resume-diff.service"

describe("skillsDiffStatus", () => {
  it("does not call an identical list reordered", () => {
    expect(skillsDiffStatus(["TypeScript", "Go", "Mathematics"], ["TypeScript", "Go", "Mathematics"])).toBe(
      "unchanged"
    )
  })

  it("reports a true reorder", () => {
    expect(skillsDiffStatus(["TypeScript", "Go"], ["Go", "TypeScript"])).toBe("reordered")
  })

  it("reports a changed skill set as edited", () => {
    expect(skillsDiffStatus(["TypeScript", "Go"], ["TypeScript", "Kubernetes"])).toBe("edited")
  })
})

describe("computeResumeDiff", () => {
  it("identifies rewritten, removed, and unchanged bullets between source and tailored resumes", () => {
    const source = {
      id: "source-1",
      title: "Master Software Engineer",
      sections: [
        {
          type: "SUMMARY",
          title: "Summary",
          items: [{ content: { text: "General software engineer with full stack background." } }],
        },
        {
          type: "EXPERIENCE",
          title: "Experience",
          items: [
            {
              content: {
                role: "Senior Engineer",
                company: "Acme Corp",
                bullets: [
                  "Built internal tools with React and Node.",
                  "Reduced query times by 40% with database indexing.",
                  "Wrote documentation for legacy systems.",
                ],
              },
            },
          ],
        },
      ],
    }

    const tailored = {
      id: "tailored-1",
      title: "Tailored for Acme",
      sections: [
        {
          type: "SUMMARY",
          title: "Summary",
          items: [{ content: { text: "Full Stack Engineer specializing in React performance and Postgres optimization." } }],
        },
        {
          type: "EXPERIENCE",
          title: "Experience",
          items: [
            {
              content: {
                role: "Senior Engineer",
                company: "Acme Corp",
                bullets: [
                  "Architected scalable UI components with React and Node.",
                  "Reduced query times by 40% with database indexing.", // unchanged
                  // 3rd bullet removed
                ],
              },
            },
          ],
        },
      ],
    }

    const diff = computeResumeDiff(source, tailored)

    expect(diff.hasSource).toBe(true)
    expect(diff.summaryDiff?.status).toBe("rewritten")
    expect(diff.stats.rewrittenCount).toBe(2) // 1 in summary + 1 in experience bullet
    expect(diff.stats.unchangedCount).toBe(1)
    expect(diff.stats.removedCount).toBe(1)

    const expSection = diff.sections.find((s) => s.type === "EXPERIENCE")
    expect(expSection).toBeDefined()
    expect(expSection?.changes[0].status).toBe("rewritten")
    expect(expSection?.changes[1].status).toBe("unchanged")
    expect(expSection?.changes[2].status).toBe("removed")
  })

  it("reports a dropped role as removed instead of blaming the role that shifted up", () => {
    const source = {
      id: "source-1",
      title: "Master",
      sections: [
        {
          type: "EXPERIENCE",
          title: "Experience",
          items: [
            { content: { role: "Barista", company: "Cafe", bullets: ["Served coffee."] } },
            { content: { role: "Engineer", company: "Acme", bullets: ["Built APIs.", "Cut latency by 20%."] } },
          ],
        },
      ],
    }
    const tailored = {
      id: "tailored-1",
      title: "Tailored",
      sections: [
        {
          type: "EXPERIENCE",
          title: "Experience",
          items: [
            { content: { role: "Engineer", company: "Acme", bullets: ["Built APIs.", "Cut latency by 20%."] } },
          ],
        },
      ],
    }

    const diff = computeResumeDiff(source, tailored)

    expect(diff.stats.rewrittenCount).toBe(0)
    expect(diff.stats.removedCount).toBe(1)
    expect(diff.stats.unchangedCount).toBe(2)
    const changes = diff.sections[0].changes
    expect(changes.find((change) => change.original === "Served coffee.")?.status).toBe("removed")
    expect(changes.find((change) => change.original === "Built APIs.")?.status).toBe("unchanged")
  })

  it("separates a mid-list removal from the unchanged bullets after it", () => {
    const source = {
      id: "source-1",
      title: "Master",
      sections: [
        {
          type: "EXPERIENCE",
          title: "Experience",
          items: [
            {
              content: {
                role: "Engineer",
                company: "Acme",
                bullets: ["First bullet.", "Remove me.", "Third bullet."],
              },
            },
          ],
        },
      ],
    }
    const tailored = {
      id: "tailored-1",
      title: "Tailored",
      sections: [
        {
          type: "EXPERIENCE",
          title: "Experience",
          items: [
            { content: { role: "Engineer", company: "Acme", bullets: ["First bullet.", "Third bullet."] } },
          ],
        },
      ],
    }

    const status = computeResumeDiff(source, tailored).sections[0].changes.map((change) => change.status)
    expect(status).toEqual(["unchanged", "removed", "unchanged"])
  })
})
