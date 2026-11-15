import { describe, it, expect } from "vitest"
import {
  JOB_REQUIREMENT_FLAGS,
  extractJobRequirements,
} from "../job-requirements.service"

/** An ordinary posting that states no eligibility restriction at all. */
const CLEAN_DESCRIPTION = [
  "We are looking for a Senior Frontend Engineer to join our product team.",
  "You will own the design system, ship React and TypeScript features, and work",
  "closely with design and backend engineers.",
  "Requirements: 5+ years of professional frontend experience and strong TypeScript.",
  "Benefits include healthcare, a learning budget and 25 days of paid leave.",
].join(" ")

describe("extractJobRequirements — nothing to flag", () => {
  it("returns an empty array for an ordinary posting", () => {
    expect(extractJobRequirements({ jobDescription: CLEAN_DESCRIPTION })).toEqual([])
  })

  it("returns an empty array with no input at all", () => {
    expect(extractJobRequirements({})).toEqual([])
    expect(extractJobRequirements({ jobDescription: null, location: null })).toEqual([])
  })

  it("does not flag a plain remote posting", () => {
    expect(
      extractJobRequirements({
        jobDescription: "This is a fully remote role open to candidates worldwide.",
        location: "Remote",
      })
    ).toEqual([])
  })
})

describe("extractJobRequirements — US / location restrictions", () => {
  it.each([
    "This role is US only.",
    "We are hiring U.S. only for this position.",
    "This is a US-based position.",
    "You must be based in the United States.",
    "Candidates must reside in the US.",
    "US residents only, please.",
    "Open to anyone within the United States.",
  ])("flags US_ONLY for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.US_ONLY
    )
  })

  it.each([
    "Come work with us based in London.",
    "Our teams across the US serve customers in 40 countries.",
    "Contact us only via email, we do not take calls.",
    "Tell us based on your experience which team fits you.",
    "Join us based out of our Berlin studio.",
  ])("does not flag US_ONLY for the prose %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).not.toContain(
      JOB_REQUIREMENT_FLAGS.US_ONLY
    )
  })

  it("flags US_ONLY from the location field alone", () => {
    expect(extractJobRequirements({ location: "Remote (US only)" })).toContain(
      JOB_REQUIREMENT_FLAGS.US_ONLY
    )
  })

  it("flags LOCATION_RESTRICTED for a non-US restriction", () => {
    expect(
      extractJobRequirements({
        jobDescription: "You must be located in Berlin or the surrounding area.",
      })
    ).toEqual([JOB_REQUIREMENT_FLAGS.LOCATION_RESTRICTED])
  })

  it("lets US_ONLY and LOCATION_RESTRICTED co-fire", () => {
    const flags = extractJobRequirements({
      jobDescription: "US only. You must be based in Austin, TX.",
    })
    expect(flags).toContain(JOB_REQUIREMENT_FLAGS.US_ONLY)
    expect(flags).toContain(JOB_REQUIREMENT_FLAGS.LOCATION_RESTRICTED)
  })
})

describe("extractJobRequirements — citizenship, residency, clearance", () => {
  it.each([
    "US citizenship is required for this role.",
    "You must be a US citizen.",
    "US citizens only.",
    "This position requires US citizenship.",
  ])("flags CITIZENSHIP_REQUIRED for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.CITIZENSHIP_REQUIRED
    )
  })

  it.each([
    "Applicants must be permanent residents.",
    "Open to green card holders.",
    "We consider lawful permanent residents.",
  ])("flags RESIDENCY_REQUIRED for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.RESIDENCY_REQUIRED
    )
  })

  it.each([
    "An active security clearance is needed.",
    "TS/SCI required.",
    "Secret clearance required.",
    "Clearance is required before start.",
  ])("flags SECURITY_CLEARANCE for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.SECURITY_CLEARANCE
    )
  })
})

describe("extractJobRequirements — sponsorship precedence", () => {
  it.each([
    "We offer no visa sponsorship for this role.",
    "Sponsorship is not available.",
    "We are unable to offer visa sponsorship.",
    "We cannot sponsor applicants at this time.",
    "Candidates must be able to work without sponsorship now or in the future.",
    "No sponsorship available.",
  ])("flags NO_SPONSORSHIP for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP
    )
  })

  it.each([
    "We are unable to offer visa sponsorship.",
    "No visa sponsorship available.",
    "Sponsorship is not offered.",
  ])("never emits SPONSORSHIP_AVAILABLE for the negated phrase %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).not.toContain(
      JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE
    )
  })

  it.each([
    "Visa sponsorship is available for this role.",
    "We sponsor work visas for exceptional candidates.",
    "We provide visa sponsorship.",
    "We are open to visa sponsorship.",
    "The company is willing to sponsor.",
  ])("flags SPONSORSHIP_AVAILABLE for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE
    )
  })

  it("never emits both sponsorship flags at once", () => {
    const flags = extractJobRequirements({
      jobDescription:
        "Visa sponsorship is available for senior roles. For this one we cannot sponsor.",
    })
    expect(flags).toContain(JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP)
    expect(flags).not.toContain(JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE)
  })
})

