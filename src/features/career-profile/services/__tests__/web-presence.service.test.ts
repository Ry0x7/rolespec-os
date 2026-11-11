// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  containsTechnology,
  extractPortfolioPage,
  fetchPublicUrl,
  isPublicIpAddress,
  mapGitHubToCareerFacts,
  mapPortfolioToCareerFacts,
  parseGitHubUsername,
  WebSourceError,
  type GitHubScan,
} from "../web-presence.service"

const NOW = new Date("2026-11-08T12:00:00.000Z")

describe("isPublicIpAddress", () => {
  it.each([
    "127.0.0.1",
    "127.9.9.9",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "192.0.2.10",
    "198.51.100.7",
    "203.0.113.9",
    "::1",
    "::",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "2001:0:4136:e378::1",
    "fd12:3456::1%eth0",
  ])("rejects %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false)
  })

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
  ])(
    "accepts public address %s",
    (address) => {
      expect(isPublicIpAddress(address)).toBe(true)
    }
  )
})

describe("parseGitHubUsername", () => {
  it.each([
    ["https://github.com/ada", "ada"],
    ["http://www.github.com/ada/", "ada"],
    ["github.com/ada?tab=repositories", "ada"],
    ["@ada", "ada"],
    ["ada", "ada"],
    ["ada-lovelace", "ada-lovelace"],
  ])("reads %s as %s", (input, expected) => {
    expect(parseGitHubUsername(input)).toBe(expected)
  })

  it.each([
    "https://github.com/ada/rolespec",
    "https://gitlab.com/ada",
    "https://github.com.evil.example/ada",
    "https://github.com/ada/../../etc",
    "not a profile",
    "",
  ])("rejects %s", (input) => {
    expect(parseGitHubUsername(input)).toBeNull()
  })
})

describe("fetchPublicUrl guards", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://[::1]/",
    "http://[::ffff:7f00:1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1",
    "http://192.168.0.10",
    "http://printer.local",
  ])("refuses the private target %s before any connection", async (url) => {
    await expect(fetchPublicUrl(url)).rejects.toMatchObject({ code: "BLOCKED_HOST" })
  })

  it.each(["ftp://example.com", "https://example.com:8443", "http://user:pass@example.com"])(
    "refuses the unsupported URL %s",
    async (url) => {
      await expect(fetchPublicUrl(url)).rejects.toBeInstanceOf(WebSourceError)
    }
  )
})

const PORTFOLIO_HTML = `<!doctype html>
<html>
  <head>
    <title>Ada Lovelace — engineer</title>
    <meta property="og:description" content="Backend engineer building small tools." />
    <script>window.analytics = { framework: "React" }</script>
  </head>
  <body>
    <nav><a href="/about">About</a><a href="/contact">Contact</a></nav>
    <h1>Ada Lovelace</h1>
    <p>I build with TypeScript, PostgreSQL and Docker.</p>

    <h2>Selected Work</h2>
    <h3>Note compiler</h3>
    <p>Turns markdown into a static notebook.</p>
    <h3>Queue dashboard</h3>

    <h2>About</h2>
    <p>Previously at a research lab.</p>

    <article>
      <h3>Diff viewer</h3>
      <a href="/projects/diff-viewer">Diff viewer</a>
      <p>A tiny review tool built with Rust.</p>
    </article>

    <footer><p>Built with Next.js</p></footer>
  </body>
</html>`

describe("extractPortfolioPage", () => {
  it("reads the title, description and project headings from the real text", () => {
    const scan = extractPortfolioPage(PORTFOLIO_HTML, "https://ada.example.com/")

    expect(scan.title).toBe("Ada Lovelace — engineer")
    expect(scan.description).toBe("Backend engineer building small tools.")
    expect(scan.projects.map((project) => project.title)).toEqual([
      "Note compiler",
      "Queue dashboard",
      "Diff viewer",
    ])
    expect(scan.projects[2]).toMatchObject({
      title: "Diff viewer",
      url: "https://ada.example.com/projects/diff-viewer",
      description: "A tiny review tool built with Rust.",
    })
  })

  it("does not treat navigation headings as projects", () => {
    const scan = extractPortfolioPage(PORTFOLIO_HTML, "https://ada.example.com/")
    const titles = scan.projects.map((project) => project.title.toLowerCase())

    expect(titles).not.toContain("about")
    expect(titles).not.toContain("contact")
  })
})

