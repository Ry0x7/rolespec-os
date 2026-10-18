import { describe, expect, it } from "vitest"

import {
  checkGeneratedDraft,
  extractRequirementTerms,
  formatRequirementBlock,
  groundEmployerRequirements,
} from "../application-grounding"
import { groundKeywords } from "../evidence-grounding"

const RESUME = `## Summary
Backend engineer with six years on Java services.

## Experience
Senior Engineer at Corva (2019 - Present)
- Built Spring Boot services backed by PostgreSQL
- Owned the REST API used by the mobile clients

## Skills
Java, Spring Boot, PostgreSQL, REST, Docker`

describe("extractRequirementTerms", () => {
  it("pulls acronyms out of a job description", () => {
    const terms = extractRequirementTerms(
      "You will write JPQL queries and integrate with JMS brokers on AWS."
    )
    expect(terms).toEqual(expect.arrayContaining(["JPQL", "JMS", "AWS"]))
  })

  it("pulls internal-capital and punctuated technology names", () => {
    const terms = extractRequirementTerms(
      "Stack: JavaScript, PostgreSQL, Node.js, C#, ASP.NET and GraphQL."
    )
    expect(terms).toEqual(
      expect.arrayContaining([
        "JavaScript",
        "PostgreSQL",
        "Node.js",
        "C#",
        "ASP.NET",
        "GraphQL",
      ])
    )
  })

  it("splits slash-joined initialisms", () => {
    expect(extractRequirementTerms("Own our CI/CD pipeline.")).toEqual(["CI", "CD"])
  })

  it("ignores lowercase prose so ordinary words are never requirements", () => {
    expect(
      extractRequirementTerms("You will work with a friendly team on hard problems.")
    ).toEqual([])
  })

  it("drops HR, geography, benefits and degree acronyms", () => {
    const terms = extractRequirementTerms(
      "US-based role. Report to the VP of HR. PTO, 401K and a 401K match. MBA preferred. Apply ASAP."
    )
    expect(terms).toEqual([])
  })

  it("takes plain capitalised names only inside a requirement line", () => {
    expect(
      extractRequirementTerms("Our Denver office overlooks the Rockies.")
    ).toEqual([])
    expect(extractRequirementTerms("- 5 years of Java and Kafka")).toEqual([
      "Java",
      "Kafka",
    ])
    expect(extractRequirementTerms("Experience with Terraform is required.")).toEqual(
      ["Terraform"]
    )
  })

  it("keeps sentence furniture out of requirement lines", () => {
    expect(
      extractRequirementTerms("- Strong communication skills and a Proven track record")
    ).toEqual([])
  })

  it("ignores the verb a responsibilities bullet opens with", () => {
    // Found by the first live run: every one of these came back as a
    // requirement, and "Operate" landed under DO NOT CLAIM — telling the model
    // not to say the candidate operates the services their resume says they do.
    const terms = extractRequirementTerms(
      [
        "- Design and ship Spring Boot services",
        "- Own the persistence layer",
        "- Build asynchronous flows",
        "- Operate your services alongside the platform team",
        "- Comfortable with ambiguity",
        "- Production experience is expected",
      ].join("\n")
    )
    expect(terms).toEqual(["Spring", "Boot"])
  })

  it("still takes a real technology at the head of a bullet", () => {
    expect(extractRequirementTerms("- Kafka and JMS in production")).toEqual([
      "Kafka",
      "JMS",
    ])
    expect(extractRequirementTerms("- PostgreSQL tuning")).toEqual(["PostgreSQL"])
  })

  it("keeps a bullet-opening word when it appears mid-line instead", () => {
    expect(extractRequirementTerms("- Experience with Design Systems")).toEqual([
      "Design",
      "Systems",
    ])
  })

  it("treats a word after a sentence break as positionally capitalised", () => {
    expect(
      extractRequirementTerms("Our stack: Java and Kafka. Production readiness matters.")
    ).toEqual(["Java", "Kafka"])
  })

  it("finds an acronym hidden behind a hyphen", () => {
    expect(extractRequirementTerms("Integrate with JMS-backed services.")).toEqual([
      "JMS",
    ])
  })

  it("drops terms the caller excludes, including multi-word company names", () => {
    const terms = extractRequirementTerms(
      "- IBM Watson is hiring an SRE who knows Kafka",
      ["IBM Watson", "SRE"]
    )
    expect(terms).toEqual(["Kafka"])
  })

  it("dedupes case-insensitively and keeps the first spelling", () => {
    expect(extractRequirementTerms("AWS work. More aws. Then AWS again.")).toEqual([
      "AWS",
    ])
  })

  it("caps the number of terms it returns", () => {
    const many = Array.from({ length: 80 }, (_, i) => `AB${i}X`).join(" ")
    expect(extractRequirementTerms(many)).toHaveLength(40)
  })

  it("returns nothing for empty input", () => {
    expect(extractRequirementTerms("")).toEqual([])
  })
})

