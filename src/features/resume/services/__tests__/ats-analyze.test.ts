import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/shared/lib/ai-generate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/ai-generate")>()),
  generateObjectTracked: vi.fn(),
}))

import { generateObjectTracked } from "@/shared/lib/ai-generate"
import {
  analyzeResumeATS,
  computeOverallScore,
  ATS_SCORE_WEIGHTS,
  QUALITY_SCORE_WEIGHTS,
  type ATSAnalysisResult,
} from "../ats-analyze"
import type { Section } from "../../hooks/use-resume-store"

const mockedGenerateObject = vi.mocked(generateObjectTracked)

const USER_ID = "user-1"
const JOB_DESCRIPTION = "Own the payments platform. Kubernetes required."

/** Job-match is the mode every pre-existing case here exercises. */
const jobMatch = {
  userId: USER_ID,
  jobDescription: JOB_DESCRIPTION,
  mode: "job-match",
} as const

const analysis: ATSAnalysisResult = {
  overallScore: 75,
  scores: { formatting: 80, keywords: 70, impact: 75, completeness: 90, readability: 85 },
  issues: [],
  suggestions: [],
  missingKeywords: [],
  mode: "job-match",
}

function makeSection(overrides: Partial<Section>): Section {
  return {
    id: "s1",
    resumeId: "r1",
    type: "SUMMARY",
    title: "Summary",
    order: 0,
    visible: true,
    items: [],
    ...overrides,
  }
}

function capturedPrompt(): string {
  const args = mockedGenerateObject.mock.calls[0][0] as { prompt: string }
  return args.prompt
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedGenerateObject.mockResolvedValue({ object: analysis } as never)
})

describe("analyzeResumeATS serialization", () => {
  it("includes project url, url label, and dates in the prompt", async () => {
    const sections: Section[] = [
      makeSection({
        type: "PROJECTS",
        title: "Projects",
        items: [
          {
            id: "i1",
            sectionId: "s1",
            order: 0,
            content: {
              name: "RoleSpec",
              bullets: ["Built an AI career OS"],
              technologies: ["Next.js", "Prisma"],
              url: "https://github.com/user/rolespec",
              urlLabel: "GitHub repo",
              startDate: "Jan 2025",
              endDate: "Mar 2026",
            },
          },
        ],
      }),
    ]

    const result = await analyzeResumeATS(sections, jobMatch)

    // overallScore is recomputed from the sub-scores; everything else is the
    // model's object verbatim, except `issues`, which the deterministic parse
    // checks prepend to (covered separately below).
    expect(result).toEqual({
      ...analysis,
      overallScore: 77,
      issues: expect.any(Array),
    })
    expect(result.suggestions).toEqual([])
    const prompt = capturedPrompt()
    expect(prompt).toContain("RoleSpec (Jan 2025 - Mar 2026)")
    expect(prompt).toContain("Link: GitHub repo (https://github.com/user/rolespec)")
    expect(prompt).toContain("- Built an AI career OS")
    expect(prompt).toContain("Technologies: Next.js, Prisma")
  })

  it("omits the link line when a project has no url", async () => {
    const sections: Section[] = [
      makeSection({
        type: "PROJECTS",
        title: "Projects",
        items: [
          {
            id: "i1",
            sectionId: "s1",
            order: 0,
            content: { name: "RoleSpec", bullets: ["Built an AI career OS"] },
          },
        ],
      }),
    ]

    await analyzeResumeATS(sections, jobMatch)

    const prompt = capturedPrompt()
    expect(prompt).toContain("RoleSpec")
    expect(prompt).not.toContain("Link:")
  })

  it("still includes contact links in the prompt", async () => {
    const sections: Section[] = [
      makeSection({
        type: "CONTACT",
        title: "Contact",
        items: [
          {
            id: "i1",
            sectionId: "s1",
            order: 0,
            content: {
              fullName: "Ada Lovelace",
              linkedin: "https://linkedin.com/in/ada",
              github: "https://github.com/ada",
              website: "https://ada.dev",
            },
          },
        ],
      }),
    ]

    await analyzeResumeATS(sections, jobMatch)

    const prompt = capturedPrompt()
    expect(prompt).toContain("LinkedIn: https://linkedin.com/in/ada")
    expect(prompt).toContain("GitHub: https://github.com/ada")
    expect(prompt).toContain("Website: https://ada.dev")
  })
})

