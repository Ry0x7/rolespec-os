// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyApiToken: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordAttempt: vi.fn(),
  jobCreate: vi.fn(),
  jobRowFindFirst: vi.fn(),
  questionCreateMany: vi.fn(),
  jobRowCreate: vi.fn(),
  jobRowUpdateMany: vi.fn(),
  transaction: vi.fn(),
  careerProfileFindUnique: vi.fn(),
}))

vi.mock("@/features/settings/services/api-token", () => ({
  verifyApiToken: mocks.verifyApiToken,
}))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { EXTENSION_JOBS: "extension:jobs" },
  RATE_LIMIT_MESSAGE: "Too many attempts. Please try again later.",
  consumeRateLimit: mocks.consumeRateLimit,
  recordAttempt: mocks.recordAttempt,
}))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    jobApplication: { create: mocks.jobCreate },
    interviewQuestion: { createMany: mocks.questionCreateMany },
    job: {
      create: mocks.jobRowCreate,
      findFirst: mocks.jobRowFindFirst,
      updateMany: mocks.jobRowUpdateMany,
    },
    careerProfile: { findUnique: mocks.careerProfileFindUnique },
    $transaction: mocks.transaction,
  },
}))

import { Prisma } from "@/generated/prisma/client"

import { OPTIONS, POST } from "../route"

const { PrismaClientKnownRequestError } = Prisma

const VALID_BODY = { companyName: "Acme", jobTitle: "Engineer" }

function post(
  body: unknown,
  { token = "rspec_valid", origin }: { token?: string | null; origin?: string } = {}
) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (token !== null) headers.authorization = `Bearer ${token}`
  if (origin) headers.origin = origin

  return POST(
    new Request("http://localhost/api/extension/jobs", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyApiToken.mockResolvedValue("user_1")
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.jobCreate.mockResolvedValue({ id: "job_1" })
  // The ingest helper writes the Job and the JobApplication in one
  // transaction; running the callback against the same mocks keeps every
  // assertion below pointed at the real create call.
  mocks.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      job: { create: mocks.jobRowCreate },
      jobApplication: { create: mocks.jobCreate },
    })
  )
  mocks.jobRowCreate.mockResolvedValue({ id: "job_row_1" })
  mocks.jobRowFindFirst.mockResolvedValue(null)
  mocks.jobRowUpdateMany.mockResolvedValue({ count: 1 })
  mocks.questionCreateMany.mockResolvedValue({ count: 0 })
  // No Career Profile by default, so qualification stays out of the body unless
  // a test opts into one.
  mocks.careerProfileFindUnique.mockResolvedValue(null)
})

describe("authentication", () => {
  it("401s with no Authorization header, without hitting the database", async () => {
    const res = await post(VALID_BODY, { token: null })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: "Invalid or missing API token",
      code: "UNAUTHORIZED",
    })
    expect(mocks.verifyApiToken).not.toHaveBeenCalled()
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it("401s when the token does not resolve to a user", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)

    const res = await post(VALID_BODY, { token: "rspec_revoked" })

    expect(res.status).toBe(401)
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it("accepts a case-insensitive bearer scheme and strips it from the token", async () => {
    const res = await post(VALID_BODY, { token: "rspec_valid" })

    expect(res.status).toBe(201)
    expect(mocks.verifyApiToken).toHaveBeenCalledWith("rspec_valid")
  })
})

describe("rate limiting", () => {
  it("429s on the token owner's id", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const res = await post(VALID_BODY)

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe("RATE_LIMITED")
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "extension:jobs",
      "user_1",
      expect.objectContaining({ max: 30 })
    )
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it("consumes one attempt when it lets the request through", async () => {
    await post(VALID_BODY)

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "extension:jobs",
      "user_1",
      expect.objectContaining({ max: 30 })
    )
    // The consume writes its own row; the separate record call is gone.
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
  })
})

