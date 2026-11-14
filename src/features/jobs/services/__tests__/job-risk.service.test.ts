import { describe, it, expect } from "vitest"
import { assessJobRiskHeuristics } from "../job-risk.service"

/** A long, ordinary, unremarkable posting. */
const CLEAN_DESCRIPTION = [
  "We are looking for a Senior Frontend Engineer to join our product team.",
  "You will own the design system, ship React and TypeScript features, and work",
  "closely with design and backend engineers. We value tested code, thoughtful",
  "reviews and clear written communication.",
  "Requirements: 5+ years of professional frontend experience, strong TypeScript,",
  "and experience with modern build tooling. Benefits include healthcare, a",
  "learning budget and 25 days of paid leave.",
].join(" ")

const base = {
  jobTitle: "Senior Frontend Engineer",
  companyName: "Acme Corp",
  jobDescription: CLEAN_DESCRIPTION,
}

describe("assessJobRiskHeuristics — clean postings", () => {
  it("returns null for an ordinary posting", () => {
    expect(assessJobRiskHeuristics(base)).toBeNull()
  })

  it("returns null for a posting with no description at all", () => {
    expect(
      assessJobRiskHeuristics({ jobTitle: "Engineer", companyName: "Acme" })
    ).toBeNull()
  })

  it("returns null for a corporate-domain recruiter contact", () => {
    expect(
      assessJobRiskHeuristics({ ...base, contact: "talent@acme.com" })
    ).toBeNull()
  })

  it("returns null for a normal ATS apply link", () => {
    expect(
      assessJobRiskHeuristics({
        ...base,
        jobLink: "https://boards.greenhouse.io/acme/jobs/123",
      })
    ).toBeNull()
  })

  it("does not flag a legitimate crypto-industry posting", () => {
    const result = assessJobRiskHeuristics({
      jobTitle: "Senior Solidity Engineer",
      companyName: "Northwind Digital Assets",
      jobDescription: [
        "We run a regulated bitcoin exchange and are hiring a Senior Solidity",
        "Engineer for our smart contract team. You will audit and ship Ethereum",
        "contracts, work with our custody engineers on cryptocurrency settlement",
        "infrastructure, and help design our USDT liquidity tooling.",
        "Requirements: 4+ years of professional backend experience, Solidity, and",
        "a solid grasp of EVM internals. Benefits include healthcare, a learning",
        "budget and 25 days of paid leave.",
      ].join(" "),
      contact: "talent@northwind.example",
      jobLink: "https://boards.greenhouse.io/northwind/jobs/9",
    })

    // At most a weak nudge: never the payment red flag.
    expect(result?.reasons ?? []).not.toContain("The posting mentions crypto payments")
    expect(result === null || result.level === "LOW").toBe(true)
  })

  it("does not flag a LinkedIn lnkd.in short link", () => {
    expect(
      assessJobRiskHeuristics({ ...base, jobLink: "https://lnkd.in/abc123" })
    ).toBeNull()
  })

  it("does not flag a single ordinary urgency phrase", () => {
    expect(
      assessJobRiskHeuristics({
        ...base,
        jobDescription: `${CLEAN_DESCRIPTION} We are hiring immediately.`,
      })
    ).toBeNull()
  })
})

