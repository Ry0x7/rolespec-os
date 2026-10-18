import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { SignUpForm } from "../sign-up-form"

vi.mock("../../actions", () => ({ registerAction: vi.fn() }))

afterEach(cleanup)

describe("SignUpForm", () => {
  it("renders the account fields with no invite gate by default", () => {
    render(<SignUpForm />)

    expect(screen.getByLabelText("Email")).toBeTruthy()
    expect(screen.getByLabelText("Password")).toBeTruthy()
    expect(screen.queryByLabelText("Invite code")).toBeNull()
  })

  it("hides the invite field when inviteRequired is false", () => {
    render(<SignUpForm inviteRequired={false} />)

    expect(screen.queryByLabelText("Invite code")).toBeNull()
  })

  it("renders a required invite field when inviteRequired is true", () => {
    render(<SignUpForm inviteRequired />)

    const field = screen.getByLabelText("Invite code") as HTMLInputElement
    expect(field.name).toBe("inviteCode")
    expect(field.required).toBe(true)
  })
})