describe("validation", () => {
  it.each([
    ["missing companyName", { jobTitle: "Engineer" }],
    ["missing jobTitle", { companyName: "Acme" }],
    ["empty companyName", { companyName: "", jobTitle: "Engineer" }],
    ["bad jobLink", { ...VALID_BODY, jobLink: "not-a-url" }],
    ["unknown jobType", { ...VALID_BODY, jobType: "PERMANENT" }],
    ["oversized description", { ...VALID_BODY, jobDescription: "x".repeat(20001) }],
    ["oversized location", { ...VALID_BODY, location: "x".repeat(201) }],
    ["negative salary", { ...VALID_BODY, salary: -1 }],
    ["unknown salaryPeriod", { ...VALID_BODY, salaryPeriod: "WEEKLY" }],
    ["unknown salaryCurrency", { ...VALID_BODY, salaryCurrency: "EUR" }],
    ["unknown workType", { ...VALID_BODY, workType: "WFH" }],
    ["unparseable postedAt", { ...VALID_BODY, postedAt: "last Tuesday" }],
    ["non-string postedAt", { ...VALID_BODY, postedAt: 20260901 }],
    ["unparseable deadline", { ...VALID_BODY, deadline: "2026-13-45" }],
  ])("400s on %s", async (_label, body) => {
    const res = await post(body)

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("VALIDATION")
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it("400s on a body that is not JSON", async () => {
    const res = await post("{not json")

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("VALIDATION")
  })

  it("returns the offending field in the message", async () => {
    const res = await post({ jobTitle: "Engineer" })

    expect((await res.json()).error).toContain("companyName")
  })
})

describe("creation", () => {
  it("201s with the new id, forcing INTERESTED and the token's user", async () => {
    const res = await post({
      ...VALID_BODY,
      jobLink: "https://example.com/job",
      location: "Remote",
      salary: 90000,
      salaryPeriod: "MONTHLY",
      salaryCurrency: "PHP",
      jobType: "FULL_TIME",
      workType: "REMOTE",
    })

    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.id).toBe("job_1")
    // Nothing in this posting states an eligibility restriction.
    expect(body).not.toHaveProperty("requirements")

    // Risk/requirement columns are asserted by their own suites below; this one
    // only owns the passthrough of the scraped fields and the forced defaults.
    // The scraped posting is written to `Job`; the application keeps the
    // decision-side fields and the link to it.
    expect(mocks.jobRowCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyName: "Acme",
        title: "Engineer",
        url: "https://example.com/job",
        location: "Remote",
        salary: 90000,
        salaryPeriod: "MONTHLY",
        salaryCurrency: "PHP",
        jobType: "FULL_TIME",
        workType: "REMOTE",
        userId: "user_1",
      }),
      select: { id: true },
    })
    expect(mocks.jobRowCreate.mock.calls[0][0].data.requirementFlags).toEqual(
      Prisma.DbNull
    )
    expect(mocks.jobCreate.mock.calls[0][0].data).toMatchObject({
      userId: "user_1",
      status: "INTERESTED",
      jobId: "job_row_1",
    })
  })

  it("stamps the extension source and the canonical form of the link", async () => {
    await post({ ...VALID_BODY, jobLink: "https://WWW.Example.com/job/1/?utm_source=x#apply" })

    const data = mocks.jobRowCreate.mock.calls[0][0].data
    expect(data.source).toBe("EXTENSION")
    expect(data.canonicalUrl).toBe("https://example.com/job/1")
    // The link the user actually opens is stored unchanged.
    expect(data.url).toBe("https://WWW.Example.com/job/1/?utm_source=x#apply")
  })

  it("omits canonicalUrl when the clip has no link, and skips the lookup", async () => {
    await post(VALID_BODY)

    expect(mocks.jobRowFindFirst).not.toHaveBeenCalled()
    expect(mocks.jobRowCreate.mock.calls[0][0].data.canonicalUrl).toBeNull()
  })

  it("ignores a client-supplied status", async () => {
    await post({ ...VALID_BODY, status: "APPLIED" })

    expect(mocks.jobCreate.mock.calls[0][0].data.status).toBe("INTERESTED")
  })

  it("500s rather than 400s when the write fails", async () => {
    mocks.jobCreate.mockRejectedValue(new Error("connection lost"))

    const res = await post(VALID_BODY)

    expect(res.status).toBe(500)
  })
})