describe("career-neutral requirement phrases", () => {
  // Every shape the extractor originally recognised needed a capital letter, so
  // it read a software posting well and almost nothing else. Measured before
  // the phrase pass: 7/8 requirements on the software posting below, and 1-2
  // out of 8-10 on each of the others — which meant DO NOT CLAIM came out empty
  // and the feature silently stopped protecting anyone outside tech.

  it("reads a nurse's posting", () => {
    const terms = extractRequirementTerms(
      [
        "What we are looking for:",
        "- 2+ years of acute care experience in a hospital setting",
        "- Current BLS and ACLS certification",
        "- Proficiency in venipuncture, wound care and catheter insertion",
        "- Experience with electronic health records and medication administration",
      ].join("\n")
    )
    expect(terms).toEqual(
      expect.arrayContaining([
        "acute care",
        "BLS",
        "ACLS",
        "venipuncture",
        "wound care",
        "catheter insertion",
        "electronic health records",
        "medication administration",
      ])
    )
  })

  it("reads an accountant's posting", () => {
    const terms = extractRequirementTerms(
      [
        "- 3+ years of experience with accounts payable and accounts receivable",
        "- Strong knowledge of month-end close and bank reconciliation",
        "- Experience with payroll processing and sales tax filings",
      ].join("\n")
    )
    expect(terms).toEqual(
      expect.arrayContaining([
        "accounts payable",
        "accounts receivable",
        "month-end close",
        "bank reconciliation",
        "payroll processing",
        "sales tax filings",
      ])
    )
  })

  it("reads a kitchen posting, including a phrase that opens with an article", () => {
    const terms = extractRequirementTerms(
      [
        "- Skilled in butchery, sauce work and pastry",
        "- Experience with a la carte service and banquet plating",
        "- ServSafe certification preferred",
      ].join("\n")
    )
    // The leading article is kept here and dropped in "a hospital setting",
    // because "la" is too short to stand as the head of the phrase.
    expect(terms).toEqual(
      expect.arrayContaining([
        "butchery",
        "sauce work",
        "pastry",
        "a la carte service",
        "banquet plating",
        "ServSafe",
      ])
    )
  })

  it("reads a warehouse posting", () => {
    const terms = extractRequirementTerms(
      [
        "- Experience with forklift operation and pallet jacks",
        "- Knowledge of inventory control and cycle counting",
        "- Familiarity with cold chain handling",
      ].join("\n")
    )
    expect(terms).toEqual(
      expect.arrayContaining([
        "forklift operation",
        "pallet jacks",
        "inventory control",
        "cycle counting",
        "cold chain handling",
      ])
    )
  })

  it("prefers a multi-word name over the words it is built from", () => {
    // Before the phrase pass this yielded "Spring" and "Boot" separately, which
    // barred two words the draft could only ever have used inside the whole.
    const terms = extractRequirementTerms("- 5+ years of Java, with deep Spring Boot experience")
    expect(terms).toContain("Spring Boot")
    expect(terms).not.toContain("Spring")
    expect(terms).not.toContain("Boot")
    expect(terms).toContain("Java")
  })

  it("does not turn a responsibilities bullet into a phrase", () => {
    // The PP0.3 failure, in its phrase form: these describe the work, and any
    // of them under DO NOT CLAIM would forbid the candidate from describing
    // what their own resume says they do.
    expect(
      extractRequirementTerms(
        [
          "- Own the persistence layer",
          "- Build asynchronous flows",
          "- Design and ship services",
        ].join("\n")
      )
    ).toEqual([])
  })

  it("does not bar generic soft skills", () => {
    expect(
      extractRequirementTerms(
        [
          "- Strong communication and collaboration skills",
          "- Comfortable with ambiguity",
          "- Excellent attention to detail",
        ].join("\n")
      )
    ).toEqual([])
  })

  it("does not mistake benefits for requirements", () => {
    expect(
      extractRequirementTerms(
        ["Requirements and benefits:", "- HMO from day one", "- 20 days PTO"].join("\n")
      )
    ).toEqual([])
  })

  it("keeps a cue out of the phrase it introduces", () => {
    expect(extractRequirementTerms("- Production experience with JMS and Kafka")).toEqual([
      "JMS",
      "Kafka",
    ])
    expect(extractRequirementTerms("- Comfortable with Kubernetes and Terraform")).toEqual([
      "Kubernetes",
      "Terraform",
    ])
  })

  it("finds the requirement inside a recruiter's question, not the question", () => {
    // A received email asks rather than lists. Before the sentence-word guard
    // this extracted "Do you have JPQL" — which barred a phrase no draft would
    // ever contain, and hid the real requirement inside it.
    expect(extractRequirementTerms("- Do you have JPQL experience?")).toEqual(["JPQL"])
  })

  it("grounds a lowercase multi-word requirement against a resume", () => {
    // The end-to-end point: a nurse whose resume has wound care but no
    // venipuncture must get one barred and the other supported.
    const result = groundEmployerRequirements({
      employerText: "- Proficiency in wound care and venipuncture",
      evidenceText:
        "## Experience\nStaff Nurse at Cebu General\n- Performed wound care and dressing changes on a 24-bed unit",
    })
    expect(result.grounded.supported).toContain("wound care")
    expect(result.barred).toContain("venipuncture")
    expect(result.promptBlock).toContain("DO NOT CLAIM")
  })

  it("catches a lowercase phrase the draft claims anyway", () => {
    const grounding = groundEmployerRequirements({
      employerText: "- Proficiency in venipuncture and catheter insertion",
      evidenceText: "## Skills\nWound care, patient education",
    })
    const claimed = checkGeneratedDraft({
      grounding,
      evidenceText: "## Skills\nWound care, patient education",
      generated: "I have performed venipuncture on every shift for three years.",
    })
    expect(claimed?.claimed.map((detail) => detail.keyword)).toContain("venipuncture")
  })
})