describe("analyzeResumeATS deterministic parse checks", () => {
  it("prepends the deterministic parse issues to the model's issues", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: {
        ...analysis,
        issues: [
          {
            severity: "warning",
            category: "Keywords",
            message: "Missing patient scheduling",
            section: "Skills",
            suggestion: "Add patient scheduling",
          },
        ],
      },
    } as never)

    // No contact, experience or skills section — three deterministic findings.
    const result = await analyzeResumeATS([], jobMatch)

    expect(result.issues.map((i) => i.message)).toEqual([
      expect.stringContaining("No contact section"),
      expect.stringContaining("No work experience section"),
      expect.stringContaining("No skills section"),
      "Missing patient scheduling",
    ])
  })

  it("emits no deterministic issues for a parseable resume", async () => {
    const sections: Section[] = [
      makeSection({
        id: "s1",
        type: "CONTACT",
        title: "Contact",
        items: [
          {
            id: "i1",
            sectionId: "s1",
            order: 0,
            content: { fullName: "Ada", email: "ada@example.com", phone: "555" },
          },
        ],
      }),
      makeSection({
        id: "s2",
        type: "EXPERIENCE",
        title: "Work Experience",
        order: 1,
        items: [
          {
            id: "i2",
            sectionId: "s2",
            order: 0,
            content: { role: "Engineer", company: "Acme", startDate: "Jan 2024", current: true },
          },
        ],
      }),
      makeSection({
        id: "s3",
        type: "SKILLS",
        title: "Skills",
        order: 2,
        items: [{ id: "i3", sectionId: "s3", order: 0, content: { skills: ["TypeScript"] } }],
      }),
    ]

    const result = await analyzeResumeATS(sections, jobMatch)

    expect(result.issues).toEqual([])
  })
})

describe("computeOverallScore", () => {
  it("applies the documented 30/30/20/10/10 weighting", () => {
    expect(ATS_SCORE_WEIGHTS).toEqual({
      keywords: 0.3,
      impact: 0.3,
      formatting: 0.2,
      completeness: 0.1,
      readability: 0.1,
    })
    // 70*.3 + 75*.3 + 80*.2 + 90*.1 + 85*.1 = 77
    expect(computeOverallScore(analysis.scores)).toBe(77)
  })

  it("rounds to a whole number", () => {
    // 61*.3 + 62*.3 + 63*.2 + 64*.1 + 65*.1 = 62.4
    expect(
      computeOverallScore({
        keywords: 61,
        impact: 62,
        formatting: 63,
        completeness: 64,
        readability: 65,
      })
    ).toBe(62)
  })

  it("clamps out-of-range sub-scores to 0-100", () => {
    expect(
      computeOverallScore({
        keywords: 500,
        impact: 500,
        formatting: 500,
        completeness: 500,
        readability: 500,
      })
    ).toBe(100)
    expect(
      computeOverallScore({
        keywords: -50,
        impact: -50,
        formatting: -50,
        completeness: -50,
        readability: -50,
      })
    ).toBe(0)
  })
})

describe("analyzeResumeATS score weighting", () => {
  it("discards the model's overallScore and recomputes it from the sub-scores", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: {
        ...analysis,
        // The model claims 99 while its own sub-scores average to 77.
        overallScore: 99,
      },
    } as never)

    const result = await analyzeResumeATS([], jobMatch)

    expect(result.overallScore).toBe(77)
    expect(result.scores).toEqual(analysis.scores)
  })

  it("recomputes low scores too, rather than trusting a flattering number", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: {
        ...analysis,
        overallScore: 90,
        scores: {
          formatting: 40,
          keywords: 20,
          impact: 10,
          completeness: 50,
          readability: 60,
        },
      },
    } as never)

    const result = await analyzeResumeATS([], jobMatch)

    // 20*.3 + 10*.3 + 40*.2 + 50*.1 + 60*.1 = 28
    expect(result.overallScore).toBe(28)
  })
})

