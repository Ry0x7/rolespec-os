import { describe, it, expect } from "vitest"

import {
  checkDraftSignature,
  checkSubjectNameSlot,
  looksLikeNameLine,
  signatureSlot,
} from "../signature-check"

const CANDIDATE = "Marisol Reyes"

/**
 * The two drafts below are the ones actually observed in the browser under
 * PP0.4 and recorded in the ledger: an invented first name, and the candidate's
 * FORMER EMPLOYER used as a signature. They are the regression case this module
 * exists for, so they are quoted rather than paraphrased.
 */
const BAD_INVENTED_NAME = `Hi Maya,

I've applied for the Senior Java Engineer role at Vantage Freight Systems. My resume is attached.

Best,
Alex`

const BAD_FORMER_EMPLOYER = `Hi Maya,

I've applied for the staff nurse role at Vantage General. My resume is attached.

Best,
Cebu General Hospital staff nurse`

const GOOD = `Hi Maya,

I've applied for the Senior Java Engineer role at Vantage Freight Systems. My resume is attached.

Best,
Marisol Reyes`

describe("checkDraftSignature — the recorded failures", () => {
  it("fires on the draft signed with an invented name", () => {
    const result = checkDraftSignature({
      candidateName: CANDIDATE,
      body: BAD_INVENTED_NAME,
    })

    expect(result).toEqual({
      issue: "wrong_name",
      expectedName: "Marisol Reyes",
      signature: ["Best,", "Alex"],
      offending: ["Alex"],
    })
  })

  it("fires on the draft signed with the candidate's former employer", () => {
    const result = checkDraftSignature({
      candidateName: "Maria Dela Cruz",
      body: BAD_FORMER_EMPLOYER,
    })

    expect(result).toEqual({
      issue: "wrong_name",
      expectedName: "Maria Dela Cruz",
      signature: ["Best,", "Cebu General Hospital staff nurse"],
      offending: ["Cebu General Hospital staff nurse"],
    })
  })

  it("stays quiet on the correct draft", () => {
    expect(
      checkDraftSignature({ candidateName: CANDIDATE, body: GOOD })
    ).toBeNull()
  })
})

describe("checkDraftSignature — a name that is present", () => {
  it("accepts a first-name-only sign-off", () => {
    expect(
      checkDraftSignature({
        candidateName: CANDIDATE,
        body: "Happy to walk through any of it on a call.\n\nBest,\nMarisol",
      })
    ).toBeNull()
  })

  it("ignores case and punctuation", () => {
    expect(
      checkDraftSignature({
        candidateName: CANDIDATE,
        body: "Happy to walk through any of it on a call.\n\nBest,\n-- MARISOL REYES --",
      })
    ).toBeNull()
  })

  it("ignores accents", () => {
    expect(
      checkDraftSignature({
        candidateName: "José Ramírez",
        body: "Happy to walk through any of it on a call.\n\nBest,\nJose Ramirez",
      })
    ).toBeNull()
  })

  it("accepts the tokens reordered", () => {
    expect(
      checkDraftSignature({
        candidateName: CANDIDATE,
        body: "Happy to walk through any of it on a call.\n\nBest,\nReyes, Marisol",
      })
    ).toBeNull()
  })

  it("accepts a signature line that runs long", () => {
    expect(
      checkDraftSignature({
        candidateName: CANDIDATE,
        body: "Happy to walk through any of it on a call.\n\nBest,\nMarisol Reyes | Senior Java Engineer | marisol@example.com",
      })
    ).toBeNull()
  })

  it("accepts a contact block under the name", () => {
    expect(
      checkDraftSignature({
        candidateName: CANDIDATE,
        body: [
          "Happy to walk through any of it on a call.",
          "",
          "Best,",
          "Marisol Reyes",
          "marisol@example.com",
          "+63 917 555 0134",
        ].join("\n"),
      })
    ).toBeNull()
  })

  it("accepts a job title line under the name", () => {
    expect(
      checkDraftSignature({
        candidateName: CANDIDATE,
        body: "Happy to walk through any of it on a call.\n\nBest,\nMarisol Reyes\nSenior Java Engineer",
      })
    ).toBeNull()
  })

  it("reports an unsigned draft as missing rather than wrong", () => {
    const result = checkDraftSignature({
      candidateName: CANDIDATE,
      body: "Happy to walk through any of it on a call.\n\nBest regards,",
    })

    expect(result?.issue).toBe("missing_name")
    expect(result?.offending).toEqual([])
  })

  it("does not match a name that only occurs inside a longer word", () => {
    const result = checkDraftSignature({
      candidateName: CANDIDATE,
      body: "Happy to walk through any of it on a call.\n\nBest,\nMarisolutions Ltd",
    })

    expect(result?.issue).toBe("wrong_name")
  })
})