describe("extractJobRequirements — work authorisation and onsite", () => {
  it.each([
    "You must be authorized to work in the country of employment.",
    "Work authorization is required.",
    "You need the right to work in Canada.",
    "Applicants must be legally able to work here.",
  ])("flags WORK_AUTH_REQUIRED for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.WORK_AUTH_REQUIRED
    )
  })

  it.each([
    "On-site required.",
    "This is an onsite only role.",
    "You will be in-office 3 days per week.",
    "No remote work for this position.",
    "This is not a remote role.",
  ])("flags ONSITE_REQUIRED for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.ONSITE_REQUIRED
    )
  })
})

describe("extractJobRequirements — output shape", () => {
  it("is deduped and in declaration order regardless of where phrases appear", () => {
    const flags = extractJobRequirements({
      jobDescription: [
        "We cannot sponsor visas.",
        "On-site required.",
        "US citizens only.",
        "US only.",
        "US only, again.",
        "Work authorization is required.",
      ].join(" "),
    })

    expect(flags).toEqual([
      JOB_REQUIREMENT_FLAGS.US_ONLY,
      JOB_REQUIREMENT_FLAGS.CITIZENSHIP_REQUIRED,
      JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP,
      JOB_REQUIREMENT_FLAGS.WORK_AUTH_REQUIRED,
      JOB_REQUIREMENT_FLAGS.ONSITE_REQUIRED,
    ])
  })

  it("is case-insensitive", () => {
    expect(extractJobRequirements({ jobDescription: "US CITIZENS ONLY." })).toContain(
      JOB_REQUIREMENT_FLAGS.CITIZENSHIP_REQUIRED
    )
  })
})

