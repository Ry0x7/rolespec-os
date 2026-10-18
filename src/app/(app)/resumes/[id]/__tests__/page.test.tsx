import { describe, it, expect, beforeEach, vi } from "vitest"

const { mockAuth, mockPrisma, mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    resume: { findUnique: vi.fn() },
    aTSAnalysis: { findFirst: vi.fn() },
    resumeExport: { findFirst: vi.fn() },
    jobApplication: { findMany: vi.fn() },
  },
  mockRedirect: vi.fn(),
  mockNotFound: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect, notFound: mockNotFound }))
vi.mock("@/features/resume/components/resume-editor", () => ({
  ResumeEditor: () => <div data-testid="editor" />,
}))

import ResumeEditorPage from "../page"

/** In Next.js notFound()/redirect() throw; mirror that so nothing runs after. */
beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockNotFound.mockImplementation(() => {
    throw new Error("NOT_FOUND")
  })
  mockRedirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
  mockPrisma.aTSAnalysis.findFirst.mockResolvedValue(null)
  mockPrisma.resumeExport.findFirst.mockResolvedValue(null)
  mockPrisma.jobApplication.findMany.mockResolvedValue([])
})

const params = Promise.resolve({ id: "resume-1" })
const searchParams = Promise.resolve({})

function resumeRow(status: string) {
  return {
    id: "resume-1",
    title: "Test Resume",
    targetRole: null,
    targetCompany: null,
    template: "MINIMAL",
    atsScore: null,
    status,
    updatedAt: new Date(),
    sections: [],
  }
}

describe("resume editor page archived guard", () => {
  it("renders the editor for a non-archived resume", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(resumeRow("DRAFT"))

    await expect(ResumeEditorPage({ params, searchParams })).resolves.toBeTruthy()
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  it("returns not-found for an archived resume", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(resumeRow("ARCHIVED"))

    await expect(ResumeEditorPage({ params, searchParams })).rejects.toThrow("NOT_FOUND")
    expect(mockNotFound).toHaveBeenCalledTimes(1)
  })

  it("returns not-found for a missing resume", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(null)

    await expect(ResumeEditorPage({ params, searchParams })).rejects.toThrow("NOT_FOUND")
    expect(mockNotFound).toHaveBeenCalledTimes(1)
  })
})

describe("resume editor page saved-job options", () => {
  // The posting fields are read off the `job` relation, not the application's
  // mirrored columns.
  const jobRows = [
    {
      id: "job-1",
      job: {
        companyName: "Acme",
        title: "Backend Engineer",
        description: "Own the payments platform.",
      },
    },
    {
      id: "job-2",
      job: { companyName: "Globex", title: "Platform Engineer", description: "   " },
    },
  ]

  beforeEach(() => {
    mockPrisma.resume.findUnique.mockResolvedValue(resumeRow("DRAFT"))
    mockPrisma.jobApplication.findMany.mockResolvedValue(jobRows)
  })

  // The page wraps <ResumeEditor> in the full-bleed container that cancels
  // `main`'s padding, so the assertions below unwrap it to reach the props.
  const render = async (jobId?: string) => {
    const wrapper = (await ResumeEditorPage({
      params,
      searchParams: Promise.resolve(jobId ? { jobId } : {}),
    })) as { props: { children: { props: Record<string, unknown> } } }
    return wrapper.props.children
  }

  it("passes description-availability flags but never the job description text", async () => {
    const element = await render()

    expect(element.props.jobOptions).toEqual([
      { id: "job-1", companyName: "Acme", jobTitle: "Backend Engineer", hasJobDescription: true },
      {
        id: "job-2",
        companyName: "Globex",
        jobTitle: "Platform Engineer",
        hasJobDescription: false,
      },
    ])
    expect(JSON.stringify(element.props.jobOptions)).not.toContain("payments platform")
    expect(mockPrisma.jobApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    )
  })

  it("keeps a jobId that resolves to a job with a description", async () => {
    const element = await render("job-1")

    expect(element.props.initialJobId).toBe("job-1")
  })

  it("drops a jobId whose job has no description", async () => {
    const element = await render("job-2")

    expect(element.props.initialJobId).toBeUndefined()
  })

  it("drops a jobId that is not one of the user's jobs", async () => {
    const element = await render("job-other")

    expect(element.props.initialJobId).toBeUndefined()
  })

  it("leaves initialJobId undefined without a deep link", async () => {
    const element = await render()

    expect(element.props.initialJobId).toBeUndefined()
  })
})