describe("assessJobRiskHeuristics — lookalike recruiter domain", () => {
  const LOOKALIKE_REASON = "Recruiter email domain imitates the company name"

  it("flags a hyphenated impersonation of the company domain", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      companyName: "Google",
      contact: "recruiting@google-careers-hr.com",
    })

    expect(result?.reasons).toContain(LOOKALIKE_REASON)
  })

  it("flags a digit-padded impersonation", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      companyName: "Northwind",
      contact: "hr@northwind24.com",
    })

    expect(result?.reasons).toContain(LOOKALIKE_REASON)
  })

  it("flags an impersonation suffix with no hyphen", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      companyName: "Northwind",
      contact: "hr@northwindcareers.com",
    })

    expect(result?.reasons).toContain(LOOKALIKE_REASON)
  })

  it("does not flag the company's real domain", () => {
    expect(
      assessJobRiskHeuristics({
        ...base,
        companyName: "Northwind",
        contact: "talent@northwind.com",
      })
    ).toBeNull()
  })

  it("does not flag a subdomain of the company's real domain", () => {
    expect(
      assessJobRiskHeuristics({
        ...base,
        companyName: "Northwind",
        contact: "talent@careers.northwind.com",
      })
    ).toBeNull()
  })

  it("does not flag the company's own hyphenated domain", () => {
    expect(
      assessJobRiskHeuristics({
        ...base,
        companyName: "Coca Cola",
        contact: "hr@coca-cola.com",
      })
    ).toBeNull()
  })

  it("does not flag the unhyphenated spelling of a two-word company", () => {
    expect(
      assessJobRiskHeuristics({
        ...base,
        companyName: "Coca Cola",
        contact: "hr@cocacola.com",
      })
    ).toBeNull()
  })

  it("flags padding around a hyphenated company domain", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      companyName: "Coca Cola",
      contact: "hr@coca-cola-careers.com",
    })

    expect(result?.reasons).toContain(LOOKALIKE_REASON)
  })

  it("flags a digit-padded hyphenated company domain", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      companyName: "Coca Cola",
      contact: "hr@coca-cola7.com",
    })

    expect(result?.reasons).toContain(LOOKALIKE_REASON)
  })

  it("flags a typosquat that regroups the hyphen", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      companyName: "Coca Cola",
      contact: "hr@cocacola-hr.com",
    })

    expect(result?.reasons).toContain(LOOKALIKE_REASON)
  })

  it("does not flag an unrelated company that merely shares a prefix", () => {
    expect(
      assessJobRiskHeuristics({
        ...base,
        companyName: "Meta",
        contact: "talent@metabase.com",
        jobLink: "https://metabase.com/careers",
      })
    ).toBeNull()
  })

  it("does not fire when the company name has no distinctive token", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      companyName: "IBM Ltd",
      contact: "talent@ibm-hiring-hr.com",
    })

    expect(result?.reasons ?? []).not.toContain(LOOKALIKE_REASON)
  })

  it("stacks with the personal-email signal when both fire", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      companyName: "Northwind",
      contact: "northwind-hr@gmail.com, apply@northwind-careers.com",
    })

    expect(result?.reasons).toContain(LOOKALIKE_REASON)
    expect(result?.reasons).toContain(
      "Recruiter uses a personal email address, not a company domain"
    )
    // 3 + 3 lands exactly on HIGH_THRESHOLD.
    expect(result?.level).toBe("HIGH")
  })
})

describe("assessJobRiskHeuristics — unrelated apply link", () => {
  const UNRELATED_REASON =
    "Application link doesn't match the company or a known job board"

  it("flags a host that shares nothing with the company name", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      companyName: "Northwind",
      jobLink: "https://fast-hire-portal.example/apply/1",
    })

    expect(result?.reasons).toContain(UNRELATED_REASON)
    expect(result?.level).toBe("LOW")
  })

  it.each([
    ["greenhouse", "https://boards.greenhouse.io/northwind/jobs/9"],
    ["lever", "https://jobs.lever.co/othercorp/123"],
    ["workday", "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/123"],
    ["ashby", "https://jobs.ashbyhq.com/othercorp/abc"],
    ["linkedin", "https://www.linkedin.com/jobs/view/123456"],
    ["indeed", "https://www.indeed.com/viewjob?jk=abc"],
    ["smartrecruiters", "https://jobs.smartrecruiters.com/OtherCorp/123"],
  ])("does not flag a %s link", (_label, jobLink) => {
    expect(
      assessJobRiskHeuristics({ ...base, companyName: "Northwind", jobLink })
    ).toBeNull()
  })

  it("does not flag the company's own careers host", () => {
    expect(
      assessJobRiskHeuristics({
        ...base,
        companyName: "Northwind Digital",
        jobLink: "https://careers.northwind.com/roles/9",
      })
    ).toBeNull()
  })

  it("does not fire when the company name has no distinctive token", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      companyName: "SAP",
      jobLink: "https://fast-hire-portal.example/apply/1",
    })

    expect(result?.reasons ?? []).not.toContain(UNRELATED_REASON)
  })

  it("does not double-charge a shortened link", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      companyName: "Northwind",
      jobLink: "https://bit.ly/abc123",
    })

    expect(result?.reasons).toContain("Apply link goes through a URL shortener")
    expect(result?.reasons).not.toContain(UNRELATED_REASON)
  })
})