describe("formatRequirementBlock", () => {
  it("is empty when there is nothing to say", () => {
    expect(formatRequirementBlock(groundKeywords([], RESUME))).toBe("")
  })

  it("renders all three partitions and the refer-but-do-not-claim rule", () => {
    const block = formatRequirementBlock(
      groundKeywords(["Java", "Spring Batch", "JPQL"], RESUME)
    )
    expect(block).toContain("SUPPORTED")
    expect(block).toContain("Java")
    expect(block).toContain("NEEDS CONFIRMATION")
    expect(block).toContain("Spring Batch")
    expect(block).toContain("DO NOT CLAIM")
    expect(block).toContain("JPQL")
    expect(block).toContain("never as something you have done")
  })

  it("names only the barred headings the block actually contains", () => {
    const supportedOnly = formatRequirementBlock(groundKeywords(["Java"], RESUME))
    expect(supportedOnly).toContain("SUPPORTED")
    expect(supportedOnly).not.toContain("NEEDS CONFIRMATION")
    expect(supportedOnly).not.toContain("DO NOT CLAIM")
    // With nothing barred there is no refer-but-do-not-claim rule to state.
    expect(supportedOnly).not.toContain("never as something you have done")

    const unsupportedOnly = formatRequirementBlock(groundKeywords(["JPQL"], RESUME))
    expect(unsupportedOnly).toContain("DO NOT CLAIM")
    expect(unsupportedOnly).not.toContain("NEEDS CONFIRMATION")
    expect(unsupportedOnly).toContain(
      'You may refer to something under DO NOT CLAIM as the employer\'s'
    )
  })
})

describe("groundEmployerRequirements", () => {
  it("partitions a posting against the candidate's own resume", () => {
    const result = groundEmployerRequirements({
      employerText: [
        "- 5 years of Java",
        "- Write JPQL and publish to JMS",
        "- Deploy with Docker",
      ].join("\n"),
      evidenceText: RESUME,
    })

    expect(result.grounded.supported).toEqual(
      expect.arrayContaining(["Java", "Docker"])
    )
    expect(result.grounded.unsupported).toEqual(
      expect.arrayContaining(["JPQL", "JMS"])
    )
    expect(result.barred).toEqual(expect.arrayContaining(["JPQL", "JMS"]))
    expect(result.barred).not.toContain("Java")
  })

  it("never bars something the resume already contains", () => {
    const result = groundEmployerRequirements({
      employerText: "PostgreSQL and REST experience required.",
      evidenceText: RESUME,
    })
    expect(result.barred).toEqual([])
    expect(result.promptBlock).toContain("SUPPORTED")
    expect(result.promptBlock).not.toContain("DO NOT CLAIM (")
  })

  it("produces an empty prompt block when the posting has no requirement terms", () => {
    const result = groundEmployerRequirements({
      employerText: "we are looking for a thoughtful person who likes people",
      evidenceText: RESUME,
    })
    expect(result.promptBlock).toBe("")
    expect(result.barred).toEqual([])
  })
})

