import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react"

const { mockUpdate, mockRefresh, mockToastSuccess, mockToastError } = vi.hoisted(
  () => ({
    mockUpdate: vi.fn(),
    mockRefresh: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastError: vi.fn(),
  }),
)

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }))
vi.mock("sonner", () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}))
vi.mock("../../actions/user-ai-settings.actions", () => ({
  updateUserAiSettings: mockUpdate,
}))

import { UserAiKeyForm } from "../user-ai-key-form"

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue({ success: true })
})

afterEach(cleanup)

const NO_KEY = { provider: null, model: null, configured: false }

describe("UserAiKeyForm", () => {
  it("hides OpenCode when the server probed no free models", () => {
    render(<UserAiKeyForm status={NO_KEY} />)

    const options = screen
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value)
    expect(options).toEqual([
      "openai",
      "anthropic",
      "deepseek",
      "google",
      "ollama",
      "lmstudio",
      "claude-code",
      "codex-cli",
    ])
  })

  it("offers the probed free models when OpenCode is available", async () => {
    render(
      <UserAiKeyForm
        status={NO_KEY}
        openCodeModels={[
          { value: "opencode/beam-free", label: "Beam Free" },
          { value: "opencode/big-pickle", label: "Big Pickle" },
        ]}
      />,
    )

    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "opencode-cli" },
    })

    const model = screen.getByLabelText("Model") as HTMLSelectElement
    expect(model.tagName).toBe("SELECT")
    expect([...model.options].map((option) => option.value)).toEqual([
      "opencode/beam-free",
      "opencode/big-pickle",
    ])
    // The first probed model is selected without the user touching the field.
    expect(model.value).toBe("opencode/beam-free")

    fireEvent.click(screen.getByRole("button", { name: /Save AI provider/ }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const formData = mockUpdate.mock.calls[0][0] as FormData
    expect(formData.get("provider")).toBe("opencode-cli")
    expect(formData.get("model")).toBe("opencode/beam-free")
  })

  it("keeps a saved OpenCode provider visible without probed models", () => {
    render(
      <UserAiKeyForm
        status={{ provider: "opencode-cli", model: null, configured: false }}
      />,
    )

    expect(
      (screen.getByLabelText("Provider") as HTMLSelectElement).value,
    ).toBe("opencode-cli")
    expect(screen.getByText("No free OpenCode models found")).toBeTruthy()
  })

  it("masks the key input and shows no stored key", () => {
    render(<UserAiKeyForm status={NO_KEY} />)

    expect(screen.getByLabelText("API key").getAttribute("type")).toBe("password")
    expect(screen.getByText("no key saved")).toBeTruthy()
  })

  it("shows only the last 4 characters of a saved key", () => {
    render(
      <UserAiKeyForm
        status={{ provider: "openai", model: null, configured: true, last4: "1234" }}
      />,
    )

    expect(screen.getByText("key set …1234")).toBeTruthy()
    // The input is never pre-filled with the stored value.
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("")
  })

  it("only offers the clear checkbox once a key is stored", () => {
    const { unmount } = render(<UserAiKeyForm status={NO_KEY} />)
    expect(screen.queryByLabelText("Remove the saved key")).toBeNull()
    unmount()

    render(
      <UserAiKeyForm
        status={{ provider: "openai", model: null, configured: true, last4: "1234" }}
      />,
    )
    expect(screen.getByLabelText("Remove the saved key")).toBeTruthy()
  })

  it("updates the model placeholder when the provider changes", () => {
    render(<UserAiKeyForm status={NO_KEY} />)

    expect(screen.getByLabelText("Model").getAttribute("placeholder")).toBe("gpt-4o")

    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "deepseek" },
    })

    expect(screen.getByLabelText("Model").getAttribute("placeholder")).toBe(
      "deepseek-chat",
    )
  })

  it("submits the key and clears it from the DOM afterwards", async () => {
    render(<UserAiKeyForm status={NO_KEY} />)

    const input = screen.getByLabelText("API key") as HTMLInputElement
    fireEvent.change(input, { target: { value: "sk-plaintext" } })
    fireEvent.click(screen.getByRole("button", { name: /Save AI provider/ }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const formData = mockUpdate.mock.calls[0][0] as FormData
    expect(formData.get("apiKey")).toBe("sk-plaintext")
    expect(formData.get("provider")).toBe("openai")

    await waitFor(() => expect(input.value).toBe(""))
    expect(mockToastSuccess).toHaveBeenCalled()
    expect(mockRefresh).toHaveBeenCalled()
  })

  it("keeps the typed key in the field when the save fails", async () => {
    mockUpdate.mockResolvedValue({ error: "Unauthorized" })
    render(<UserAiKeyForm status={NO_KEY} />)

    const input = screen.getByLabelText("API key") as HTMLInputElement
    fireEvent.change(input, { target: { value: "sk-plaintext" } })
    fireEvent.click(screen.getByRole("button", { name: /Save AI provider/ }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith("Unauthorized"))
    expect(input.value).toBe("sk-plaintext")
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