describe("assessJobRiskHeuristics — payment red flags", () => {
  it.each([
    ["upfront fee", "Applicants must pay a registration fee of $50 to be considered."],
    ["training fee", "There is a small training fee before your first shift."],
    ["equipment purchase", "You will purchase your own laptop from our supplier."],
    ["wire transfer", "Send the deposit by wire transfer to secure the position."],
    ["gift cards", "Your first task is to buy gift cards for our clients."],
    ["crypto payout", "Payouts are settled in bitcoin every Friday."],
    ["paid in crypto", "You will be paid in crypto after each completed task."],
    ["crypto payment", "We only make crypto payments, no bank details needed."],
    ["send crypto", "To activate the account you must send bitcoin to our wallet."],
    ["bank details", "Reply with your bank account details to onboard."],
  ])("flags %s as HIGH", (_label, sentence) => {
    const result = assessJobRiskHeuristics({
      ...base,
      jobDescription: `${CLEAN_DESCRIPTION} ${sentence}`,
    })

    expect(result?.level).toBe("HIGH")
    expect(result?.reasons.length).toBeGreaterThan(0)
  })
})

describe("assessJobRiskHeuristics — off-platform contact", () => {
  it("flags a WhatsApp handoff with a number in the description", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      jobDescription: `${CLEAN_DESCRIPTION} Message us on WhatsApp +1 555 010 2030 to start.`,
    })

    expect(result?.level).toBe("MEDIUM")
    expect(result?.reasons).toContain("Pushes contact to WhatsApp, Telegram or Signal")
  })

  it("flags a Telegram handle in the contact field", () => {
    const result = assessJobRiskHeuristics({ ...base, contact: "Telegram: @hr_acme_jobs" })

    expect(result?.reasons).toContain("Pushes contact to WhatsApp, Telegram or Signal")
  })
})

describe("assessJobRiskHeuristics — personal-email recruiter", () => {
  it.each([
    "acme.hr@gmail.com",
    "recruiter@outlook.com",
    "jobs@yahoo.com",
    "hiring@hotmail.com",
    "hr@protonmail.com",
  ])("flags %s", (contact) => {
    const result = assessJobRiskHeuristics({ ...base, contact })

    expect(result?.level).toBe("LOW")
    expect(result?.reasons).toContain(
      "Recruiter uses a personal email address, not a company domain"
    )
  })
})

describe("assessJobRiskHeuristics — too good to be true", () => {
  it("flags no-experience wording paired with an implausible hourly rate", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      jobDescription: `${CLEAN_DESCRIPTION} No experience required.`,
      salary: 150,
      salaryPeriod: "HOURLY",
    })

    expect(result?.reasons).toContain(
      "Unusually high pay for a role that asks for no experience"
    )
  })

  it.each([
    ["MONTHLY", 30000],
    ["YEARLY", 400000],
  ])("flags an implausible %s figure", (salaryPeriod, salary) => {
    const result = assessJobRiskHeuristics({
      ...base,
      jobDescription: `${CLEAN_DESCRIPTION} No experience necessary.`,
      salary,
      salaryPeriod,
    })

    expect(result?.level).toBe("MEDIUM")
  })

  it("does not flag a plausible salary with no-experience wording", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      jobDescription: `${CLEAN_DESCRIPTION} No experience required.`,
      salary: 22,
      salaryPeriod: "HOURLY",
    })

    expect(result).toBeNull()
  })

  it("flags an explicit per-day payout claim", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      jobDescription: `${CLEAN_DESCRIPTION} Earn $500 per day from home.`,
    })

    expect(result?.reasons).toContain("Advertises a fixed daily or weekly payout")
  })
})