describe("checkGeneratedDraft", () => {
  const grounding = groundEmployerRequirements({
    employerText: "You will write JPQL queries against JMS-backed services in Java.",
    evidenceText: RESUME,
  })

  it("returns null for a draft that stays inside the evidence", () => {
    expect(
      checkGeneratedDraft({
        grounding,
        evidenceText: RESUME,
        generated:
          "I have spent six years on Java services, most of it Spring Boot and PostgreSQL.",
      })
    ).toBeNull()
  })

  it("reports a barred requirement the draft asserts anyway", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "I write JPQL daily and have run JMS brokers in production.",
    })

    expect(result).not.toBeNull()
    expect(result?.claimed.map((c) => c.keyword)).toEqual(["JPQL", "JMS"])
    expect(result?.claimed[0].reason).toBeTruthy()
  })

  it("does not report a supported term the draft uses", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "Java is most of what I do, and I have shipped JPQL too.",
    })
    expect(result?.claimed.map((c) => c.keyword)).toEqual(["JPQL"])
  })

  it("leaves the quiet tier off entirely when there is nothing quiet to report", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "I write JPQL daily and have run JMS brokers in production.",
    })
    expect(result).not.toHaveProperty("namedAsGap")
  })

  it("matches whole tokens only, so a substring never trips the check", () => {
    const jmsOnly = groundEmployerRequirements({
      employerText: "JMS required.",
      evidenceText: RESUME,
    })
    expect(
      checkGeneratedDraft({
        grounding: jmsOnly,
        evidenceText: RESUME,
        generated: "I have worked on JMSSerializer-free codebases.",
      })
    ).toBeNull()
  })
})

/**
 * The two-tier split. A mention wrapped in gap phrasing ("Kafka is new to me")
 * is an honest sentence, and warning about it in the same amber as a fabricated
 * claim trains the user to ignore the amber. It is still reported, quietly.
 *
 * Every case here is checked against the same rule: uncertainty is LOUD. No cue,
 * no readable sentence, or one claiming occurrence among several, and the term
 * belongs in `claimed`.
 */
describe("checkGeneratedDraft — gap admissions versus claims", () => {
  const grounding = groundEmployerRequirements({
    employerText: `Platform Engineer

Requirements:
- Experience with Kafka, JMS and Kubernetes
- Strong JPQL background`,
    evidenceText: RESUME,
  })

  it("bars all four terms to begin with", () => {
    expect(grounding.barred).toEqual(
      expect.arrayContaining(["Kafka", "JMS", "Kubernetes", "JPQL"])
    )
  })

  it("files a real draft's honest admission under namedAsGap, with nothing claimed", () => {
    // Verbatim from a browser check: three terms under one trailing cue.
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "I'll be upfront: the Kafka, JMS, and Kubernetes parts of your stack are new to me.",
    })

    expect(result).not.toBeNull()
    expect(result?.claimed).toEqual([])
    expect(result?.namedAsGap?.map((n) => n.keyword).sort()).toEqual([
      "JMS",
      "Kafka",
      "Kubernetes",
    ])
  })

  it("keeps an asserting draft entirely in claimed", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "I have production experience with JPQL, JMS and Kafka, and I have run all three at scale.",
    })

    expect(result?.claimed.map((n) => n.keyword).sort()).toEqual([
      "JMS",
      "JPQL",
      "Kafka",
    ])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("treats a term as claimed when any one occurrence lacks a cue", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "Kafka is new to me. Later on I built Kafka pipelines for the billing team.",
    })

    expect(result?.claimed.map((n) => n.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("does not let a cue leak across a sentence boundary", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "I have not used JMS. Kafka is where most of my throughput work lives.",
    })

    expect(result?.claimed.map((n) => n.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap?.map((n) => n.keyword)).toEqual(["JMS"])
  })

  it("stays loud when the mention has no readable sentence context", () => {
    // The cue and the term sit on either side of a line break, so no single
    // sentence carries both. That is "could not read it", not "fine".
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "New to me:\nKubernetes",
    })

    expect(result?.claimed.map((n) => n.keyword)).toEqual(["Kubernetes"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("does not read 'machine learning' as an admission of learning", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "I built machine learning pipelines that publish onto Kafka.",
    })

    expect(result?.claimed.map((n) => n.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("reads a curly apostrophe in a cue", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "I haven’t used Kafka yet, though the rest of the stack I know well.",
    })

    expect(result?.claimed).toEqual([])
    expect(result?.namedAsGap?.map((n) => n.keyword)).toEqual(["Kafka"])
  })
})

/**
 * The cross-sentence admission. Longer prose names the requirements in one
 * sentence and owns the gap in the NEXT one, pointing back with "those" — the
 * construction a real cover letter used, where all six terms went loud on a
 * draft that had been honest about every one of them.
 *
 * The widening is deliberately one-directional and narrow: a cue in the
 * IMMEDIATELY FOLLOWING sentence covers the sentence before it, and only when
 * that sentence refers back and brings in no barred term of its own. Every
 * other shape keeps failing toward `claimed`.
 */