describe("analyzeResumeATS quality mode", () => {
  const quality = { userId: USER_ID, mode: "quality" } as const

  it("marks the result as a quality run", async () => {
    const result = await analyzeResumeATS([], quality)

    expect(result.mode).toBe("quality")
  })

  it("drops missingKeywords even when the model returns some", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: { ...analysis, missingKeywords: ["Kubernetes", "Terraform"] },
    } as never)

    const result = await analyzeResumeATS([], quality)

    expect(result.missingKeywords).toEqual([])
  })

  it("nulls the keyword sub-score the model emitted", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: { ...analysis, scores: { ...analysis.scores, keywords: 50 } },
    } as never)

    const result = await analyzeResumeATS([], quality)

    // The prompt asks for a placeholder 50; a stored 50 would read as a real
    // keyword score to anything that loads the row later.
    expect(result.scores.keywords).toBeNull()
    // The job-independent sub-scores are untouched.
    expect(result.scores.impact).toBe(analysis.scores.impact)
  })

  it("keeps the numeric keyword sub-score in job-match mode", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: { ...analysis, scores: { ...analysis.scores, keywords: 50 } },
    } as never)

    const result = await analyzeResumeATS([], jobMatch)

    expect(result.scores.keywords).toBe(50)
  })

  it("weights the overall score without keywords", async () => {
    const result = await analyzeResumeATS([], quality)

    // Quality weighting of the fixture's sub-scores:
    // 75*.35 + 85*.25 + 80*.2 + 90*.2 = 81.5 -> 82. Job-match would give 77.
    expect(result.overallScore).toBe(82)
  })

  it("tells the model there is no target job and not to chase keywords", async () => {
    await analyzeResumeATS([], quality)

    const system = (mockedGenerateObject.mock.calls[0][0] as { system: string }).system
    expect(system).toContain("NO TARGET JOB")
    expect(system).toContain("Do NOT penalize the resume for missing keywords")
    expect(system).toContain("scores.keywords is ignored entirely")
    expect(system).not.toContain("KEYWORDS: real ATSes do exact")
  })

  it("gates the software-specific project guidance behind an explicit condition", async () => {
    await analyzeResumeATS([], quality)

    const system = (mockedGenerateObject.mock.calls[0][0] as { system: string }).system
    const leadIn =
      "ONLY IF the resume evidently targets a software or technical career"
    expect(system).toContain(leadIn)
    // The repo/demo-link deduction must never be reachable as a default: it
    // only appears after the conditional lead-in.
    expect(system.indexOf(leadIn)).toBeGreaterThan(-1)
    expect(system.indexOf(leadIn)).toBeLessThan(system.indexOf("GitHub link"))
  })

  it("tells the model to judge other fields by their own project norms", async () => {
    await analyzeResumeATS([], quality)

    const system = (mockedGenerateObject.mock.calls[0][0] as { system: string }).system
    expect(system).toContain(
      "In every other field, judge project and portfolio evidence by that field's OWN norms"
    )
    expect(system).toContain(
      "NEVER deduct for a missing repository, demo or portfolio link"
    )
    // The old unconditional-then-negated phrasing is gone, so the exclusion is
    // stated exactly once.
    expect(system).not.toContain("Never apply this deduction to non-technical careers")
  })

  it("keeps the job description out of the prompt even if one is passed", async () => {
    await analyzeResumeATS([], { ...quality, jobDescription: JOB_DESCRIPTION })

    expect(capturedPrompt()).not.toContain("Kubernetes required")
  })

  it("keeps the deterministic parse issues", async () => {
    const result = await analyzeResumeATS([], quality)

    expect(result.issues.map((i) => i.message)).toEqual([
      expect.stringContaining("No contact section"),
      expect.stringContaining("No work experience section"),
      expect.stringContaining("No skills section"),
    ])
  })

  it("refuses a job-match run with no job description", async () => {
    await expect(
      analyzeResumeATS([], { userId: USER_ID, mode: "job-match" })
    ).rejects.toThrow("job-match analysis requires a job description")
    await expect(
      analyzeResumeATS([], { userId: USER_ID, mode: "job-match", jobDescription: "   " })
    ).rejects.toThrow("job-match analysis requires a job description")
    expect(mockedGenerateObject).not.toHaveBeenCalled()
  })
})

describe("computeOverallScore quality weighting", () => {
  it("excludes keywords and sums to 1", () => {
    expect(QUALITY_SCORE_WEIGHTS).toEqual({
      impact: 0.35,
      readability: 0.25,
      formatting: 0.2,
      completeness: 0.2,
    })
    const total = Object.values(QUALITY_SCORE_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1)
  })

  it("ignores the keywords sub-score entirely", () => {
    const scores = {
      keywords: 0,
      impact: 60,
      formatting: 70,
      completeness: 90,
      readability: 80,
    }
    // 60*.35 + 80*.25 + 70*.2 + 90*.2 = 73
    expect(computeOverallScore(scores, "quality")).toBe(73)
    expect(computeOverallScore({ ...scores, keywords: 100 }, "quality")).toBe(73)
    // Quality results carry `keywords: null`; the weighting must not go NaN.
    expect(computeOverallScore({ ...scores, keywords: null }, "quality")).toBe(73)
    // Job-match still counts it: 0*.3 + 60*.3 + 70*.2 + 90*.1 + 80*.1 = 49.
    expect(computeOverallScore(scores, "job-match")).toBe(49)
  })

  it("defaults to the job-match weighting", () => {
    expect(computeOverallScore(analysis.scores)).toBe(
      computeOverallScore(analysis.scores, "job-match")
    )
  })
})