describe("duplicate clips", () => {
  it("200s with the existing application id instead of creating a second row", async () => {
    mocks.jobRowFindFirst.mockResolvedValue({
      id: "job_row_existing",
      applications: [{ id: "job_existing" }],
    })

    const res = await post({ ...VALID_BODY, jobLink: "https://example.com/job/1?utm_source=x" })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "job_existing", duplicate: true })
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it("matches against the posting row on the canonical URL or the raw link, scoped to the token's user", async () => {
    await post({ ...VALID_BODY, jobLink: "https://example.com/job/1?utm_source=x" })

    expect(mocks.jobRowFindFirst).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        OR: [
          { canonicalUrl: "https://example.com/job/1" },
          { url: "https://example.com/job/1?utm_source=x" },
        ],
      },
      select: {
        id: true,
        applications: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
      },
    })
  })

  it("still clips when the posting exists but its application was deleted", async () => {
    mocks.jobRowFindFirst.mockResolvedValue({ id: "job_row_existing", applications: [] })

    const res = await post({ ...VALID_BODY, jobLink: "https://example.com/job/1" })

    expect(res.status).toBe(201)
    expect(mocks.jobCreate).toHaveBeenCalled()
  })

  it("still creates when the duplicate lookup itself fails", async () => {
    mocks.jobRowFindFirst.mockRejectedValue(new Error("connection lost"))

    const res = await post({ ...VALID_BODY, jobLink: "https://example.com/job/1" })

    expect(res.status).toBe(201)
    expect(mocks.jobCreate).toHaveBeenCalled()
  })

  it("200s with the winner's application when it loses the unique-key race", async () => {
    // The pre-check saw nothing, then a concurrent clip took the key.
    mocks.jobRowCreate.mockRejectedValueOnce(
      new PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: {
          modelName: "Job",
          driverAdapterError: {
            cause: { kind: "UniqueConstraintViolation", constraint: { fields: ['"userId"', '"canonicalUrl"'] } },
          },
        },
      })
    )
    mocks.jobRowFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "job_row_winner", applications: [{ id: "job_winner" }] })

    const res = await post({ ...VALID_BODY, jobLink: "https://example.com/job/1" })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "job_winner", duplicate: true })
  })
})

describe("scraped interview questions", () => {
  const DESCRIPTION = [
    "About the role",
    "1. Why do you want to join Acme?",
    "What is your experience with TypeScript?",
  ].join("\n")

  it("stores the questions found in the job description", async () => {
    const res = await post({ ...VALID_BODY, jobDescription: DESCRIPTION })

    expect(res.status).toBe(201)
    expect(mocks.questionCreateMany).toHaveBeenCalledWith({
      data: [
        {
          jobApplicationId: "job_1",
          question: "Why do you want to join Acme?",
          source: "SCRAPED",
        },
        {
          jobApplicationId: "job_1",
          question: "What is your experience with TypeScript?",
          source: "SCRAPED",
        },
      ],
    })
  })

  it("does not write when the description has no questions", async () => {
    const res = await post({ ...VALID_BODY, jobDescription: "We are hiring." })

    expect(res.status).toBe(201)
    expect(mocks.questionCreateMany).not.toHaveBeenCalled()
  })

  it("still 201s when the question insert fails", async () => {
    mocks.questionCreateMany.mockRejectedValue(new Error("connection lost"))

    const res = await post({ ...VALID_BODY, jobDescription: DESCRIPTION })

    expect(res.status).toBe(201)
    // `confidence` is read-time and unconditional, so it rides every 201.
    expect(await res.json()).toEqual({
      id: "job_1",
      confidence: { level: expect.any(String), summary: expect.any(String) },
    })
  })
})

