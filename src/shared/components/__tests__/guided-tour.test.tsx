import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { GuidedTour } from "../guided-tour"
import { GUIDED_TOUR_EVENT, GUIDED_TOUR_STORAGE_KEY } from "@/shared/lib/guided-tour"

describe("GuidedTour", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it("offers the tour once and remembers Not now", async () => {
    render(<GuidedTour />)
    expect(
      await screen.findByText("Want a 60-second tour?", undefined, { timeout: 2000 })
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Not now" }))

    expect(window.localStorage.getItem(GUIDED_TOUR_STORAGE_KEY)).toBe("skipped")
    expect(screen.queryByText("Want a 60-second tour?")).toBeNull()
  })

  it("starts from the Help event and finishes with done", async () => {
    render(<GuidedTour />)
    fireEvent(window, new Event(GUIDED_TOUR_EVENT))

    expect(await screen.findByText("Start with your career info")).toBeTruthy()
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: /Next|Finish/ }))
    }

    expect(window.localStorage.getItem(GUIDED_TOUR_STORAGE_KEY)).toBe("done")
    expect(screen.queryByText("Start with your career info")).toBeNull()
  })
})
