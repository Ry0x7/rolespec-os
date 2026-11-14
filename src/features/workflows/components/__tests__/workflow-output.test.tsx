import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { WorkflowOutput } from "../workflow-output"
import type { JsonValue, WorkflowStepDTO } from "../../types"

afterEach(cleanup)

function step(name: string, output: JsonValue): WorkflowStepDTO {
  return {
    id: `step-${name}`,
    name,
    order: 0,
    status: "COMPLETED",
    required: true,
    dependsOn: [],
    attempts: 1,
    maxAttempts: 1,
    output,
    lastError: null,
    startedAt: null,
    finishedAt: null,
  }
}

describe("WorkflowOutput", () => {
  it("summarizes the rank score and folds raw factor fields away", () => {
    render(
      <WorkflowOutput
        applicationId={null}
        step={step("RANK", {
          title: "Staff Infrastructure Engineer",
          companyName: "Stripe",
          score: 70,
          fitScore: 50,
          coverage: 0.5,
          lexicalScore: 0.29,
          explanation: ["Location matches your preference."],
          factors: [
            {
              id: "SKILLS",
              label: "Skills",
              state: "UNKNOWN",
              weight: 25,
              reason: "No confirmed capabilities in your profile yet.",
              evidence: [],
            },
          ],
        })}
      />
    )

    expect(screen.getByText("Overall match")).toBeTruthy()
    expect(screen.getByText("70")).toBeTruthy()
    expect(screen.getByText("Location matches your preference.")).toBeTruthy()
    const disclosure = screen.getByText("What shaped this score").closest("details")
    expect(disclosure?.open).toBe(false)

    fireEvent.click(screen.getByText("What shaped this score"))

    expect(disclosure?.open).toBe(true)
    expect(screen.getByText("Skills")).toBeTruthy()
    expect(screen.getByText("Not enough information · weight 25")).toBeTruthy()
  })

  it("keeps known facts and employer questions out of the raw JSON dump", () => {
    render(
      <WorkflowOutput
        applicationId={null}
        step={step("PREPARE_ATS", {
          fields: { fullName: "Alex Morgan", email: "alex@example.com" },
          missingFields: ["phone"],
          requirementFlags: ["AUTHORIZED"],
          needsUserAnswer: [
            {
              field: "workAuthorization",
              question: "Are you authorized to work without sponsorship?",
              reason: "Work authorization must be answered by you.",
            },
          ],
        })}
      />
    )

    expect(screen.getByText("Known facts")).toBeTruthy()
    expect(screen.getByText("Questions only you can answer")).toBeTruthy()
    expect(screen.getByText("1 question")).toBeTruthy()
    expect(screen.getByText(/Add these in your Career Profile/).textContent).toContain("Phone")
    expect(screen.queryByText("needsUserAnswer")).toBeNull()
  })
})