describe("job risk heuristics", () => {
  const SCAM_DESCRIPTION =
    "Urgent requirement! Hiring immediately with unlimited earning potential. " +
    "Pay a small registration fee and message us on WhatsApp +1 555 010 2030."

  it("stores the heuristic verdict and returns it in the 201 body", async () => {
    const res = await post({ ...VALID_BODY, jobDescription: SCAM_DESCRIPTION })

    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.id).toBe("job_1")
    expect(body.risk.level).toBe("HIGH")
    expect(body.risk.reasons.length).toBeGreaterThan(0)

    const data = mocks.jobRowCreate.mock.calls[0][0].data
    expect(data.riskLevel).toBe("HIGH")
    expect(data.riskSource).toBe("HEURISTIC")
    expect(data.riskReasons).toEqual(body.risk.reasons)
    expect(data.riskCheckedAt).toBeInstanceOf(Date)
    expect(mocks.jobCreate.mock.calls[0][0].data).not.toHaveProperty("riskLevel")
  })

  it("omits risk entirely for a clean posting", async () => {
    const res = await post({
      ...VALID_BODY,
      jobDescription:
        "We are looking for a Senior Frontend Engineer to own our design system, " +
        "ship React and TypeScript features and work closely with design. " +
        "Requirements: 5+ years of professional frontend experience.",
    })

    expect(res.status).toBe(201)
    // `confidence` is read-time and unconditional, so it rides every 201.
    expect(await res.json()).toEqual({
      id: "job_1",
      confidence: { level: expect.any(String), summary: expect.any(String) },
    })
    expect(mocks.jobRowCreate.mock.calls[0][0].data.riskLevel).toBeNull()
  })
})

describe("job requirement flags", () => {
  it("stores the flags and returns them in the 201 body", async () => {
    const res = await post({
      ...VALID_BODY,
      jobDescription:
        "This role is US-only. Candidates must be a US citizen and we do not " +
        "sponsor visas. An active security clearance is required.",
    })

    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.id).toBe("job_1")
    expect(body.requirements).toEqual([
      "US_ONLY",
      "CITIZENSHIP_REQUIRED",
      "NO_SPONSORSHIP",
      "SECURITY_CLEARANCE",
    ])
    expect(mocks.jobRowCreate.mock.calls[0][0].data.requirementFlags).toEqual(
      body.requirements
    )
  })

  it("omits requirements entirely for an unrestricted posting", async () => {
    const res = await post({
      ...VALID_BODY,
      jobDescription:
        "We are looking for a Senior Frontend Engineer to own our design system " +
        "and ship React features with the product team.",
    })

    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body).not.toHaveProperty("requirements")
    expect(mocks.jobRowCreate.mock.calls[0][0].data.requirementFlags).toEqual(
      Prisma.DbNull
    )
  })
})