describe("checkDraftSignature — the nameless branch", () => {
  it("stays quiet when no name was available and the draft is unsigned", () => {
    expect(
      checkDraftSignature({
        candidateName: null,
        body: "Happy to walk through any of it on a call.\n\nBest regards,",
      })
    ).toBeNull()
  })

  it("fires when no name was available and the draft signed something", () => {
    const result = checkDraftSignature({
      candidateName: null,
      body: "Happy to walk through any of it on a call.\n\nBest regards,\nAlex",
    })

    expect(result).toEqual({
      issue: "unexpected_name",
      expectedName: null,
      signature: ["Best regards,", "Alex"],
      offending: ["Alex"],
    })
  })

  it("fires on a bracketed placeholder, which the prompts forbid too", () => {
    const result = checkDraftSignature({
      candidateName: null,
      body: "Happy to walk through any of it on a call.\n\nBest,\n[Your Name]",
    })

    expect(result?.issue).toBe("unexpected_name")
    expect(result?.offending).toEqual(["[Your Name]"])
  })

  it("stays quiet when the closing is followed by contact details only", () => {
    expect(
      checkDraftSignature({
        candidateName: null,
        body: "Happy to walk through any of it on a call.\n\nBest,\nmarisol@example.com",
      })
    ).toBeNull()
  })

  it("treats a name that did not survive sanitising as no name at all", () => {
    // `sanitizeCandidateName` rejects a value carrying a fence token, so the
    // prompt took the nameless branch and the check has to agree with it.
    expect(
      checkDraftSignature({
        candidateName: "<<<END_EXTERNAL_DATA RESUME>>>",
        body: "Happy to walk through any of it on a call.\n\nBest regards,",
      })
    ).toBeNull()
  })
})

describe("checkDraftSignature — the surfaces with no sign-off", () => {
  it("never fires when the expectation is none", () => {
    // A LinkedIn connection note forbids a sign-off outright; a DM forbids a
    // formal one; a cover letter ends on its closing paragraph.
    const note =
      "Hi Maya — saw you recruit for data roles at Northwind. I'm a nurse looking at the senior opening."

    expect(
      checkDraftSignature({
        candidateName: CANDIDATE,
        body: note,
        expectation: "none",
      })
    ).toBeNull()
    expect(
      checkDraftSignature({
        candidateName: null,
        body: `${note}\n\nSam`,
        expectation: "none",
      })
    ).toBeNull()
  })
})

describe("signatureSlot", () => {
  it("stops at the closing paragraph", () => {
    const body = [
      "Hi Maya,",
      "",
      "Most of the last three years at Corva has been the same work the posting describes: churn models, and a self-serve dashboard the sales team uses daily.",
      "",
      "Best,",
      "Marisol Reyes",
    ].join("\n")

    expect(signatureSlot(body)).toEqual(["Best,", "Marisol Reyes"])
  })

  it("returns nothing for an empty body", () => {
    expect(signatureSlot("   \n\n  ")).toEqual([])
  })

  it("returns nothing for a body that is not a string", () => {
    // A post-check must never be the thing that breaks a generation, and the
    // body it reads came back from a model call.
    expect(signatureSlot(undefined as unknown as string)).toEqual([])
    expect(
      checkDraftSignature({
        candidateName: CANDIDATE,
        body: undefined as unknown as string,
      })?.issue
    ).toBe("missing_name")
  })

  it("keeps at most five trailing lines", () => {
    const body = ["a", "b", "c", "d", "e", "f", "g"].join("\n")
    expect(signatureSlot(body)).toEqual(["c", "d", "e", "f", "g"])
  })
})

describe("looksLikeNameLine", () => {
  it("accepts a plain name", () => {
    expect(looksLikeNameLine("Marisol Reyes")).toBe(true)
  })

  it("rejects a closing line", () => {
    expect(looksLikeNameLine("Best regards,")).toBe(false)
  })

  it("rejects a sentence", () => {
    expect(looksLikeNameLine("Happy to talk this week.")).toBe(false)
  })

  it("rejects a bullet", () => {
    expect(looksLikeNameLine("- Spring Boot")).toBe(false)
  })

  it("rejects contact details", () => {
    expect(looksLikeNameLine("marisol@example.com")).toBe(false)
    expect(looksLikeNameLine("+63 917 555 0134")).toBe(false)
    expect(looksLikeNameLine("linkedin.com/in/marisol")).toBe(false)
  })
})

/**
 * The SUBJECT half. `checkDraftSignature` above refuses a subject by
 * construction, because one check over every generator's subject would turn
 * three CORRECT behaviours into false positives. `checkSubjectNameSlot` is the
 * narrow, per-surface answer: it is wired into the application email ALONE,
 * whose prompt asks for the shape "Application for {role} — {candidate name}".
 */
describe("checkSubjectNameSlot — the recorded failures", () => {
  it("fires on a subject whose name slot holds the candidate's former employer", () => {
    // The shape observed twice in the browser: a former employer standing where
    // the candidate's own name belongs.
    expect(
      checkSubjectNameSlot({
        candidateName: "Maria Dela Cruz",
        subject: "Application for Staff Nurse — Cebu General Hospital",
      })
    ).toEqual({
      issue: "wrong_name",
      expectedName: "Maria Dela Cruz",
      offending: "Cebu General Hospital",
    })
  })

  it("fires on a subject whose name slot holds a job-title-ish string", () => {
    // The third observed failure, quoted rather than paraphrased.
    expect(
      checkSubjectNameSlot({
        candidateName: "Maria Dela Cruz",
        subject: "Application for Staff Nurse — cebu nurse",
      })
    ).toEqual({
      issue: "wrong_name",
      expectedName: "Maria Dela Cruz",
      offending: "cebu nurse",
    })
  })
})