describe("extractJobRequirements — German postings", () => {
  /** An ordinary German posting that states no eligibility restriction at all. */
  const CLEAN_GERMAN_DESCRIPTION = [
    "Wir suchen eine Frontend-Entwicklerin für unser Produktteam.",
    "Du arbeitest mit React und TypeScript an unserem Designsystem.",
    "Standort Deutschland, teilweise vor Ort, Homeoffice möglich.",
    "Wir bieten Sponsoring von Weiterbildungen und 30 Tage Urlaub.",
  ].join(" ")

  it("returns an empty array for an ordinary German posting", () => {
    expect(extractJobRequirements({ jobDescription: CLEAN_GERMAN_DESCRIPTION })).toEqual([])
  })

  it.each([
    "Eine gültige Arbeitserlaubnis für Deutschland ist erforderlich.",
    "Eine Arbeitsgenehmigung muss vorliegen.",
    "Du benötigst eine Aufenthaltserlaubnis.",
    "Ein gültiger Aufenthaltstitel ist Voraussetzung.",
    "Eine EU-Arbeitserlaubnis setzen wir voraus.",
  ])("flags WORK_AUTH_REQUIRED for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.WORK_AUTH_REQUIRED
    )
  })

  it.each([
    "Standort Deutschland, das Team arbeitet international.",
    "Die Arbeit ist teilweise vor Ort in unserem Büro.",
    "Wir erledigen die Arbeit gemeinsam im Team.",
  ])("does not flag WORK_AUTH_REQUIRED for the prose %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).not.toContain(
      JOB_REQUIREMENT_FLAGS.WORK_AUTH_REQUIRED
    )
  })

  it.each([
    "Die deutsche Staatsbürgerschaft ist Voraussetzung.",
    "Wir setzen die deutsche Staatsangehörigkeit voraus.",
    "Eine Staatsbürgerschaft der EU ist zwingend erforderlich.",
    "Wir stellen nur EU-Bürger ein.",
    "Ausschließlich für EU-Bürgerinnen und EU-Bürger.",
  ])("flags CITIZENSHIP_REQUIRED for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.CITIZENSHIP_REQUIRED
    )
  })

  it.each([
    "Unser Team besteht aus EU-Bürgern und Kolleginnen aus aller Welt.",
    "Standort Deutschland mit Kunden in ganz Europa.",
    "Wir feiern die Staatsbürgerschaft unserer internationalen Belegschaft.",
  ])("does not flag CITIZENSHIP_REQUIRED for the prose %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).not.toContain(
      JOB_REQUIREMENT_FLAGS.CITIZENSHIP_REQUIRED
    )
  })

  it.each([
    "Eine Niederlassungserlaubnis ist erforderlich.",
    "Bewerber mit Daueraufenthalt-EU sind willkommen.",
    "Ein unbefristeter Aufenthaltstitel wird vorausgesetzt.",
  ])("flags RESIDENCY_REQUIRED for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.RESIDENCY_REQUIRED
    )
  })

  it.each([
    "Wir haben Niederlassungen in Berlin und München.",
    "Der Aufenthalt im Büro ist freiwillig.",
  ])("does not flag RESIDENCY_REQUIRED for the prose %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).not.toContain(
      JOB_REQUIREMENT_FLAGS.RESIDENCY_REQUIRED
    )
  })

  it.each([
    "Wir bieten kein Visa-Sponsoring an.",
    "Keine Unterstützung bei der Visa-Beantragung.",
    "Ein Visum-Sponsoring ist leider nicht möglich.",
    "Die Stelle ist ohne Visa-Sponsoring zu besetzen.",
  ])("flags NO_SPONSORSHIP for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP
    )
  })

  it.each([
    "Wir bieten kein Visa-Sponsoring an.",
    "Ein Visum-Sponsoring ist leider nicht möglich.",
    "Wir bieten keine Unterstützung bei der Visa-Beantragung.",
  ])("never emits SPONSORSHIP_AVAILABLE for the negated phrase %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).not.toContain(
      JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE
    )
  })

  it.each([
    "Ein Visa-Sponsoring ist möglich.",
    "Wir bieten ein Visum für internationale Bewerber.",
    "Unterstützung bei der Visa-Beantragung erhältst du von uns.",
  ])("flags SPONSORSHIP_AVAILABLE for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE
    )
  })

  it.each([
    "Wir bieten Sponsoring von Weiterbildungen und Konferenzen.",
    "Das Sponsoring unseres lokalen Fußballvereins ist uns wichtig.",
  ])("does not flag either sponsorship flag for the prose %j", (jobDescription) => {
    const flags = extractJobRequirements({ jobDescription })
    expect(flags).not.toContain(JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE)
    expect(flags).not.toContain(JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP)
  })

  it.each([
    "Ein Wohnsitz in Berlin ist erforderlich.",
    "Du bist wohnhaft in Nordrhein-Westfalen.",
    "Bewerber müssen in Deutschland ansässig sein.",
    "Du musst in München wohnen.",
  ])("flags LOCATION_RESTRICTED for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.LOCATION_RESTRICTED
    )
  })

  it.each([
    "Standort Deutschland, Remote-Arbeit aus ganz Europa möglich.",
    "Unser Büro liegt in Berlin-Kreuzberg.",
    "Teilweise vor Ort, der Rest im Homeoffice.",
  ])("does not flag LOCATION_RESTRICTED for the prose %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).not.toContain(
      JOB_REQUIREMENT_FLAGS.LOCATION_RESTRICTED
    )
  })

  it.each([
    "Die Tätigkeit erfolgt ausschließlich vor Ort.",
    "Die Stelle ist nur vor Ort zu besetzen.",
    "Die Arbeit erfolgt zu 100 % vor Ort.",
    "Arbeiten vor Ort ist erforderlich.",
    "Es gilt Präsenzpflicht in unserem Büro.",
    "Wir bieten kein Homeoffice an.",
    "Remote ist bei uns nicht möglich.",
  ])("flags ONSITE_REQUIRED for %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).toContain(
      JOB_REQUIREMENT_FLAGS.ONSITE_REQUIRED
    )
  })

  it.each([
    "Die Arbeit ist teilweise vor Ort möglich.",
    "Homeoffice möglich, zwei Tage vor Ort.",
    "Unsere Teams arbeiten vor Ort und remote zusammen.",
    "Standort Deutschland, Homeoffice nach Absprache.",
  ])("does not flag ONSITE_REQUIRED for the prose %j", (jobDescription) => {
    expect(extractJobRequirements({ jobDescription })).not.toContain(
      JOB_REQUIREMENT_FLAGS.ONSITE_REQUIRED
    )
  })

  it("keeps the declaration order for a mixed German posting", () => {
    const flags = extractJobRequirements({
      jobDescription: [
        "Die Tätigkeit erfolgt ausschließlich vor Ort.",
        "Eine gültige Arbeitserlaubnis ist erforderlich.",
        "Wir bieten kein Visa-Sponsoring an.",
      ].join(" "),
    })

    expect(flags).toEqual([
      JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP,
      JOB_REQUIREMENT_FLAGS.WORK_AUTH_REQUIRED,
      JOB_REQUIREMENT_FLAGS.ONSITE_REQUIRED,
    ])
  })

  it("still reads an English posting the same way", () => {
    expect(extractJobRequirements({ jobDescription: CLEAN_DESCRIPTION })).toEqual([])
  })
})