describe("technology detection", () => {
  it("matches whole tokens only", () => {
    expect(containsTechnology("built with React", "React")).toBe(true)
    expect(containsTechnology("a nuclear reactor", "React")).toBe(false)
    expect(containsTechnology("C++ services", "C++")).toBe(true)
    expect(containsTechnology("C# services", "C#")).toBe(true)
  })
})

const GITHUB_SCAN: GitHubScan = {
  profile: {
    login: "ada",
    name: "Ada Lovelace",
    htmlUrl: "https://github.com/ada",
    bio: null,
    publicRepos: 2,
  },
  repositories: [
    {
      name: "note-compiler",
      url: "https://github.com/ada/note-compiler",
      description: "Markdown to static notebook, built with TypeScript and PostgreSQL.",
      language: "TypeScript",
      topics: ["markdown", "node"],
      stars: 12,
      pushedAt: "2026-10-01T10:00:00Z",
      homepage: null,
    },
    {
      name: "diff-viewer",
      url: "https://github.com/ada/diff-viewer",
      description: "A tiny review tool.",
      language: "Rust",
      topics: [],
      stars: 0,
      pushedAt: "2026-09-01T10:00:00Z",
      homepage: null,
    },
  ],
}

describe("mapGitHubToCareerFacts", () => {
  it("maps repositories to PROJECT candidates with provenance and languages", () => {
    const facts = mapGitHubToCareerFacts(GITHUB_SCAN, NOW)

    expect(facts.source).toBe("github")
    expect(facts.evidence).toHaveLength(2)
    expect(facts.evidence[0]).toMatchObject({
      kind: "PROJECT",
      title: "note-compiler",
      organization: "GitHub",
      details: "Markdown to static notebook, built with TypeScript and PostgreSQL.",
      metadata: {
        source: "github",
        sourceUrl: "https://github.com/ada/note-compiler",
        repository: "ada/note-compiler",
        fetchedAt: NOW.toISOString(),
      },
    })
    expect(facts.evidence[0].capabilityNames).toEqual(
      expect.arrayContaining(["TypeScript", "PostgreSQL"])
    )
    expect(facts.capabilities).toEqual(
      expect.arrayContaining([
        { name: "TypeScript", category: "Language" },
        { name: "PostgreSQL", category: "Database" },
        { name: "Rust", category: "Language" },
      ])
    )
  })

  it("never promotes a repository topic that is not in the vocabulary", () => {
    const facts = mapGitHubToCareerFacts(
      {
        ...GITHUB_SCAN,
        repositories: [
          {
            ...GITHUB_SCAN.repositories[0],
            topics: ["awesome", "made-with-love"],
            language: null,
            description: "A collection of notes.",
          },
        ],
      },
      NOW
    )

    expect(facts.capabilities).toEqual([])
    expect(facts.evidence[0].capabilityNames).toEqual([])
  })
})

describe("mapPortfolioToCareerFacts", () => {
  it("adds one site row plus detected project rows, all from page text", () => {
    const scan = extractPortfolioPage(PORTFOLIO_HTML, "https://ada.example.com/")
    const facts = mapPortfolioToCareerFacts(scan, NOW)

    expect(facts.source).toBe("portfolio")
    expect(facts.evidence[0]).toMatchObject({
      kind: "PROJECT",
      title: "Portfolio — Ada Lovelace — engineer",
      details: "Backend engineer building small tools.",
      metadata: {
        source: "portfolio",
        sourceUrl: "https://ada.example.com/",
      },
    })
    expect(facts.evidence.map((row) => row.title)).toContain("Note compiler")
    expect(facts.capabilities.map((row) => row.name)).toEqual(
      expect.arrayContaining(["TypeScript", "PostgreSQL", "Docker"])
    )
    // Script and footer content must not create capabilities.
    expect(facts.capabilities.map((row) => row.name)).not.toContain("React")
    expect(facts.capabilities.map((row) => row.name)).not.toContain("Next.js")
  })

  it("does not infer a skill from a word that merely contains it", () => {
    const scan = extractPortfolioPage(
      "<html><head><title>Me</title></head><body><p>I wrote about a reactor.</p></body></html>",
      "https://ada.example.com/"
    )
    const facts = mapPortfolioToCareerFacts(scan, NOW)

    expect(facts.capabilities).toEqual([])
  })
})