describe("checkGeneratedDraft — an admission in the immediately following sentence", () => {
  const grounding = groundEmployerRequirements({
    employerText: `Platform Engineer

Requirements:
- Experience with Kafka, JMS, Kubernetes and Terraform
- Strong JPQL background`,
    evidenceText: RESUME,
  })

  it("bars every term the recorded draft mentions", () => {
    expect(grounding.barred).toEqual(
      expect.arrayContaining(["Kafka", "JMS", "Kubernetes", "Terraform"])
    )
  })

  it("files the recorded cover-letter admission under namedAsGap", () => {
    // Verbatim from the browser check that exposed this: the cue sits in the
    // sentence AFTER the four terms, and referred back to them with "those".
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "The async side of this role runs on JMS and Kafka, and your team operates on Kubernetes and Terraform. I haven't worked with those yet.",
    })

    expect(result).not.toBeNull()
    expect(result?.claimed).toEqual([])
    expect(result?.namedAsGap?.map((n) => n.keyword).sort()).toEqual([
      "JMS",
      "Kafka",
      "Kubernetes",
      "Terraform",
    ])
  })

  it("stays loud when the following cue sentence never refers back", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "The async side of this role runs on JMS and Kafka. I have not used a broker in anger.",
    })

    expect(result?.claimed.map((n) => n.keyword).sort()).toEqual(["JMS", "Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("stays loud when the following sentence brings in a barred term of its own", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "The async side of this role runs on JMS and Kafka. I haven't worked with those, but Kubernetes is a daily tool for me.",
    })

    // JMS and Kafka lose the carry entirely: the sentence that would have
    // covered them is also making a claim.
    expect(result?.claimed.map((n) => n.keyword).sort()).toEqual(["JMS", "Kafka"])
  })

  it("stays loud when the cue is two sentences later", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "The async side of this role runs on JMS and Kafka. That is the half of the stack I find most interesting. I haven't worked with those yet.",
    })

    expect(result?.claimed.map((n) => n.keyword).sort()).toEqual(["JMS", "Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("still needs every occurrence covered, not just the last one", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "I ran Kafka for the billing team. Your stack also leans on Kafka and JMS. I haven't worked with those yet.",
    })

    expect(result?.claimed.map((n) => n.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap?.map((n) => n.keyword)).toEqual(["JMS"])
  })
})

describe("the JPQL/JMS regression case, end to end", () => {
  it("bars both, and catches a draft that claims them", () => {
    const jobDescription = `Senior Java Engineer at Northwind

Requirements:
- 5+ years of Java
- Strong JPQL and JMS experience
- Familiarity with PostgreSQL`

    const grounding = groundEmployerRequirements({
      employerText: jobDescription,
      evidenceText: RESUME,
      exclude: ["Northwind", "Senior Java Engineer"],
    })

    expect(grounding.grounded.unsupported).toEqual(
      expect.arrayContaining(["JPQL", "JMS"])
    )
    expect(grounding.promptBlock).toContain("DO NOT CLAIM")

    const cleanDraft =
      "Six years of Java, mostly Spring Boot against PostgreSQL. Happy to talk."
    expect(
      checkGeneratedDraft({ grounding, evidenceText: RESUME, generated: cleanDraft })
    ).toBeNull()

    const dirtyDraft =
      "Six years of Java, including heavy JPQL work and JMS messaging."
    const caught = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: dirtyDraft,
    })
    expect(caught?.claimed.map((c) => c.keyword).sort()).toEqual(["JMS", "JPQL"])
  })
})

/**
 * The three shapes in which the cross-sentence carry silenced a genuine claim.
 * Every one of them is prose a model actually writes, and the module's stated
 * invariant — fail toward `claimed` — says every one of them must stay LOUD.
 */
