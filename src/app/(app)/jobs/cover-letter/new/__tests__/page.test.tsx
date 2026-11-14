import { describe, it, expect, beforeEach, vi } from "vitest"
import { isValidElement, type ReactElement, type ReactNode } from "react"

const { mockAuth, mockPrisma, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    resume: { findMany: vi.fn() },
    jobApplication: { findMany: vi.fn() },
  },
  mockRedirect: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))
// The form is the seam the resolved default is read through.
vi.mock("@/features/jobs/components/cover-letter-form", () => ({
  CoverLetterForm: () => null,
}))

import { CoverLetterForm } from "@/features/jobs/components/cover-letter-form"
import NewCoverLetterPage from "../page"

/** Depth-first search for the element the page hands the given component. */
function findElementByType(
  node: ReactNode,
  type: unknown,
): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) {
      const found = findElementByType(child, type)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node as ReactElement<Record<string, unknown>>
  const { children } = node.props as { children?: ReactNode }
  return findElementByType(children, type)
}

/** Every anchor the page rendered, as { href, text }. */
function findLinks(node: ReactNode): Array<{ href: string; text: string }> {
  if (Array.isArray(node)) {
    return (node as ReactNode[]).flatMap(findLinks)
  }
  if (!isValidElement(node)) return []
  const props = node.props as { href?: string; children?: ReactNode }
  const nested = findLinks(props.children)
  if (typeof props.href === "string") {
    const text = (Array.isArray(props.children) ? props.children : [props.children])
      .filter((child) => typeof child === "string" || typeof child === "number")
      .join("")
    return [{ href: props.href, text }, ...nested]
  }
  return nested
}

const application = {
  id: "app-1",
  resumeId: null as string | null,
  job: {
    companyName: "Rose Eden LLC",
    title: "Web Developer",
    description: "A long enough description to count as present.",
  },
}

const tailoredForThisJob = {
  id: "r-tailored",
  title: "Rose Eden",
  atsScore: null,
  variant: "JOB_TAILORED",
  targetRole: null,
  jobApplicationId: "app-1",
  updatedAt: new Date("2026-09-11T00:00:00Z"),
}

const master = {
  id: "r-master",
  title: "Full-Stack Developer Resume",
  atsScore: 72,
  variant: "MASTER",
  targetRole: "Junior Web Developer",
  jobApplicationId: null,
  updatedAt: new Date("2026-09-07T00:00:00Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockPrisma.resume.findMany.mockResolvedValue([tailoredForThisJob, master])
  mockPrisma.jobApplication.findMany.mockResolvedValue([application])
})

async function renderPage(jobId?: string) {
  return NewCoverLetterPage({ searchParams: Promise.resolve({ jobId }) })
}

describe("new cover letter page — arriving from a job", () => {
  it("preselects the recommended resume when the job has no chosen one", async () => {
    const tree = await renderPage("app-1")
    const form = findElementByType(tree, CoverLetterForm)

    expect(form?.props.defaultResumeId).toBe("r-tailored")
    expect(form?.props.resumeHint).toBe("Recommended: Rose Eden · Tailored for this job")
  })

  it("prefers the chosen resume and then says nothing about tiers", async () => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([
      { ...application, resumeId: "r-master" },
    ])

    const tree = await renderPage("app-1")
    const form = findElementByType(tree, CoverLetterForm)

    expect(form?.props.defaultResumeId).toBe("r-master")
    // The user's own pick needs no justification.
    expect(form?.props.resumeHint).toBeNull()
  })

  it("sends the back link to the job it was opened from", async () => {
    const tree = await renderPage("app-1")
    const links = findLinks(tree)

    expect(links).toContainEqual({
      href: "/jobs/app-1",
      text: "← Back to job: Web Developer",
    })
    expect(links.some((link) => link.href === "/jobs/cover-letter")).toBe(false)
  })

  it("keeps the list link and recommends nothing without a jobId", async () => {
    const tree = await renderPage()
    const form = findElementByType(tree, CoverLetterForm)

    expect(form?.props.defaultResumeId).toBeUndefined()
    expect(form?.props.resumeHint).toBeNull()
    expect(findLinks(tree).some((link) => link.href === "/jobs/cover-letter")).toBe(
      true,
    )
  })

  it("passes the form only id, title and ATS score", async () => {
    const tree = await renderPage("app-1")
    const form = findElementByType(tree, CoverLetterForm)

    expect(form?.props.resumes).toEqual([
      { id: "r-tailored", title: "Rose Eden", atsScore: null },
      { id: "r-master", title: "Full-Stack Developer Resume", atsScore: 72 },
    ])
  })
})
