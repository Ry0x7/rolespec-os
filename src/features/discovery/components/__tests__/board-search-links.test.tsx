import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const toastSuccess = vi.fn()
const toastError = vi.fn()
const writeText = vi.fn()

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

import {
  BoardSearchLinks,
  type BoardSearchGroup,
  type BoardSearchLinkItem,
} from "../board-search-links"

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  })
})

function link(
  board: BoardSearchLinkItem["board"],
  overrides: Partial<BoardSearchLinkItem> = {}
): BoardSearchLinkItem {
  const label = { LINKEDIN: "LinkedIn", INDEED: "Indeed", JOBSTREET: "JobStreet" }[board]
  return {
    board,
    label,
    query: `${board.toLowerCase()} registered nurse`,
    location: "Philippines",
    url: `https://${board.toLowerCase()}.example/search?q=nurse`,
    ...overrides,
  }
}

function group(links: BoardSearchLinkItem[], role = "Registered Nurse"): BoardSearchGroup {
  return { role, links }
}

describe("BoardSearchLinks", () => {
  it("shows an empty state with a Career Profile link when there are no groups", () => {
    render(<BoardSearchLinks groups={[]} />)
    expect(screen.getByText("Search job boards")).toBeTruthy()
    expect(screen.getByText("No active target roles")).toBeTruthy()
    const profileLink = screen.getByRole("link", { name: "Go to Career Profile" })
    expect(profileLink.getAttribute("href")).toBe("/career-profile")
  })

  it("renders the role heading and one outbound anchor per link", () => {
    const links = [link("INDEED"), link("LINKEDIN"), link("JOBSTREET")]
    render(<BoardSearchLinks groups={[group(links)]} />)

    expect(screen.getByRole("heading", { name: "Registered Nurse" })).toBeTruthy()
    for (const item of links) {
      const anchor = screen.getByRole("link", { name: new RegExp(`^${item.label}:`) })
      expect(anchor.getAttribute("href")).toBe(item.url)
      expect(anchor.getAttribute("target")).toBe("_blank")
      expect(anchor.getAttribute("rel")).toBe("noopener noreferrer")
      expect(anchor.getAttribute("title")).toBe(item.query)
    }
    expect(screen.getAllByRole("link")).toHaveLength(3)
  })

  it("copies the LinkedIn query even when it is not the first link, then toasts", async () => {
    render(<BoardSearchLinks groups={[group([link("INDEED"), link("LINKEDIN")])]} />)

    expect(screen.getByText("linkedin registered nurse").tagName).toBe("CODE")
    fireEvent.click(screen.getByRole("button", { name: "Copy query for Registered Nurse" }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Query copied"))
    expect(writeText).toHaveBeenCalledWith("linkedin registered nurse")
    expect(toastError).not.toHaveBeenCalled()
  })

  it("falls back to the first link's query when there is no LinkedIn link", async () => {
    render(<BoardSearchLinks groups={[group([link("JOBSTREET"), link("INDEED")])]} />)
    fireEvent.click(screen.getByRole("button", { name: /Copy query/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("jobstreet registered nurse"))
  })

  it("toasts an error when the clipboard write fails", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"))
    render(<BoardSearchLinks groups={[group([link("LINKEDIN")])]} />)

    fireEvent.click(screen.getByRole("button", { name: /Copy query/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("shows the location once when every link shares it", () => {
    render(
      <BoardSearchLinks
        groups={[group([link("LINKEDIN"), link("INDEED"), link("JOBSTREET")])]}
      />
    )
    expect(screen.getAllByText("in Philippines")).toHaveLength(1)
  })

  it("labels a shared remote location as Remote", () => {
    render(
      <BoardSearchLinks
        groups={[
          group([link("LINKEDIN", { location: "Remote" }), link("INDEED", { location: "Remote" })]),
        ]}
      />
    )
    expect(screen.getByText("Remote")).toBeTruthy()
  })

  it("hides the location when links disagree", () => {
    render(
      <BoardSearchLinks
        groups={[
          group([link("LINKEDIN"), link("INDEED", { location: "Remote" }), link("JOBSTREET")]),
        ]}
      />
    )
    expect(screen.queryByText("in Philippines")).toBeNull()
    expect(screen.queryByText("Remote")).toBeNull()
  })
})