describe("assessJobRiskHeuristics — vagueness and shouting", () => {
  it("flags a short description that is all grand claims", () => {
    const result = assessJobRiskHeuristics({
      jobTitle: "Data Entry",
      companyName: "Global Ventures",
      jobDescription: "Urgent requirement! Hiring immediately with unlimited earning potential.",
    })

    expect(result).not.toBeNull()
    expect(result?.reasons.some((r) => r.includes("Very short description"))).toBe(true)
  })

  it("flags an all-caps job title", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      jobTitle: "REMOTE DATA ENTRY CLERK",
      contact: "recruiter@gmail.com",
    })

    expect(result?.reasons).toContain("Job title is written in all caps")
  })

  it("flags heavy emoji use", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      jobTitle: "Assistant 🚀🔥💰",
      contact: "recruiter@gmail.com",
    })

    expect(result?.reasons).toContain("Heavy use of emoji or exclamation marks")
  })
})

describe("assessJobRiskHeuristics — suspicious links", () => {
  it.each([
    "https://bit.ly/3xyzabc",
    "https://tinyurl.com/apply-now",
    "https://t.co/abc123",
  ])("flags the shortener %s", (jobLink) => {
    const result = assessJobRiskHeuristics({ ...base, jobLink })

    expect(result?.reasons).toContain("Apply link goes through a URL shortener")
  })

  it("flags a raw IP host", () => {
    const result = assessJobRiskHeuristics({ ...base, jobLink: "http://203.0.113.9/apply" })

    expect(result?.reasons).toContain("Apply link points at a raw IP address")
  })

  it("ignores an unparseable link instead of throwing", () => {
    expect(assessJobRiskHeuristics({ ...base, jobLink: "not a url" })).toBeNull()
  })
})

describe("assessJobRiskHeuristics — combination and caps", () => {
  it("escalates from LOW to HIGH as signals stack", () => {
    const low = assessJobRiskHeuristics({ ...base, contact: "recruiter@gmail.com" })
    expect(low?.level).toBe("LOW")

    const medium = assessJobRiskHeuristics({
      ...base,
      contact: "recruiter@gmail.com",
      jobLink: "https://bit.ly/3xyzabc",
    })
    expect(medium?.level).toBe("MEDIUM")

    const high = assessJobRiskHeuristics({
      ...base,
      contact: "recruiter@gmail.com",
      jobLink: "https://bit.ly/3xyzabc",
      jobDescription: `${CLEAN_DESCRIPTION} Message us on WhatsApp +1 555 010 2030.`,
    })
    expect(high?.level).toBe("HIGH")
  })

  it("caps the reason list at six entries", () => {
    const result = assessJobRiskHeuristics({
      jobTitle: "URGENT DATA ENTRY 🚀🔥💰",
      companyName: "Global Ventures",
      jobDescription:
        "Urgent requirement! Hiring immediately, unlimited earning potential! " +
        "Pay a registration fee, a training fee, and purchase your own laptop. " +
        "Send payment by wire transfer, in gift cards or bitcoin. " +
        "Message us on WhatsApp +1 555 010 2030. Earn $900 per day from home! " +
        "No experience required!",
      contact: "recruiter@gmail.com",
      jobLink: "https://bit.ly/3xyzabc",
      salary: 500,
      salaryPeriod: "HOURLY",
    })

    expect(result?.level).toBe("HIGH")
    expect(result?.reasons).toHaveLength(6)
  })

  it("matches case-insensitively", () => {
    const result = assessJobRiskHeuristics({
      ...base,
      jobDescription: `${CLEAN_DESCRIPTION} SEND THE REGISTRATION FEE BY WIRE TRANSFER.`,
    })

    expect(result?.level).toBe("HIGH")
  })
})