describe("resume editor page analysis mode", () => {
  const analysisRow = (
    mode: "QUALITY" | "JOB_MATCH",
    jobDescription: string | null,
    createdAt: Date = new Date(),
  ) => ({
    createdAt,
    overallScore: 72,
    scores: { keywords: null },
    issues: [],
    suggestions: { items: [], missingKeywords: [] },
    jobDescription,
    mode,
  })

  const render = async () => {
    const wrapper = (await ResumeEditorPage({ params, searchParams })) as {
      props: { children: { props: { resume: { latestAnalysis: { mode: string } | null; latestAnalysisOutdated?: boolean; jobDescription: string | null } } } }
    }
    return wrapper.props.children.props.resume
  }

  beforeEach(() => {
    mockPrisma.resume.findUnique.mockResolvedValue(resumeRow("DRAFT"))
  })

  it("reads the mode off the persisted column, not the job description", async () => {
    mockPrisma.aTSAnalysis.findFirst.mockResolvedValue(analysisRow("QUALITY", "Retained text"))

    const resume = await render()

    expect(resume.latestAnalysis?.mode).toBe("quality")
    // The job description still pre-fills the drawer.
    expect(resume.jobDescription).toBe("Retained text")
  })

  it("maps a persisted JOB_MATCH row to job-match", async () => {
    mockPrisma.aTSAnalysis.findFirst.mockResolvedValue(analysisRow("JOB_MATCH", "Listing"))

    const resume = await render()

    expect(resume.latestAnalysis?.mode).toBe("job-match")
  })

  it("marks the analysis outdated when the resume was saved after it", async () => {
    const analyzed = new Date("2026-10-01T10:00:00.000Z")
    mockPrisma.resume.findUnique.mockResolvedValue({
      ...resumeRow("DRAFT"),
      updatedAt: new Date("2026-10-01T10:05:00.000Z"),
    })
    mockPrisma.aTSAnalysis.findFirst.mockResolvedValue(analysisRow("QUALITY", null, analyzed))

    const resume = await render()

    expect(resume.latestAnalysisOutdated).toBe(true)
  })

  it("keeps the analysis current when the only later write is its own atsScore stamp", async () => {
    const analyzed = new Date("2026-10-01T10:00:00.000Z")
    mockPrisma.resume.findUnique.mockResolvedValue({
      ...resumeRow("DRAFT"),
      updatedAt: new Date("2026-10-01T10:00:00.059Z"),
    })
    mockPrisma.aTSAnalysis.findFirst.mockResolvedValue(analysisRow("QUALITY", null, analyzed))

    const resume = await render()

    expect(resume.latestAnalysisOutdated).toBe(false)
  })
})

describe("resume editor page job context", () => {
  const jobRows = [
    {
      id: "job-1",
      job: { companyName: "Acme", title: "Backend Engineer", description: "Own payments." },
    },
    {
      id: "job-2",
      job: { companyName: "Globex", title: "Platform Engineer", description: null },
    },
  ]

  const row = (
    variant: "MASTER" | "ROLE_FAMILY" | "JOB_TAILORED",
    extra: Record<string, unknown> = {}
  ) => ({ ...resumeRow("DRAFT"), variant, jobApplicationId: null, roleFamily: null, ...extra })

  const render = async (jobId?: string) => {
    const wrapper = (await ResumeEditorPage({
      params,
      searchParams: Promise.resolve(jobId ? { jobId } : {}),
    })) as { props: { children: { props: Record<string, unknown> } } }
    return wrapper.props.children.props
  }

  beforeEach(() => {
    mockPrisma.jobApplication.findMany.mockResolvedValue(jobRows)
  })

  it("links a master resume opened with ?jobId= back to that job", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(row("MASTER"))

    const props = await render("job-1")

    expect(props.linkedJob).toEqual({ id: "job-1", title: "Backend Engineer" })
  })

  it("links back even when the job has no description to prefill", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(row("ROLE_FAMILY"))

    const props = await render("job-2")

    expect(props.linkedJob).toEqual({ id: "job-2", title: "Platform Engineer" })
    expect(props.initialJobId).toBeUndefined()
  })

  it("silently drops a jobId that is not one of the user's jobs", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(row("MASTER"))

    const props = await render("job-foreign")

    expect(props.linkedJob).toBeNull()
    // Resolved only against the session user's applications.
    expect(mockPrisma.jobApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    )
  })

  it("has no link without ?jobId= for a master resume", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(row("MASTER"))

    const props = await render()

    expect(props.linkedJob).toBeNull()
  })

  it("keeps a tailored resume linked to its own job, not the ?jobId=", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(
      row("JOB_TAILORED", { jobApplicationId: "job-2" })
    )

    const props = await render("job-1")

    expect(props.linkedJob).toEqual({ id: "job-2", title: "Platform Engineer" })
  })

  it("passes the resume kind and role family name to the editor", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(
      row("ROLE_FAMILY", { roleFamily: { name: "Backend" } })
    )

    const props = await render()

    expect(props.resume).toEqual(
      expect.objectContaining({ variant: "ROLE_FAMILY", roleFamilyName: "Backend" })
    )
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "resume-1", userId: "user-1" },
        include: expect.objectContaining({ roleFamily: { select: { name: true } } }),
      })
    )
  })

  it("passes a derived resume's source to the editor, with no origin", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(
      row("JOB_TAILORED", {
        careerProfileId: "profile-1",
        sourceResume: { id: "resume-src", title: "Platform Master", status: "ACTIVE" },
      })
    )

    const props = await render()

    expect(props.resume).toEqual(
      expect.objectContaining({
        sourceResume: { id: "resume-src", title: "Platform Master", status: "ACTIVE" },
        origin: null,
      })
    )
    expect(mockPrisma.resume.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          sourceResume: { select: { id: true, title: true, status: true } },
        }),
      })
    )
  })

  it("derives a master's origin from whether it records a Career Profile", async () => {
    mockPrisma.resume.findUnique.mockResolvedValue(
      row("MASTER", { careerProfileId: "profile-1", sourceResume: null })
    )
    expect((await render()).resume).toEqual(
      expect.objectContaining({ origin: "profile", sourceResume: null })
    )

    mockPrisma.resume.findUnique.mockResolvedValue(
      row("MASTER", { careerProfileId: null, sourceResume: null })
    )
    // A master without a Career Profile is a legacy row: no origin is guessed.
    expect((await render()).resume).toEqual(expect.objectContaining({ origin: null }))
  })
})