describe("checkGeneratedDraft — the carry may not silence a claim", () => {
  const grounding = groundEmployerRequirements({
    employerText: `Platform Engineer

Requirements:
- Experience with Kafka, JMS, Kubernetes and Terraform
- Strong JPQL background`,
    evidenceText: RESUME,
  })

  // D1: "that" is overwhelmingly a complementizer or a determiner, not an
  // anaphor. Treating it as one let stock filler ("I am confident that…",
  // "That work taught me…", "That said…") speak for a boast in front of it.
  it.each([
    [
      "complementizer 'that'",
      "I have shipped production systems on Kafka and Kubernetes for five years. I am confident that I can ramp up on anything else your team needs.",
    ],
    [
      "determiner 'that'",
      "I built the event pipeline on Kafka and Kubernetes. That work taught me plenty and I am still learning every day.",
    ],
    [
      "discourse 'that said'",
      "I have run Kafka clusters at scale.\n\nThat said, I am still learning.",
    ],
  ])("keeps a boast loud when the next sentence only says %s", (_label, generated) => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated,
    })

    expect(result?.claimed.map((c) => c.keyword).sort()).toEqual(
      generated.includes("Kubernetes") ? ["Kafka", "Kubernetes"] : ["Kafka"]
    )
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  // D2: a cue with a negator in front of it is the OPPOSITE of an admission.
  it("does not read a negated cue as an admission, across sentences", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "I have deep production experience with Kafka and Kubernetes. None of those are new to me.",
    })

    expect(result?.claimed.map((c) => c.keyword).sort()).toEqual([
      "Kafka",
      "Kubernetes",
    ])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("does not read a negated cue as an admission in the same sentence", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "Kafka is not new to me.",
    })

    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("still reads an un-negated cue as an admission", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "Kafka is new to me.",
    })

    expect(result?.claimed).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword)).toEqual(["Kafka"])
  })

  // D3: the four services join the fields as `${subject}\n${body}`, so the
  // first sentence of the body must never speak for the subject line.
  it("does not let the body's admission cover a claim in the subject line", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "Kafka engineer applying\nI am not yet sure that this is the right role.",
    })

    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("does not let the body's admission cover the subject even with a referent", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "Kafka engineer applying\nI haven't worked with those yet.",
    })

    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("does not let the carry cross a paragraph break", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "I have run Kafka clusters at scale for the billing team.\n\nI haven't worked with those yet.",
    })

    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("keeps the carry inside one paragraph", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "Your stack runs on Kafka and Terraform. I haven't worked with those yet.\n\nHappy to talk.",
    })

    expect(result?.claimed).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword).sort()).toEqual([
      "Kafka",
      "Terraform",
    ])
  })
})

/**
 * Contrastive gap phrasing — "X rather than Y".
 *
 * Observed live: a cover letter that owned its gaps in three parallel "rather
 * than" clauses still fired two amber warnings, because the terms named as the
 * gaps sat in sentences with no cue from `GAP_CUE_SOURCES`.
 *
 * The DIRECTION is the whole problem. In "X rather than Y" the gap is Y and X
 * is a CLAIM, so this cannot be an ordinary sentence-scoped cue — one would
 * silence the boast standing in front of it. Coverage is positional, and it
 * stops at the first clause boundary, because one sentence can carry several
 * markers and a term after the first one may still be a claim.
 *
 * The LOUD cases below matter more than the quiet ones. A wrongly-loud term is
 * noise; a wrongly-quiet term is an unbacked skill claim sent to an employer
 * with no warning.
 *
 * L5 lives above, unmodified: "does not let a cue leak across a sentence
 * boundary". A contrastive marker is same-sentence only and never joins the
 * cross-sentence carry, so that tripwire still has to hold.
 */