describe("career-profile qualification", () => {
  const PROFILE = {
    locations: ["Metro Manila"],
    openToRelocation: false,
    workModes: ["REMOTE"],
    requiresSponsorship: null,
    experienceLevel: null,
    targetRoles: [{ title: "Frontend Engineer", active: true }],
    capabilities: [
      { name: "React", confirmed: true },
      { name: "TypeScript", confirmed: true },
      { name: "Design systems", confirmed: true },
    ],
  }

  const CLIP = {
    companyName: "Acme",
    jobTitle: "Frontend Engineer",
    jobLink: "https://acme.com/jobs/1",
    location: "Remote",
    workType: "REMOTE",
    jobDescription:
      "We are hiring a Frontend Engineer to own our design systems work and " +
      "ship React and TypeScript features with the product team.",
  }

  it("returns the qualification in the 201 body, in the wire shape", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(PROFILE)

    const res = await post(CLIP)

    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.id).toBe("job_1")
    expect(body.qualification).toEqual({
      verdict: "STRONG",
      nextAction: "Save it and tailor a resume from the matching role family.",
      worthIt: {
        level: "GOOD",
        reasons: ["Remote matches your preference."],
      },
      eligible: { level: "NEUTRAL", reasons: [] },
      match: {
        level: "GOOD",
        matchedCapabilities: ["React", "TypeScript", "Design systems"],
        confirmedCount: 3,
      },
      // The heuristics scored nothing on this posting, so there is no risk band
      // to report; the step's own signal stands in.
      risk: { level: "NEUTRAL", reasons: [] },
    })
    // Exactly the contracted keys, nothing leaked from the internal type.
    expect(Object.keys(body.qualification).sort()).toEqual([
      "eligible",
      "match",
      "nextAction",
      "risk",
      "verdict",
      "worthIt",
    ])
  })

  it("reads the profile scoped to the token's user", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(PROFILE)

    await post(CLIP)

    expect(mocks.careerProfileFindUnique.mock.calls[0][0].where).toEqual({
      userId: "user_1",
    })
  })

  it("blocks and says so when the posting rules the user out", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue({
      ...PROFILE,
      requiresSponsorship: true,
    })

    const res = await post({
      ...CLIP,
      jobDescription: "We do not sponsor visas for this role.",
    })

    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.qualification.verdict).toBe("BLOCKED")
    expect(body.qualification.eligible.level).toBe("BLOCKER")
    expect(body.qualification.eligible.reasons.length).toBeGreaterThan(0)
  })

  it("reports the heuristic risk band when the posting scores one", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(PROFILE)

    const res = await post({
      ...CLIP,
      jobDescription:
        "Urgent requirement! Hiring immediately with unlimited earning potential. " +
        "Pay a small registration fee and message us on WhatsApp +1 555 010 2030.",
    })

    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.qualification.risk.level).toBe("HIGH")
    expect(body.qualification.risk.reasons.length).toBeGreaterThan(0)
    expect(body.qualification.verdict).toBe("WEAK")
    expect(body.qualification.nextAction).toBe(
      "Verify the company independently before spending any time on this."
    )
  })

  it("omits qualification entirely when the user has no Career Profile", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(null)

    const res = await post(CLIP)

    expect(res.status).toBe(201)
    expect(await res.json()).not.toHaveProperty("qualification")
  })

  it("still 201s when the profile read fails", async () => {
    mocks.careerProfileFindUnique.mockRejectedValue(new Error("connection lost"))

    const res = await post(CLIP)

    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.id).toBe("job_1")
    expect(body).not.toHaveProperty("qualification")
  })

  it("does not qualify on the duplicate path", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(PROFILE)
    mocks.jobRowFindFirst.mockResolvedValue({
      id: "job_row_existing",
      applications: [{ id: "job_existing" }],
    })

    const res = await post(CLIP)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "job_existing", duplicate: true })
    expect(mocks.careerProfileFindUnique).not.toHaveBeenCalled()
  })

  it("does not qualify when the clip loses the unique-key race", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(PROFILE)
    mocks.jobRowCreate.mockRejectedValueOnce(
      new PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: {
          modelName: "Job",
          driverAdapterError: {
            cause: {
              kind: "UniqueConstraintViolation",
              constraint: { fields: ['"userId"', '"canonicalUrl"'] },
            },
          },
        },
      })
    )
    mocks.jobRowFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "job_row_winner", applications: [{ id: "job_winner" }] })

    const res = await post(CLIP)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "job_winner", duplicate: true })
    // The snapshot now rides along in the create, so the pass has already run
    // by the time the race is lost — the loser's snapshot is simply discarded
    // with the create that lost, and no posting is updated behind the winner.
    expect(mocks.jobRowUpdateMany).not.toHaveBeenCalled()
  })

  describe("snapshot persisted to the posting", () => {
    it("creates the posting already carrying the snapshot", async () => {
      mocks.careerProfileFindUnique.mockResolvedValue(PROFILE)

      const res = await post(CLIP)

      expect(res.status).toBe(201)
      // One statement, not a create followed by an update: a crash between the
      // two used to leave a permanently null snapshot.
      expect(mocks.jobRowUpdateMany).not.toHaveBeenCalled()
      expect(mocks.jobRowCreate).toHaveBeenCalledTimes(1)

      const snapshot = mocks.jobRowCreate.mock.calls[0][0].data.qualification
      expect(snapshot.verdict).toBe("STRONG")
      expect(snapshot.nextAction).toBe(
        "Save it and tailor a resume from the matching role family."
      )
      expect(typeof snapshot.checkedAt).toBe("string")
      expect(Number.isNaN(Date.parse(snapshot.checkedAt))).toBe(false)
      expect(snapshot.worthIt).toEqual({
        signal: "GOOD",
        reasons: ["Remote matches your preference."],
      })
      expect(snapshot.eligible).toEqual({ signal: "NEUTRAL", reasons: [] })
      expect(snapshot.match).toEqual({
        signal: "GOOD",
        reasons: snapshot.match.reasons,
        matched: ["React", "TypeScript", "Design systems"],
        confirmedCount: 3,
      })
      // `level` is null when the heuristics scored nothing — unlike the wire
      // shape, the snapshot keeps the signal and the band as separate fields.
      expect(snapshot.risk).toEqual({ signal: "NEUTRAL", reasons: [], level: null })
    })

    it("carries the unchecked list the wire shape drops", async () => {
      mocks.careerProfileFindUnique.mockResolvedValue(PROFILE)

      // No location and no work type, so the preference checks cannot run.
      await post({ companyName: "Acme", jobTitle: "Frontend Engineer" })

      const snapshot = mocks.jobRowCreate.mock.calls[0][0].data.qualification
      expect(snapshot.worthIt.unchecked).toEqual(["work-mode", "location"])
      expect(snapshot.worthIt.reasons).toContain(
        "Couldn't check location or work mode from this posting — it does not say."
      )
    })

    it("writes no snapshot when the user has no Career Profile", async () => {
      mocks.careerProfileFindUnique.mockResolvedValue(null)

      const res = await post(CLIP)

      expect(res.status).toBe(201)
      expect(mocks.jobRowUpdateMany).not.toHaveBeenCalled()
      // `Prisma.DbNull` is what the create writes when there is no snapshot.
      expect(mocks.jobRowCreate.mock.calls[0][0].data.qualification).not.toHaveProperty("verdict")
    })

    it("still 201s, without a qualification, when the pass fails", async () => {
      mocks.careerProfileFindUnique.mockRejectedValue(new Error("connection lost"))

      const res = await post(CLIP)

      expect(res.status).toBe(201)
      expect(mocks.jobRowCreate.mock.calls[0][0].data.qualification).not.toHaveProperty("verdict")

      const body = await res.json()
      expect(body.id).toBe("job_1")
      expect(body).not.toHaveProperty("qualification")
    })

    it("writes no snapshot on the duplicate path", async () => {
      mocks.careerProfileFindUnique.mockResolvedValue(PROFILE)
      mocks.jobRowFindFirst.mockResolvedValue({
        id: "job_row_existing",
        applications: [{ id: "job_existing" }],
      })

      const res = await post(CLIP)

      expect(res.status).toBe(200)
      expect(mocks.jobRowUpdateMany).not.toHaveBeenCalled()
      expect(mocks.jobRowCreate).not.toHaveBeenCalled()
    })
  })
})