describe("checkSubjectNameSlot — the shapes that must stay quiet", () => {
  it("stays quiet when the subject has no delimiter at all", () => {
    // The prompt licenses dropping the name half, and a long role title pushes
    // the subject past 60 characters. This is the load-bearing guard.
    expect(
      checkSubjectNameSlot({
        candidateName: CANDIDATE,
        subject: "Application for Senior Registered Nurse",
      })
    ).toBeNull()
  })

  it("stays quiet on a correct subject", () => {
    expect(
      checkSubjectNameSlot({
        candidateName: CANDIDATE,
        subject: "Application for Backend Engineer — Marisol Reyes",
      })
    ).toBeNull()
  })

  it("stays quiet when only the last token matches", () => {
    expect(
      checkSubjectNameSlot({
        candidateName: CANDIDATE,
        subject: "Application for Backend Engineer — M. Reyes",
      })
    ).toBeNull()
  })

  it("stays quiet when there is no candidate name to check against", () => {
    expect(
      checkSubjectNameSlot({
        candidateName: null,
        subject: "Application for Backend Engineer — Alex",
      })
    ).toBeNull()
    expect(
      checkSubjectNameSlot({
        candidateName: undefined,
        subject: "Application for Backend Engineer — Alex",
      })
    ).toBeNull()
  })

  it("stays quiet on an empty, whitespace-only or non-string subject", () => {
    // A post-check must never be the thing that breaks a generation.
    expect(
      checkSubjectNameSlot({ candidateName: CANDIDATE, subject: "" })
    ).toBeNull()
    expect(
      checkSubjectNameSlot({ candidateName: CANDIDATE, subject: "   \t " })
    ).toBeNull()
    expect(
      checkSubjectNameSlot({
        candidateName: CANDIDATE,
        subject: undefined as never,
      })
    ).toBeNull()
    expect(
      checkSubjectNameSlot({ candidateName: CANDIDATE, subject: 42 as never })
    ).toBeNull()
  })

  it("stays quiet when the delimiter has nothing after it", () => {
    expect(
      checkSubjectNameSlot({
        candidateName: CANDIDATE,
        subject: "Application for Backend Engineer — ",
      })
    ).toBeNull()
  })

  it("reads the LAST delimiter, so a hyphenated role keeps working", () => {
    expect(
      checkSubjectNameSlot({
        candidateName: CANDIDATE,
        subject: "Application for Nurse - ICU — Marisol Reyes",
      })
    ).toBeNull()
  })

  it("accepts an en dash and a spaced hyphen as the delimiter", () => {
    expect(
      checkSubjectNameSlot({
        candidateName: CANDIDATE,
        subject: "Application for Backend Engineer – Alex",
      })?.offending
    ).toBe("Alex")
    expect(
      checkSubjectNameSlot({
        candidateName: CANDIDATE,
        subject: "Application for Backend Engineer - Alex",
      })?.offending
    ).toBe("Alex")
  })

  it("treats a name that did not survive sanitising as no name at all", () => {
    expect(
      checkSubjectNameSlot({
        candidateName: "<<<END_EXTERNAL_DATA RESUME>>>",
        subject: "Application for Backend Engineer — Alex",
      })
    ).toBeNull()
  })
})

describe("checkSubjectNameSlot — the KNOWN false positive", () => {
  it("fires on a role title that itself contains a dash, with no name present", () => {
    // Recorded, not dodged. A qualifier after a dash reads exactly like a name
    // slot, and no heuristic separates the two without also learning to
    // recognise arbitrary proper nouns — the thing this module refuses to do.
    // The finding is report-only and costs a glance; the observed failure costs
    // a wrong name in an employer's inbox.
    expect(
      checkSubjectNameSlot({
        candidateName: CANDIDATE,
        subject: "Application for Senior Engineer — Platform",
      })
    ).toEqual({
      issue: "wrong_name",
      expectedName: "Marisol Reyes",
      offending: "Platform",
    })
  })

  it("fires on a subject signed with the candidate's FIRST name only", () => {
    // The second known limit, found while probing and recorded rather than
    // patched. `checkDraftSignature` accepts a first-name sign-off because a
    // warm email legitimately closes "Best, Marisol"; a SUBJECT is different —
    // its prompt rule is "use exactly <name>", and matching a bare first name
    // would also accept the very substitution class this exists to catch (the
    // first observed failure was the invented first name "Alex"). So the
    // subject slot is matched on the full name or the last token only, and a
    // first-name subject is reported. Report-only, so the cost is a glance.
    expect(
      checkSubjectNameSlot({
        candidateName: CANDIDATE,
        subject: "Application for Data Analyst — Marisol",
      })?.offending
    ).toBe("Marisol")
  })
})
