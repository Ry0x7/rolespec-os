import { describe, expect, it } from "vitest"
import { computeResumeDiff } from "../resume-diff.service"

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
})