/**
 * The extractor reads `datePosted` / `validThrough` off the posting's own JSON-LD
 * and sends them; the user never types either. Both land on the `Job` row, which
 * is where the posting's facts live.
 */
describe("posting dates", () => {
  const jobRow = () => mocks.jobRowCreate.mock.calls[0][0].data

  it("stores a calendar date as UTC midnight on the posting", async () => {
    const res = await post({ ...VALID_BODY, postedAt: "2026-09-01", deadline: "2026-10-15" })

    expect(res.status).toBe(201)
    expect(jobRow().postedAt.toISOString()).toBe("2026-09-01T00:00:00.000Z")
    expect(jobRow().deadline.toISOString()).toBe("2026-10-15T00:00:00.000Z")
  })

  it("keeps the instant on postedAt but truncates the deadline to its day", async () => {
    await post({
      ...VALID_BODY,
      postedAt: "2026-09-01T09:30:00.000Z",
      deadline: "2026-10-15T23:59:59.000Z",
    })

    expect(jobRow().postedAt.toISOString()).toBe("2026-09-01T09:30:00.000Z")
    // A deadline is a day everywhere, so the time of day is dropped.
    expect(jobRow().deadline.toISOString()).toBe("2026-10-15T00:00:00.000Z")
  })

  it("leaves both null when the posting stated neither", async () => {
    await post(VALID_BODY)

    expect(jobRow().postedAt).toBeNull()
    expect(jobRow().deadline).toBeNull()
  })
})

