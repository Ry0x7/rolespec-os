import { describe, expect, it } from "vitest"
import { extractJobPosting } from "./extractor"
import cleanJsonLd from "./__fixtures__/clean-jsonld.html?raw"
import graphJsonLd from "./__fixtures__/graph-jsonld.html?raw"
import noStructuredData from "./__fixtures__/no-structured-data.html?raw"
import malformedJsonLd from "./__fixtures__/malformed-jsonld.html?raw"
import kalibrrMicrodata from "./__fixtures__/kalibrr-microdata.html?raw"

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html")
}

describe("extractJobPosting", () => {
  it("reads a clean schema.org JobPosting", () => {
    const job = extractJobPosting(parse(cleanJsonLd))

    expect(job.jobTitle).toBe("Senior Backend Engineer")
    expect(job.companyName).toBe("Northwind Labs")
    expect(job.location).toBe("Makati, Metro Manila, PH")
    expect(job.salary).toBe(120000)
    // unitText sits on the nested QuantitativeValue, currency on the MonetaryAmount.
    expect(job.salaryPeriod).toBe("MONTHLY")
    expect(job.salaryCurrency).toBe("PHP")
    expect(job.jobType).toBe("FULL_TIME")
    // HTML is stripped to text and entities decoded.
    expect(job.jobDescription).toContain("We need a backend engineer.")
    expect(job.jobDescription).toContain("Go & Postgres")
    expect(job.jobDescription).not.toContain("<")
    // jobLink is the popup's job, never the extractor's.
    expect(job.jobLink).toBeUndefined()
  })

  it("finds a JobPosting nested in an @graph inside an array", () => {
    const job = extractJobPosting(parse(graphJsonLd))

    expect(job.jobTitle).toBe("Product Designer (Contract)")
    expect(job.companyName).toBe("Contoso Ltd")
    expect(job.location).toBe("Remote — Philippines")
    expect(job.jobType).toBe("CONTRACT")
    // No jobLocationType in that fixture: the location text is the only signal.
    expect(job.workType).toBe("REMOTE")
    // The fixture's baseSalary is a 75000–95000 range: the numeric field holds
    // the factual "from" value (never an invented midpoint), and the full band
    // is exposed separately as a display-only string.
    expect(job.salary).toBe(75000)
    expect(job.salaryRangeText).toBe("75,000–95,000")
    // That posting states neither a unitText nor a currency.
    expect(job.salaryPeriod).toBeUndefined()
    expect(job.salaryCurrency).toBeUndefined()
    expect(job.jobDescription).toBe("Design end-to-end product flows.")
  })

  const salaryDoc = (baseSalary: unknown): Document =>
    parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Paid Person",
        hiringOrganization: { name: "Payer Inc" },
        baseSalary,
      })}</script></head><body></body></html>`
    )

  it("reads an hourly USD salary with the unit and currency flattened onto the amount", () => {
    const job = extractJobPosting(
      salaryDoc({ "@type": "MonetaryAmount", currency: "usd", unitText: "HOUR", value: 45 })
    )

    expect(job.salary).toBe(45)
    expect(job.salaryPeriod).toBe("HOURLY")
    expect(job.salaryCurrency).toBe("USD")
  })

  it("maps a yearly unitText and drops a currency RoleSpec cannot store", () => {
    const job = extractJobPosting(
      salaryDoc({
        "@type": "MonetaryAmount",
        currency: "EUR",
        value: { "@type": "QuantitativeValue", value: 90000, unitText: "YEAR" },
      })
    )

    expect(job.salaryPeriod).toBe("YEARLY")
    expect(job.salaryCurrency).toBeUndefined()
  })

  it("drops an unmapped salary unit such as WEEK", () => {
    const job = extractJobPosting(
      salaryDoc({ "@type": "MonetaryAmount", currency: "PHP", unitText: "WEEK", value: 8000 })
    )

    expect(job.salaryPeriod).toBeUndefined()
    expect(job.salaryCurrency).toBe("PHP")
  })

  it("uses the factual minValue (not an invented midpoint) and exposes the full range as text", () => {
    const job = extractJobPosting(
      salaryDoc({
        "@type": "MonetaryAmount",
        currency: "USD",
        value: {
          "@type": "QuantitativeValue",
          minValue: 211400,
          maxValue: 290600,
          unitText: "YEAR",
        },
      })
    )

    expect(job.salary).toBe(211400)
    expect(job.salaryRangeText).toBe("211,400–290,600 USD / YEARLY")
    expect(job.salaryPeriod).toBe("YEARLY")
    expect(job.salaryCurrency).toBe("USD")
  })

  it("uses minValue alone when maxValue is absent, with no range text", () => {
    const job = extractJobPosting(
      salaryDoc({
        "@type": "MonetaryAmount",
        currency: "USD",
        value: { "@type": "QuantitativeValue", minValue: 211400, unitText: "YEAR" },
      })
    )

    expect(job.salary).toBe(211400)
    expect(job.salaryRangeText).toBeUndefined()
  })

  it("uses maxValue alone when minValue is absent, with no range text", () => {
    const job = extractJobPosting(
      salaryDoc({
        "@type": "MonetaryAmount",
        currency: "USD",
        value: { "@type": "QuantitativeValue", maxValue: 290600, unitText: "YEAR" },
      })
    )

    expect(job.salary).toBe(290600)
    expect(job.salaryRangeText).toBeUndefined()
  })

  it("prefers an explicit value over minValue/maxValue when both are present, with no range text", () => {
    const job = extractJobPosting(
      salaryDoc({
        "@type": "MonetaryAmount",
        currency: "USD",
        value: {
          "@type": "QuantitativeValue",
          value: 250000,
          minValue: 211400,
          maxValue: 290600,
          unitText: "YEAR",
        },
      })
    )

    expect(job.salary).toBe(250000)
    expect(job.salaryRangeText).toBeUndefined()
  })

  it("collapses a range with equal min and max to that value, with no range text", () => {
    const job = extractJobPosting(
      salaryDoc({
        "@type": "MonetaryAmount",
        currency: "USD",
        value: { "@type": "QuantitativeValue", minValue: 100000, maxValue: 100000, unitText: "YEAR" },
      })
    )

    expect(job.salary).toBe(100000)
    expect(job.salaryRangeText).toBeUndefined()
  })

  it("uses a node-level minValue/maxValue range when not nested under value", () => {
    const job = extractJobPosting(
      salaryDoc({
        "@type": "MonetaryAmount",
        currency: "USD",
        minValue: 60000,
        maxValue: 80000,
      })
    )

    expect(job.salary).toBe(60000)
    expect(job.salaryRangeText).toBe("60,000–80,000 USD")
  })

  it("falls back to title and meta heuristics with no structured data", () => {
    const job = extractJobPosting(parse(noStructuredData))

    expect(job.jobTitle).toBe("Junior QA Analyst")
    expect(job.companyName).toBe("Initech")
    expect(job.jobDescription).toContain("Initech is hiring a Junior QA Analyst")
    expect(job.salary).toBeUndefined()
    expect(job.jobType).toBeUndefined()
  })

  it("does not throw on malformed JSON-LD and still uses fallbacks", () => {
    const doc = parse(malformedJsonLd)

    expect(() => extractJobPosting(doc)).not.toThrow()
    const job = extractJobPosting(doc)
    expect(job.jobTitle).toBe("Data Engineer")
    expect(job.companyName).toBe("Umbrella Corp")
  })

  it("maps employmentType TEMPORARY to the TEMPORARY job type", () => {
    const doc = parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Holiday Warehouse Associate",
        hiringOrganization: { name: "Seasonal Goods Co" },
        employmentType: "TEMPORARY",
      })}</script></head><body></body></html>`
    )

    expect(extractJobPosting(doc).jobType).toBe("TEMPORARY")
  })

  it("maps jobLocationType TELECOMMUTE to the REMOTE work type", () => {
    const doc = parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Support Specialist",
        hiringOrganization: { name: "Telecom Co" },
        jobLocationType: "TELECOMMUTE",
      })}</script></head><body></body></html>`
    )

    expect(extractJobPosting(doc).workType).toBe("REMOTE")
  })

  it("maps a VirtualLocation jobLocation to the REMOTE work type", () => {
    const doc = parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Community Manager",
        hiringOrganization: { name: "Virtual Inc" },
        jobLocation: [{ "@type": "VirtualLocation" }],
      })}</script></head><body></body></html>`
    )

    expect(extractJobPosting(doc).workType).toBe("REMOTE")
  })

  it("reads HYBRID from the location, and prefers hybrid over a remote mention", () => {
    const doc = parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Account Executive",
        hiringOrganization: { name: "Midtown Group" },
        jobLocation: { address: { addressLocality: "Makati (hybrid, remote-friendly)" } },
        description: "Own the pipeline end to end.",
      })}</script></head><body></body></html>`
    )

    expect(extractJobPosting(doc).workType).toBe("HYBRID")
  })

  it("lets the description set the work type only through a strong phrase", () => {
    const doc = parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Customer Success Manager",
        hiringOrganization: { name: "Homebound Co" },
        jobLocation: { address: { addressLocality: "Quezon City" } },
        description: "You will work from home five days a week.",
      })}</script></head><body></body></html>`
    )

    expect(extractJobPosting(doc).workType).toBe("REMOTE")
  })

  it("ignores bare remote/hybrid keywords buried in the description", () => {
    const doc = parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Platform Engineer",
        hiringOrganization: { name: "Cloudy Inc" },
        jobLocation: { address: { addressLocality: "Taguig" } },
        description: "Experience with hybrid cloud and remote teams is a plus.",
      })}</script></head><body></body></html>`
    )

    expect(extractJobPosting(doc).workType).toBeUndefined()
  })

  it("leaves the work type unset when nothing signals one", () => {
    const doc = parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Staff Accountant",
        hiringOrganization: { name: "Ledger Co" },
        jobLocation: { address: { addressLocality: "Cebu City" } },
        description: "Own the monthly close and reconciliations.",
      })}</script></head><body></body></html>`
    )

    expect(extractJobPosting(doc).workType).toBeUndefined()
  })

  it("caps the description at 20000 characters", () => {
    const long = "x".repeat(25000)
    const doc = parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Long Poster",
        hiringOrganization: { name: "Verbose Inc" },
        description: long,
      })}</script></head><body></body></html>`
    )

    const job = extractJobPosting(doc)
    expect(job.jobDescription).toHaveLength(20000)
  })

  it("uses a substantial page selection as the description", () => {
    document.body.innerHTML = `<p id="sel">${"Responsibilities include shipping features. ".repeat(
      10
    )}</p>`
    document.title = "Platform Engineer - Selecto"
    const range = document.createRange()
    range.selectNodeContents(document.getElementById("sel")!)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const job = extractJobPosting(document)

    expect(job.jobTitle).toBe("Platform Engineer")
    expect(job.companyName).toBe("Selecto")
    expect(job.jobDescription).toContain("Responsibilities include shipping features.")
    expect((job.jobDescription ?? "").length).toBeGreaterThanOrEqual(200)
  })
  // ── Location fallbacks ─────────────────────────────────────────────────────
  // Most Philippine boards publish no JSON-LD `jobLocation` at all, which used to
  // save the clip with no location — and a posting with no location cannot be
  // ranked against the user's market. Each tier below is one page pattern.

  const page = (body: string, head = ""): Document =>
    parse(`<html><head><title>Role - Co</title>${head}</head><body>${body}</body></html>`)

  it("joins every place a JSON-LD jobLocation array names", () => {
    const doc = parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Field Engineer",
        hiringOrganization: { name: "Multi Co" },
        jobLocation: [
          { address: { addressLocality: "Makati" } },
          { address: { addressLocality: "Cebu City" } },
          // A duplicate is not a second office.
          { address: { addressLocality: "Makati" } },
        ],
      })}</script></head><body></body></html>`
    )

    expect(extractJobPosting(doc).location).toBe("Makati · Cebu City")
  })

  it("reads a microdata jobLocation when there is no JSON-LD", () => {
    const job = extractJobPosting(page('<span itemprop="jobLocation">Quezon City, PH</span>'))

    expect(job.location).toBe("Quezon City, PH")
  })

  it("prefers the itemised address to a jobLocation element that repeats it", () => {
    // The Kalibrr shape: the visible address line and the microdata spans live
    // inside the same `jobLocation` element, so its text says the place twice.
    const job = extractJobPosting(
      page(
        '<div itemprop="jobLocation">Makati, Metro Manila, Philippines' +
          '<span itemprop="addressLocality">Makati</span>' +
          '<span itemprop="addressRegion">Metro Manila</span>' +
          '<span itemprop="addressCountry">Philippines</span>' +
          "</div>"
      )
    )

    expect(job.location).toBe("Makati, Metro Manila, Philippines")
  })

  it("assembles a microdata postal address", () => {
    const job = extractJobPosting(
      page(
        '<span itemprop="addressLocality">Cagayan de Oro</span>' +
          '<span itemprop="addressRegion">Misamis Oriental</span>' +
          '<span itemprop="addressCountry">PH</span>'
      )
    )

    expect(job.location).toBe("Cagayan de Oro, Misamis Oriental, PH")
  })

  it("reads a labelled location line out of the page text", () => {
    const job = extractJobPosting(page("<p>Work Location: Cagayan de Oro, Philippines</p>"))

    expect(job.location).toBe("Cagayan de Oro, Philippines")
  })

  it("ignores a labelled line whose value reads as a sentence", () => {
    const sentence =
      "our teams are distributed across the Philippines, Singapore and Vietnam, and " +
      "we expect you to travel to whichever office your squad is currently sitting in."
    expect(sentence.length).toBeGreaterThan(120)

    const job = extractJobPosting(page(`<p>Location: ${sentence}</p>`))

    expect(job.location).toBeUndefined()
  })

  it("reads a job board's location test id", () => {
    const job = extractJobPosting(page('<div data-testid="job-detail-location">Taguig</div>'))

    expect(job.location).toBe("Taguig")
  })

  it("reads a location-classed element, skipping ones too long to be a place", () => {
    const job = extractJobPosting(
      page(
        '<div class="JobCard__locationBlurb">' +
          "Somewhere among the many offices we keep spread right across the whole of Southeast Asia" +
          "</div><div class=\"JobCard__location\">Pasig City, PH</div>"
      )
    )

    expect(job.location).toBe("Pasig City, PH")
  })

  // Measured on bossjob.ph, which serves `og:locale: en-us` on Philippine
  // postings: the tag is the page's language, not the job's country, and reading
  // it as a location saved a worldwide-remote job as "United States".
  it("never turns the page locale into a location", () => {
    const job = extractJobPosting(
      page("<h1>Web Developer</h1>", '<meta property="og:locale" content="en-us" />')
    )

    expect(job.location).toBeUndefined()
  })

  it("still reads a labelled line on a page that has a locale", () => {
    const job = extractJobPosting(
      page("<p>Location: Davao City</p>", '<meta property="og:locale" content="en_PH" />')
    )

    expect(job.location).toBe("Davao City")
  })

  it("keeps the JSON-LD location even when the page has a labelled line too", () => {
    const doc = parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Analyst",
        hiringOrganization: { name: "Structured Co" },
        jobLocation: { address: { addressLocality: "Makati" } },
      })}</script></head><body><p>Location: Somewhere Else</p></body></html>`
    )

    expect(extractJobPosting(doc).location).toBe("Makati")
  })

  // ── Employer fallbacks ─────────────────────────────────────────────────────

  it("reads the employer from microdata on a page with no JSON-LD", () => {
    const job = extractJobPosting(parse(kalibrrMicrodata))

    expect(job.companyName).toBe("Squadzip (Digital Space Explorer, Inc.)")
    expect(job.jobTitle).toBe("Web Developer")
    expect(job.location).toBe("Makati, National Capital Region (Metro Manila), Philippines")
  })

  /** A page whose only heading is the og:title — no document title to fall back on. */
  const heading = (ogTitle: string): Document =>
    parse(
      `<html><head><meta property="og:title" content="${ogTitle}" /></head><body><h1>x</h1></body></html>`
    )

  it("never saves a seniority band as the company", () => {
    const job = extractJobPosting(heading("Web Developer | Junior to Mid at Some Board"))

    // The heading's second segment is a band, not an employer. With nothing else
    // stating one, the field stays blank for the user to fill in.
    expect(job.jobTitle).toBe("Web Developer")
    expect(job.companyName).toBeUndefined()
  })

  it.each([["Senior"], ["Entry Level"], ["Mid to Senior"], ["Lead"], ["Junior"]])(
    "rejects %s as a company",
    (band) => {
      const job = extractJobPosting(heading(`Engineer - ${band}`))

      expect(job.companyName).toBeUndefined()
    }
  )

  it("still takes a real company out of a split heading", () => {
    const job = extractJobPosting(heading("Engineer at Northwind Labs"))

    expect(job.companyName).toBe("Northwind Labs")
  })

  /** A heading plus an `og:site_name`, which is the tier above a split guess. */
  const headingWithSite = (ogTitle: string, siteName: string): Document =>
    parse(
      `<html><head><meta property="og:title" content="${ogTitle}" />` +
        `<meta property="og:site_name" content="${siteName}" /></head><body><h1>x</h1></body></html>`
    )

  it("falls back to og:site_name when the split company repeats the title", () => {
    const job = extractJobPosting(
      headingWithSite(
        "Christian Software Developer at Christian Software Developer",
        "Northwind Careers"
      )
    )

    expect(job.jobTitle).toBe("Christian Software Developer")
    expect(job.companyName).toBe("Northwind Careers")
  })

  it("leaves the company blank when the split company repeats the title and nothing else states one", () => {
    const job = extractJobPosting(
      heading("Christian Software Developer at Christian Software Developer")
    )

    expect(job.jobTitle).toBe("Christian Software Developer")
    expect(job.companyName).toBeUndefined()
  })

  it("blanks a company that equals the title whatever tier supplied it", () => {
    // og:site_name outranks a split guess, so this one reaches the final guard.
    const job = extractJobPosting(
      headingWithSite("Christian Software Developer", "christian software developer")
    )

    expect(job.jobTitle).toBe("Christian Software Developer")
    expect(job.companyName).toBeUndefined()
  })

  it("prefers og:site_name over a genuine split company, unchanged", () => {
    const job = extractJobPosting(headingWithSite("Engineer at Northwind Labs", "Contoso Ltd"))

    expect(job.jobTitle).toBe("Engineer")
    expect(job.companyName).toBe("Contoso Ltd")
  })

  // ── Posting dates ──────────────────────────────────────────────────────────

  const dated = (datePosted: unknown, validThrough: unknown): Document =>
    parse(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Dated Role",
        hiringOrganization: { name: "Timely Inc" },
        datePosted,
        validThrough,
      })}</script></head><body></body></html>`
    )

  it("reads datePosted and validThrough as calendar dates", () => {
    const job = extractJobPosting(dated("2026-09-01", "2026-10-15"))

    expect(job.postedAt).toBe("2026-09-01")
    expect(job.deadline).toBe("2026-10-15")
  })

  it("keeps the calendar day of a human-written date, whatever the timezone", () => {
    // bossjob.ph publishes `datePosted: "09 Sep 2026"`. Read back in UTC that
    // becomes the 8th anywhere east of Greenwich.
    const job = extractJobPosting(dated("09 Sep 2026", "31 Oct 2026"))

    expect(job.postedAt).toBe("2026-09-09")
    expect(job.deadline).toBe("2026-10-31")
  })

  it("reduces a timestamp to the calendar date it falls on", () => {
    const job = extractJobPosting(dated("2026-09-01T09:30:00+08:00", "2026-10-15T23:59:59Z"))

    expect(job.postedAt).toBe("2026-09-01")
    expect(job.deadline).toBe("2026-10-15")
  })

  it("drops dates it cannot parse rather than guessing", () => {
    const job = extractJobPosting(dated("last Tuesday", 20261015))

    expect(job.postedAt).toBeUndefined()
    expect(job.deadline).toBeUndefined()
  })

  it("has no dates when the posting states none", () => {
    const job = extractJobPosting(parse(noStructuredData))

    expect(job.postedAt).toBeUndefined()
    expect(job.deadline).toBeUndefined()
  })
})
