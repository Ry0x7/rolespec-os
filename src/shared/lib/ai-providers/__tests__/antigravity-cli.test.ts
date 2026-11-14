// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider"
import { buildAntigravityPrompt, parseAntigravityOutput } from "../antigravity-cli"

function options(overrides: Record<string, unknown> = {}): LanguageModelV4CallOptions {
  return {
    prompt: [
      { role: "system", content: "Be concise." },
      {
        role: "user",
        content: [{ type: "text", text: "Write a short greeting." }],
      },
    ],
    ...overrides,
  } as LanguageModelV4CallOptions
}

describe("Antigravity CLI adapter", () => {
  it("flattens system and user text into one CLI prompt", () => {
    const prompt = buildAntigravityPrompt(options())

    expect(prompt).toContain("SYSTEM:")
    expect(prompt).toContain("Be concise.")
    expect(prompt).toContain("USER:")
    expect(prompt).toContain("Write a short greeting.")
    expect(prompt).not.toContain("ASSISTANT:")
  })

  it("adds a JSON response-format instruction and schema", () => {
    const prompt = buildAntigravityPrompt(
      options({
        responseFormat: {
          type: "json",
          name: "Greeting",
          schema: {
            type: "object",
            properties: { greeting: { type: "string" } },
            required: ["greeting"],
          },
        },
      })
    )

    expect(prompt).toContain("RESPONSE FORMAT")
    expect(prompt).toContain("Return exactly one JSON value")
    expect(prompt).toContain('"greeting"')
  })

  it("parses stream-json text, usage and conversation id", () => {
    const stdout = [
      JSON.stringify({
        event: "init",
        conversation_id: "conv_1",
        init: { model: "gemini-4-hydrogen-high" },
      }),
      JSON.stringify({
        event: "step_update",
        step_update: {
          step_type: "agent_response",
          state: "ACTIVE",
          text_delta: "Hello",
        },
      }),
      JSON.stringify({
        event: "step_update",
        step_update: {
          step_type: "agent_response",
          state: "DONE",
          text_delta: "\n",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            thinking_tokens: 5,
            cache_read_tokens: 40,
            total_tokens: 120,
          },
        },
      }),
      JSON.stringify({
        event: "result",
        result: {
          conversation_id: "conv_1",
          status: "SUCCESS",
          response: "Hello\n",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            thinking_tokens: 5,
            cache_read_tokens: 40,
            total_tokens: 120,
          },
        },
      }),
    ].join("\n")

    const parsed = parseAntigravityOutput(stdout)

    expect(parsed.text).toBe("Hello\n")
    expect(parsed.status).toBe("SUCCESS")
    expect(parsed.conversationId).toBe("conv_1")
    expect(parsed.usage.inputTokens).toMatchObject({
      total: 100,
      noCache: 60,
      cacheRead: 40,
      cacheWrite: 0,
    })
    expect(parsed.usage.outputTokens).toMatchObject({
      total: 20,
      text: 15,
      reasoning: 5,
    })
  })

  it("prefers structured_output and unwraps one JSON fence", () => {
    const structured = parseAntigravityOutput(
      JSON.stringify({
        event: "result",
        result: {
          status: "SUCCESS",
          response: "ignored",
          structured_output: { greeting: "hello" },
        },
      })
    )
    expect(structured.text).toBe('{"greeting":"hello"}')

    const fenced = parseAntigravityOutput(
      JSON.stringify({
        event: "result",
        result: { status: "SUCCESS", response: '```json\n{"ok":true}\n```' },
      }),
      true
    )
    expect(fenced.text).toBe('{"ok":true}')
  })

  it("collapses a redundantly encoded structured value", () => {
    const parsed = parseAntigravityOutput(
      JSON.stringify({
        event: "result",
        result: {
          status: "SUCCESS",
          structured_output: { answer: '{"answer":"OK"}' },
        },
      }),
      true
    )

    expect(parsed.text).toBe('{"answer":"OK"}')
  })

  it("surfaces a CLI error instead of an empty response", () => {
    const parsed = parseAntigravityOutput(
      JSON.stringify({
        event: "error",
        error: { message: "authentication required" },
      })
    )

    expect(parsed.status).toBe("ERROR")
    expect(parsed.error).toBe("authentication required")
  })
})