/**
 * Two extras on the 201 the verdict alone does not carry. `marketFit` comes out
 * of the same single qualification pass as the verdict — never a second one — and
 * `confidence` is the read-time Opportunity Confidence, which is deliberately
 * independent of the Career Profile and therefore always present.
 */
describe("market fit and opportunity confidence", () => {
  const PROFILE = {
    locations: ["Cagayan de Oro, PH"],
    openToRelocation: false,
    workModes: ["REMOTE"],
    requiresSponsorship: null,
    experienceLevel: null,
    targetRoles: [{ title: "Web Developer", active: true }],
    capabilities: [{ name: "React", confirmed: true }],
  }

  const CLIP = {
    companyName: "Rose Eden",
    jobTitle: "Web Developer",
    jobLink: "https://bossjob.ph/en-us/job/web-developer-remote-500169",
    location: "Philippines",
    workType: "REMOTE",
    jobDescription:
      "We are hiring a Web Developer to build and maintain React front ends for " +
      "our customers across the Philippines. Fully remote.",
  }

  it("returns the market fit alongside the qualification", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(PROFILE)

    const body = await (await post(CLIP)).json()

    expect(body.marketFit).toEqual({
      fit: "IN_MARKET",
      label: expect.any(String),
      reason: expect.any(String),
    })
    expect(body.marketFit.label.length).toBeGreaterThan(0)
    expect(Object.keys(body.marketFit).sort()).toEqual(["fit", "label", "reason"])
  })

  it("omits the market fit when there is no Career Profile to be in a market for", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(null)

    const body = await (await post(CLIP)).json()

    expect(body.marketFit).toBeUndefined()
    expect(body.qualification).toBeUndefined()
  })

  it("returns the confidence level and its summary, with no Career Profile needed", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(null)

    const body = await (await post({ ...CLIP, postedAt: "2026-09-01" })).json()

    expect(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).toContain(body.confidence.level)
    expect(body.confidence.summary.length).toBeGreaterThan(0)
    expect(Object.keys(body.confidence).sort()).toEqual(["level", "summary"])
  })

  it("reads a stated posting date as fresher than none at all", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T00:00:00.000Z"))
    try {
      const dated = await (await post({ ...CLIP, postedAt: "2026-09-12" })).json()
      const undatedRes = await (await post(CLIP)).json()

      expect(dated.confidence.summary).not.toBe(undatedRes.confidence.summary)
      expect(dated.confidence.summary.toLowerCase()).toContain("posted")
      expect(undatedRes.confidence.summary.toLowerCase()).toContain("posting date unknown")
    } finally {
      vi.useRealTimers()
    }
  })

  it("carries neither on the duplicate path", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(PROFILE)
    mocks.jobRowFindFirst.mockResolvedValue({ id: "job_row_1", applications: [{ id: "existing" }] })

    const res = await post(CLIP)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ id: "existing", duplicate: true })
  })
})

describe("CORS", () => {
  it("204s the preflight with the method and header allowances", async () => {
    const res = await OPTIONS(
      new Request("http://localhost/api/extension/jobs", {
        method: "OPTIONS",
        headers: { origin: "chrome-extension://abcdef" },
      })
    )

    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdef")
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("authorization, content-type")
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS")
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400")
  })

  it.each(["chrome-extension://abcdef", "moz-extension://abcdef"])(
    "reflects the extension origin %s",
    async (origin) => {
      const res = await post(VALID_BODY, { origin })

      expect(res.status).toBe(201)
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin)
    }
  )

  it.each([
    "https://evil.example.com",
    "http://localhost:3000",
    "https://chrome-extension://spoof",
    "null",
  ])("does not reflect %s", async (origin) => {
    const res = await post(VALID_BODY, { origin })

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS")
  })

  it("carries the CORS headers on a 401 too, so the extension can read the error", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)

    const res = await post(VALID_BODY, { origin: "chrome-extension://abcdef" })

    expect(res.status).toBe(401)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdef")
  })

  it("omits the origin allowance when there is no Origin header", async () => {
    const res = await post(VALID_BODY)

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})
