import { describe, expect, it, vi } from "vitest"
import type { SearchLink, SearchLinksResponse } from "./api"
import { renderSearchLinks } from "./search-links"

const APP_URL = "http://localhost:3100"

const link = (over: Partial<SearchLink> = {}): SearchLink => ({
  board: "LINKEDIN",
  label: "LinkedIn",
  query: "backend engineer",
  location: "Manila",
  url: "https://www.linkedin.com/jobs/search/?keywords=backend%20engineer",
  ...over,
})

function render(data: SearchLinksResponse, onCopy = vi.fn()) {
  const container = document.createElement("div")
  renderSearchLinks(container, data, { appUrl: APP_URL, onCopy })
  return { container, onCopy }
}

describe("renderSearchLinks", () => {
  it("renders one block per role with a safe anchor per link", () => {
    const { container } = render({
      groups: [
        {
          role: "Backend Engineer",
          links: [
            link(),
            link({ board: "INDEED", label: "Indeed", query: "backend engineer java", url: "https://ph.indeed.com/jobs?q=x" }),
          ],
        },
        { role: "Data Analyst", links: [link({ query: "data analyst" })] },
      ],
      activeTargetRoleCount: 2,
    })

    const groups = container.querySelectorAll(".search-group")
    expect(groups).toHaveLength(2)
    expect(groups[0].querySelector("h2")?.textContent).toBe("Backend Engineer")

    const anchors = groups[0].querySelectorAll("a")
    expect(anchors).toHaveLength(2)
    expect(anchors[1].getAttribute("href")).toBe("https://ph.indeed.com/jobs?q=x")
    expect(anchors[1].target).toBe("_blank")
    expect(anchors[1].rel).toBe("noreferrer")
    expect(anchors[1].title).toBe("backend engineer java")
    expect(anchors[1].textContent).toBe("Indeed")
    expect(groups[0].querySelectorAll("code")[1].textContent).toBe("backend engineer java")
  })

  it("never parses server strings as markup", () => {
    const { container } = render({
      groups: [{ role: "<img src=x onerror=alert(1)>", links: [link({ label: "<b>x</b>" })] }],
      activeTargetRoleCount: 1,
    })
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("b")).toBeNull()
    expect(container.querySelector("h2")?.textContent).toBe("<img src=x onerror=alert(1)>")
  })

  it("copies the LinkedIn query even when it is not the first link", () => {
    const { container, onCopy } = render({
      groups: [
        {
          role: "Nurse",
          links: [
            link({ board: "INDEED", label: "Indeed", query: "indeed query" }),
            link({ board: "LINKEDIN", query: "linkedin query" }),
          ],
        },
      ],
      activeTargetRoleCount: 1,
    })
    const button = container.querySelector("button")!
    expect(button.textContent).toBe("Copy query")
    button.click()
    expect(onCopy).toHaveBeenCalledWith("linkedin query")
  })

  it("falls back to the first link's query without a LinkedIn link", () => {
    const { container, onCopy } = render({
      groups: [
        {
          role: "Nurse",
          links: [
            link({ board: "JOBSTREET", label: "JobStreet", query: "jobstreet query" }),
            link({ board: "INDEED", label: "Indeed", query: "indeed query" }),
          ],
        },
      ],
      activeTargetRoleCount: 1,
    })
    container.querySelector("button")!.click()
    expect(onCopy).toHaveBeenCalledWith("jobstreet query")
  })

  it("shows an empty state linking to the Career Profile", () => {
    const { container } = render({ groups: [], activeTargetRoleCount: 0 })
    expect(container.textContent).toContain("No active target roles in your Career Profile")
    const anchor = container.querySelector("a")!
    expect(anchor.getAttribute("href")).toBe(`${APP_URL}/career-profile`)
    expect(anchor.target).toBe("_blank")
    expect(container.querySelector(".search-group")).toBeNull()
  })

  it("shows a shared location as 'in X' and a shared remote as 'Remote'", () => {
    const { container } = render({
      groups: [
        { role: "A", links: [link(), link({ board: "INDEED" })] },
        { role: "B", links: [link({ location: "remote" }), link({ board: "INDEED", location: "remote" })] },
      ],
      activeTargetRoleCount: 2,
    })
    const hints = [...container.querySelectorAll(".search-group")].map(
      (group) => group.querySelector("p.hint")?.textContent,
    )
    expect(hints).toEqual(["in Manila", "Remote"])
  })

  it("omits the location line when links disagree or have none", () => {
    const { container } = render({
      groups: [
        { role: "Mixed", links: [link(), link({ board: "INDEED", location: "Cebu" })] },
        { role: "Partial", links: [link(), link({ board: "INDEED", location: null })] },
        { role: "None", links: [link({ location: null })] },
      ],
      activeTargetRoleCount: 3,
    })
    for (const group of container.querySelectorAll(".search-group")) {
      expect(group.querySelector("p.hint")).toBeNull()
    }
  })

  it("notes when only the top roles are shown", () => {
    const { container } = render({
      groups: [{ role: "A", links: [link()] }],
      activeTargetRoleCount: 5,
    })
    expect(container.lastElementChild?.textContent).toBe("Showing your top 1 of 5 target roles.")
  })

  it("adds no capped-roles note when every role is shown", () => {
    const { container } = render({
      groups: [{ role: "A", links: [link()] }],
      activeTargetRoleCount: 1,
    })
    expect(container.textContent).not.toContain("Showing your top")
  })

  it("replaces previous contents on re-render", () => {
    const container = document.createElement("div")
    const data = { groups: [{ role: "A", links: [link()] }], activeTargetRoleCount: 1 }
    renderSearchLinks(container, data, { appUrl: APP_URL, onCopy: vi.fn() })
    renderSearchLinks(container, data, { appUrl: APP_URL, onCopy: vi.fn() })
    expect(container.querySelectorAll(".search-group")).toHaveLength(1)
  })
})
