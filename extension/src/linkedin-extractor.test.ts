import { describe, expect, it } from "vitest"
import { extractLinkedInProfile } from "./linkedin-extractor"
import fullProfile from "./__fixtures__/linkedin-profile.html?raw"
import ogOnlyProfile from "./__fixtures__/linkedin-og-only.html?raw"
import voyagerProfile from "./__fixtures__/linkedin-voyager.html?raw"
import voyagerPartial from "./__fixtures__/linkedin-voyager-partial.html?raw"
import voyagerMalformed from "./__fixtures__/linkedin-voyager-malformed.html?raw"
import loggedInProfile from "./__fixtures__/linkedin-logged-in.html?raw"

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html")
}

describe("extractLinkedInProfile", () => {
  it("reads a full profile top card and About section", () => {
    const person = extractLinkedInProfile(parse(fullProfile))

    expect(person.name).toBe("Maria Santos")
    expect(person.headline).toBe("VP Engineering at Northwind Labs | Scaling platform teams")
    expect(person.company).toBe("Northwind Labs")
    expect(person.about).toContain("I lead a 40-person platform org.")
    // Headings, screen-reader duplicates and the see-more toggle are dropped.
    expect(person.about).not.toContain("About")
    expect(person.about).not.toContain("see more")
    expect(person.about?.split("I lead a 40-person platform org.").length).toBe(2)
    // Query string is stripped.
    expect(person.profileUrl).toBe("https://www.linkedin.com/in/maria-santos/")
  })

  it("falls back to og meta when the profile markup is not rendered", () => {
    const person = extractLinkedInProfile(parse(ogOnlyProfile))

    expect(person.name).toBe("Dexter Chua")
    expect(person.headline).toBe("Staff Data Scientist at Contoso Ltd")
    expect(person.company).toBe("Contoso Ltd")
    expect(person.about).toContain("Staff Data Scientist building forecasting systems.")
    expect(person.profileUrl).toBe("https://www.linkedin.com/in/dexter-chua")
  })

  it("uses a substantial page selection as the about text", () => {
    document.head.innerHTML = `<meta property="og:title" content="Ana Reyes - Recruiter | LinkedIn" />`
    document.body.innerHTML = `<main><h1>Ana Reyes</h1><div class="text-body-medium break-words">Recruiter at Initech</div><p id="sel">${"She hires platform engineers across APAC. ".repeat(
      10
    )}</p></main>`
    const range = document.createRange()
    range.selectNodeContents(document.getElementById("sel")!)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const person = extractLinkedInProfile(document)

    expect(person.name).toBe("Ana Reyes")
    expect(person.headline).toBe("Recruiter at Initech")
    expect(person.about).toContain("She hires platform engineers across APAC.")
    expect((person.about ?? "").length).toBeGreaterThanOrEqual(200)

    selection?.removeAllRanges()
    document.head.innerHTML = ""
    document.body.innerHTML = ""
  })

  it("returns nothing for an empty page instead of throwing", () => {
    const doc = parse("<!doctype html><html><head></head><body></body></html>")

    expect(() => extractLinkedInProfile(doc)).not.toThrow()
    expect(extractLinkedInProfile(doc)).toEqual({})
  })

  it("recovers a profile from embedded Voyager JSON when the markup has drifted", () => {
    const person = extractLinkedInProfile(parse(voyagerProfile))

    expect(person.name).toBe("Priya Nandakumar")
    expect(person.headline).toBe("Director of Platform Engineering at Helio Systems")
    // The current position wins over the one with an end date.
    expect(person.company).toBe("Helio Systems")
    expect(person.about).toContain("I build the platforms other teams build on.")
    expect(person.about).toContain("Currently running reliability")
    expect(person.sources).toEqual({
      name: "json",
      headline: "json",
      company: "json",
      about: "json",
    })
  })

  it("merges per field: JSON name plus DOM headline", () => {
    const person = extractLinkedInProfile(parse(voyagerPartial))

    expect(person.name).toBe("Jules Moreau")
    expect(person.headline).toBe("Principal Designer at Foxglove")
    expect(person.company).toBeUndefined()
    expect(person.sources).toEqual({
      name: "json",
      headline: "dom",
      company: null,
      about: null,
    })
  })

  it("skips malformed JSON blobs and reads a later valid one", () => {
    const doc = parse(voyagerMalformed)

    expect(() => extractLinkedInProfile(doc)).not.toThrow()
    const person = extractLinkedInProfile(doc)
    expect(person.name).toBe("Hana Okafor")
    expect(person.headline).toBe("Head of Talent at Brightline")
    // The position carries the company through `miniCompany.name`, not `companyName`.
    expect(person.company).toBe("Brightline")
    expect(person.about).toBe("Hiring product engineers in Lisbon and Berlin.")
  })

  // Observed on a live linkedin.com/in/* page: every `<code>` payload is wrapped in an
  // HTML comment, so `textContent` is empty and only the comment node holds the JSON.
  it("reads a JSON payload wrapped in an HTML comment", () => {
    const json = JSON.stringify({
      included: [
        { firstName: "Ines", lastName: "Roth", headline: "CTO at Wavefront", summary: "Systems person." },
      ],
    })
    const doc = parse(
      `<html><head></head><body><div class="_q1w2">x</div><code id="bpr-guid-9"><!--${json}--></code></body></html>`
    )

    const person = extractLinkedInProfile(doc)

    expect(person.name).toBe("Ines Roth")
    expect(person.headline).toBe("CTO at Wavefront")
    expect(person.about).toBe("Systems person.")
    expect(person.sources?.name).toBe("json")
  })

  // Distilled from two real logged-in profiles saved from the 2026 server-driven-UI
  // rewrite: no <h1>, no og:* meta, no link[rel=canonical] and no <code> payload at all.
  it("reads a server-driven-UI profile page", () => {
    const person = extractLinkedInProfile(parse(loggedInProfile))

    expect(person.name).toBe("Jane Fixture")
    expect(person.headline).toBe("Staff Placeholder Engineer | Building sample systems")
    // The school chip comes first in the markup; only the company chip may answer here.
    expect(person.company).toBe("Placeholder Industries")
    expect(person.about).toBe(
      "I build sample systems for fixtures.\n\nSecond paragraph of the placeholder about copy."
    )
    // The activity feed's expandable text boxes must not be mistaken for the About copy.
    expect(person.about).not.toContain("feed post")
    expect(person.about).not.toContain("more")
    expect(person.sources).toEqual({
      name: "dom",
      headline: "dom",
      company: "dom",
      about: "dom",
    })
  })

  it("caps about at 5000 characters", () => {
    const doc = parse(
      `<html><head></head><body><main><h1>Long Poster</h1><section><div id="about"></div><div>${"x".repeat(
        6000
      )}</div></section></main></body></html>`
    )

    expect(extractLinkedInProfile(doc).about).toHaveLength(5000)
  })
})
