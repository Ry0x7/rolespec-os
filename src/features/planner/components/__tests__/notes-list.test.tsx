import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { NotesList, isLongNote } from "../notes-list"
import { deleteNote } from "../../actions/note.actions"
import type { NoteRow } from "../../types"

const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("../../actions/note.actions", () => ({
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
}))

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

function makeNotes(count: number, prefix = "Note") {
  return Array.from({ length: count }, (_, i): NoteRow => ({
    id: `${prefix}-${i + 1}`,
    content: `${prefix} ${i + 1}`,
    updatedAt: new Date("2026-10-12T00:00:00.000Z"),
  }))
}

function visibleBodies() {
  return Array.from(document.querySelectorAll('[id^="note-body-"]')).map((node) => node.textContent)
}

describe("NotesList paging", () => {
  it("pages 23 notes at 10 with Previous/Next", () => {
    render(<NotesList notes={makeNotes(23)} />)

    expect(screen.getByRole("navigation", { name: "Notes pages" })).toBeTruthy()
    expect(screen.getByText("Page 1 of 3")).toBeTruthy()
    expect(visibleBodies()).toHaveLength(10)

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Page 3 of 3")).toBeTruthy()
    expect(visibleBodies()).toEqual(["Note 21", "Note 22", "Note 23"])

    fireEvent.click(screen.getByRole("button", { name: "Previous" }))
    expect(screen.getByText("Page 2 of 3")).toBeTruthy()
    expect(visibleBodies()[0]).toBe("Note 11")
  })

  it("renders no pagination when everything fits on one page", () => {
    render(<NotesList notes={makeNotes(10)} />)
    expect(screen.queryByRole("navigation", { name: "Notes pages" })).toBeNull()
  })

  it("keeps the page after a delete", async () => {
    vi.mocked(deleteNote).mockResolvedValue({ success: true } as never)
    render(<NotesList notes={makeNotes(23)} />)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Delete note" })[0])
    })

    expect(deleteNote).toHaveBeenCalledWith("Note-11")
    expect(refresh).toHaveBeenCalled()
    expect(screen.getByText("Page 2 of 3")).toBeTruthy()
  })
})

describe("NotesList search", () => {
  it("filters on note text, case-insensitively, and goes back to page 1", () => {
    const notes = [...makeNotes(15), ...makeNotes(12, "Recruiter call")]
    render(<NotesList notes={notes} />)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Page 2 of 3")).toBeTruthy()

    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "RECRUITER" },
    })

    expect(screen.getByText("Page 1 of 2")).toBeTruthy()
    expect(visibleBodies()).toHaveLength(10)
    expect(visibleBodies().every((body) => body?.startsWith("Recruiter call"))).toBe(true)
  })

  it("says so when nothing matches", () => {
    render(<NotesList notes={makeNotes(3)} />)
    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "zzz" },
    })
    expect(screen.getByText("No notes match your search.")).toBeTruthy()
    expect(visibleBodies()).toHaveLength(0)
  })
})

describe("NotesList show more", () => {
  const long = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join("\n")

  it("clamps a long body and toggles it per card with aria-expanded", () => {
    render(
      <NotesList
        notes={[
          { id: "long", content: long, updatedAt: new Date("2026-10-12T00:00:00.000Z") },
          { id: "short", content: "Short note", updatedAt: new Date("2026-10-12T00:00:00.000Z") },
        ]}
      />
    )

    const body = document.getElementById("note-body-long")!
    expect(body.className).toContain("line-clamp-6")
    expect(document.getElementById("note-body-short")!.className).not.toContain("line-clamp-6")

    // Only the long note gets a toggle.
    const toggles = screen.getAllByRole("button", { name: "Show more" })
    expect(toggles).toHaveLength(1)
    expect(toggles[0].getAttribute("aria-expanded")).toBe("false")
    expect(toggles[0].getAttribute("aria-controls")).toBe("note-body-long")

    fireEvent.click(toggles[0])
    const less = screen.getByRole("button", { name: "Show less" })
    expect(less.getAttribute("aria-expanded")).toBe("true")
    expect(body.className).not.toContain("line-clamp-6")

    fireEvent.click(less)
    expect(body.className).toContain("line-clamp-6")
  })

  it("treats a body as long by line count or length", () => {
    expect(isLongNote("one\ntwo")).toBe(false)
    expect(isLongNote(long)).toBe(true)
    expect(isLongNote("x".repeat(500))).toBe(true)
  })
})