describe("checkGeneratedDraft — contrastive gap phrasing", () => {
  const grounding = groundEmployerRequirements({
    employerText: `Platform Engineer

Requirements:
- Experience with Kafka, JMS, Kubernetes, Terraform and Hibernate
- Strong JPQL background`,
    evidenceText: RESUME,
  })

  it("bars every term the observed paragraph mentions", () => {
    expect(grounding.barred).toEqual(
      expect.arrayContaining([
        "Kafka",
        "JMS",
        "Kubernetes",
        "Terraform",
        "Hibernate",
        "JPQL",
      ])
    )
  })

  // Q1: verbatim from the observed cover letter. The gap trails the marker and
  // runs to the end of the sentence.
  it("Q1: quiets a term named after 'rather than' at the end of a sentence", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "my deployments have run through Docker and GitLab rather than Kubernetes",
    })

    expect(result?.claimed ?? []).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword)).toEqual(["Kubernetes"])
  })

  // Q2: verbatim from the same paragraph. Here the claim side of the contrast
  // ("Spring Boot") is supported by the resume, so only Hibernate is at stake.
  it("Q2: quiets a term named after 'rather than' mid-sentence", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "My JPA experience is through Spring Boot rather than raw Hibernate",
    })

    expect(result?.claimed ?? []).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword)).toEqual(["Hibernate"])
  })

  // Q3: THE REGRESSION CASE. The full paragraph as the model wrote it, under
  // the heading "I want to be straight about the gaps". Six barred terms, all
  // of them honestly disowned, and it produced two amber warnings.
  it("Q3: quiets all six terms of the observed paragraph, with nothing claimed", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "Your posting asks for JPQL and Hibernate, plus JMS and Kafka for the async flows, and Kubernetes and Terraform on the operations side. I haven't worked with those yet. My JPA experience is through Spring Boot rather than raw Hibernate, my async work has been incremental batch jobs rather than message queues, and my deployments have run through Docker and GitLab rather than Kubernetes.",
    })

    expect(result).not.toBeNull()
    expect(result?.claimed).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword).sort()).toEqual([
      "Hibernate",
      "JMS",
      "JPQL",
      "Kafka",
      "Kubernetes",
      "Terraform",
    ])
  })

  // Q4: the other two markers. Three in total — the same conservatism the cue
  // list uses, nothing speculative.
  it("Q4: reads 'instead of' the same way", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "My messaging work has been on SQS instead of Kafka.",
    })

    expect(result?.claimed ?? []).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword)).toEqual(["Kafka"])
  })

  it("Q4: reads 'as opposed to' the same way", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "My orchestration has been Nomad as opposed to Kubernetes.",
    })

    expect(result?.claimed ?? []).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword)).toEqual(["Kubernetes"])
  })

  // L1: THE INVERSION. The term in FRONT of the marker is what the candidate
  // says they used. A sentence-scoped cue would have silenced it.
  it("L1: keeps the term before the marker loud", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "I used Kafka rather than RabbitMQ",
    })

    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  // L2: THE MULTI-MARKER TRAP. Terraform sits after the FIRST marker and is
  // still a claim, because a clause boundary closed that marker's span. A rule
  // of "any term after any marker" would have silenced it.
  it("L2: keeps both claims loud when one sentence carries two markers", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "I used Kafka rather than RabbitMQ, and Terraform rather than CloudFormation",
    })

    expect(result?.claimed.map((c) => c.keyword).sort()).toEqual([
      "Kafka",
      "Terraform",
    ])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  // L3: a barred term after a marker but past the clause boundary that closed it.
  it("L3: keeps a term loud when it sits past the marker's clause boundary", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "I worked in Java rather than Scala, and I own our Kafka pipeline",
    })

    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  // L4: NEGATED_CUE still bites in a sentence that also carries a marker. The
  // paired assertion is what makes this non-vacuous: without the negator the
  // very same sentence goes quiet, so it is the negator doing the work.
  it("L4: a negated cue beside a contrastive marker stays loud", () => {
    const negated = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "Kafka is not new to me, and I'd take it rather than RabbitMQ.",
    })

    expect(negated?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(negated?.namedAsGap ?? []).toEqual([])

    const unnegated = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated: "Kafka is new to me, and I'd take it rather than RabbitMQ.",
    })

    expect(unnegated?.claimed ?? []).toEqual([])
    expect(unnegated?.namedAsGap?.map((c) => c.keyword)).toEqual(["Kafka"])
  })

  // The marker is same-sentence only. It must not join the cross-sentence
  // carry: a position cannot transfer across a sentence boundary.
  it("does not let a contrastive marker reach into the next sentence", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "My deployments run on Docker rather than Nomad. Kubernetes is where our services live.",
    })

    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kubernetes"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  // The every-occurrence rule is unchanged: one uncovered mention anywhere in
  // the draft makes the whole term loud again.
  it("still needs every occurrence covered, marker or not", () => {
    const result = checkGeneratedDraft({
      grounding,
      evidenceText: RESUME,
      generated:
        "My deployments have run through Docker rather than Kubernetes. Later I rebuilt the billing stack on Kubernetes.",
    })

    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kubernetes"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })
})

/**
 * Contracted negators.
 *
 * `NEGATED_CUE` exists because a negator in front of a cue inverts it — "none
 * of those are new to me" is a boast wearing an admission's words. It listed
 * only spelled-out negators, and "aren't" spells no `not`: every contracted
 * auxiliary walked straight past the guard and sent a boast QUIET, which is the
 * one direction this module may not be wrong in.
 *
 * The B cases are boasts that were observed going quiet. Each carries the
 * un-negated twin of the same sentence, because a LOUD assertion on its own is
 * cheap — a sentence with no cue at all is loud too — and the twin is what
 * shows the negator is doing the work rather than an accident of phrasing.
 *
 * The Q cases matter more. They are honest admissions, and a negator list that
 * reaches too far turns them loud and trains the user to ignore the notice.
 */
