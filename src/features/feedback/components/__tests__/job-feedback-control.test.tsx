import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  setJobFeedback: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("../../actions/feedback.actions", () => ({
  setJobFeedback: mocks.setJobFeedback,
}))
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }))

import { JobFeedbackControl } from "../job-feedback-control"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.setJobFeedback.mockResolvedValue({
    success: true,
    postingKey: "https://acme.example/jobs/1",
    verdict: "INTERVIEWED",
  })
})

describe("JobFeedbackControl", () => {
  it("labels the control as the user's own feedback and offers every verdict", () => {
    render(
      <JobFeedbackControl
        postingKey="https://acme.example/jobs/1"
        title="Frontend Engineer"
        companyName="Acme"
      />
    )

    const select = screen.getByLabelText(
      "Your feedback on Frontend Engineer at Acme"
    ) as HTMLSelectElement
    expect(select.value).toBe("")
    for (const label of [
      "Not set",
      "Interested",
      "Irrelevant",
      "Applied",
      "Rejected",
      "Interviewed",
      "Offered",
    ]) {
      expect(screen.getByRole("option", { name: label })).not.toBeNull()
    }
  })

  it("persists the selected verdict with the posting's identity", async () => {
    const onChanged = vi.fn()
    render(
      <JobFeedbackControl
        postingKey="https://acme.example/jobs/1"
        jobId="job-1"
        title="Frontend Engineer"
        companyName="Acme"
        url="https://acme.example/jobs/1?utm_source=x"
        onChanged={onChanged}
      />
    )

    fireEvent.change(
      screen.getByLabelText("Your feedback on Frontend Engineer at Acme"),
      { target: { value: "INTERVIEWED" } }
    )

    await waitFor(() =>
      expect(mocks.setJobFeedback).toHaveBeenCalledWith({
        postingKey: "https://acme.example/jobs/1",
        jobId: "job-1",
        title: "Frontend Engineer",
        companyName: "Acme",
        url: "https://acme.example/jobs/1?utm_source=x",
        verdict: "INTERVIEWED",
      })
    )
    expect(onChanged).toHaveBeenCalledWith("INTERVIEWED")
    expect(
      (screen.getByLabelText(
        "Your feedback on Frontend Engineer at Acme"
      ) as HTMLSelectElement).value
    ).toBe("INTERVIEWED")
  })

  it("survives a rejected server action and keeps the previous verdict", async () => {
    mocks.setJobFeedback.mockRejectedValue(new TypeError("Failed to fetch"))
    render(
      <JobFeedbackControl
        postingKey="https://acme.example/jobs/1"
        title="Frontend Engineer"
        companyName="Acme"
        initialVerdict="INTERESTED"
      />
    )

    const select = screen.getByLabelText("Your feedback on Frontend Engineer at Acme")
    fireEvent.change(select, { target: { value: "OFFERED" } })

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not save your feedback. Please try again."
      )
    )
    expect((select as HTMLSelectElement).value).toBe("INTERESTED")
  })

  it("reverts the visible selection when the write fails", async () => {
    mocks.setJobFeedback.mockResolvedValue({ error: "Could not save your feedback." })
    render(
      <JobFeedbackControl
        postingKey="https://acme.example/jobs/1"
        title="Frontend Engineer"
        companyName="Acme"
        initialVerdict="INTERESTED"
      />
    )

    const select = screen.getByLabelText("Your feedback on Frontend Engineer at Acme")
    fireEvent.change(select, { target: { value: "OFFERED" } })

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect((select as HTMLSelectElement).value).toBe("INTERESTED")
  })
})