describe("checkGeneratedDraft — a contracted negator inverts a cue", () => {
  const grounding = groundEmployerRequirements({
    employerText: `Platform Engineer

Requirements:
- Experience with Kafka, JMS and Kubernetes
- Strong JPQL background`,
    evidenceText: RESUME,
  })

  const loud = (generated: string) =>
    checkGeneratedDraft({ grounding, evidenceText: RESUME, generated })

  it("B1: keeps \"Kafka isn't new to me\" loud", () => {
    const result = loud("Kafka isn't new to me.")
    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])

    // The twin: same sentence, no negator, and it goes quiet.
    const twin = loud("Kafka is new to me.")
    expect(twin?.claimed ?? []).toEqual([])
    expect(twin?.namedAsGap?.map((c) => c.keyword)).toEqual(["Kafka"])
  })

  it("B2: keeps \"Kafka and Kubernetes aren't new to me\" loud", () => {
    const result = loud("Kafka and Kubernetes aren't new to me.")
    expect(result?.claimed.map((c) => c.keyword).sort()).toEqual([
      "Kafka",
      "Kubernetes",
    ])
    expect(result?.namedAsGap ?? []).toEqual([])

    const twin = loud("Kafka and Kubernetes are new to me.")
    expect(twin?.claimed ?? []).toEqual([])
    expect(twin?.namedAsGap?.map((c) => c.keyword).sort()).toEqual([
      "Kafka",
      "Kubernetes",
    ])
  })

  it("B3: keeps \"Kafka wasn't unfamiliar to me\" loud", () => {
    const result = loud("Kafka wasn't unfamiliar to me.")
    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])

    const twin = loud("Kafka was unfamiliar to me.")
    expect(twin?.claimed ?? []).toEqual([])
    expect(twin?.namedAsGap?.map((c) => c.keyword)).toEqual(["Kafka"])
  })

  it("B4a: keeps \"Kafka doesn't feel new to me\" loud, one word out", () => {
    const result = loud("Kafka doesn't feel new to me.")
    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])

    const twin = loud("Kafka does feel new to me.")
    expect(twin?.claimed ?? []).toEqual([])
    expect(twin?.namedAsGap?.map((c) => c.keyword)).toEqual(["Kafka"])
  })

  it("B4b: keeps \"Kubernetes won't be new to me\" loud", () => {
    const result = loud("Kubernetes won't be new to me.")
    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kubernetes"])
    expect(result?.namedAsGap ?? []).toEqual([])

    const twin = loud("Kubernetes will be new to me.")
    expect(twin?.claimed ?? []).toEqual([])
    expect(twin?.namedAsGap?.map((c) => c.keyword)).toEqual(["Kubernetes"])
  })

  it("B4c: reads a curly apostrophe in the negator too", () => {
    // The sentence reaches the guard with its apostrophes already folded, so
    // whichever one the model typed has to bite the same way.
    const result = loud("Kafka isn\u2019t new to me.")
    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("S1: the spelled-out negator still bites", () => {
    const result = loud("Kafka is not new to me.")
    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("S2: \"None of those are new to me\" is still a boast", () => {
    const result = loud("Your stack runs on Kafka. None of those are new to me.")
    expect(result?.claimed.map((c) => c.keyword)).toEqual(["Kafka"])
    expect(result?.namedAsGap ?? []).toEqual([])
  })

  it("Q1: an admission whose own cue carries a contraction stays quiet", () => {
    const result = loud("I haven't worked with Kafka or Kubernetes yet.")
    expect(result?.claimed ?? []).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword).sort()).toEqual([
      "Kafka",
      "Kubernetes",
    ])
  })

  it("Q2: \"I haven't used Kafka\" stays quiet", () => {
    const result = loud("I haven't used Kafka.")
    expect(result?.claimed ?? []).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword)).toEqual(["Kafka"])
  })

  it("Q3: \"I don't have experience with Kafka\" stays quiet", () => {
    const result = loud("I don't have experience with Kafka.")
    expect(result?.claimed ?? []).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword)).toEqual(["Kafka"])
  })

  it("Q4: the contiguous \"not yet\" cue still matches", () => {
    const result = loud("Kafka and Kubernetes are not yet on my resume.")
    expect(result?.claimed ?? []).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword).sort()).toEqual([
      "Kafka",
      "Kubernetes",
    ])
  })

  it("Q5: a contraction more than two words from the cue does not reach it", () => {
    // The window is two words and stays two words. Widening it is a separate
    // decision, and this is the case that would pay for it.
    const result = loud(
      "Kafka isn't something I've used yet, and Kubernetes is new to me."
    )
    expect(result?.claimed ?? []).toEqual([])
    expect(result?.namedAsGap?.map((c) => c.keyword).sort()).toEqual([
      "Kafka",
      "Kubernetes",
    ])
  })

  it("N1: a discontiguous \"aren't … yet\" is still loud, and not this fix's doing", () => {
    // No cue from GAP_CUE_SOURCES fires here at all — "not yet" is contiguous,
    // "aren't … yet" is not — so this stays loud for its own reason. It is a
    // separate open defect and this round does not close it.
    const result = loud("Kafka and Kubernetes aren't on my resume yet.")
    expect(result?.claimed.map((c) => c.keyword).sort()).toEqual([
      "Kafka",
      "Kubernetes",
    ])
    expect(result?.namedAsGap ?? []).toEqual([])
  })
})
