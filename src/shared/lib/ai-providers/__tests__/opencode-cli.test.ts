// @vitest-environment node
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSpawn = vi.hoisted(() => vi.fn())

vi.mock("node:child_process", () => ({ spawn: mockSpawn }))

import { getOpenCodeCliModel, OpenCodeCliError } from "../opencode-cli"

type FakeChild = EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  stdin: PassThrough
  kill: ReturnType<typeof vi.fn>
}

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(),
  })
}

function callOptions(overrides: Record<string, unknown> = {}) {
  return {
    prompt: [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "Say hi" }],
      },
    ],
    ...overrides,
  }
}

describe("OpenCodeCliLanguageModel", () => {
  beforeEach(() => {
    mockSpawn.mockReset()
  })

  it("maps the CLI's JSONL events onto an AI SDK result", async () => {
    const child = fakeChild()
    mockSpawn.mockReturnValue(child)
    const model = getOpenCodeCliModel("opencode/beam-free")

    const pending = model.doGenerate(callOptions())
    child.stdout.write(
      [
        JSON.stringify({ type: "step_start", sessionID: "sess_1" }),
        JSON.stringify({ type: "text", part: { text: "Hello" } }),
        JSON.stringify({
          type: "step_finish",
          part: {
            reason: "stop",
            tokens: {
              input: 10,
              output: 5,
              reasoning: 2,
              cache: { read: 4, write: 0 },
            },
          },
        }),
        "",
      ].join("\n")
    )
    child.emit("close", 0)

    const result = await pending

    expect(mockSpawn).toHaveBeenCalledWith(
      "opencode",
      [
        "run",
        "--agent",
        "rolespec",
        "--format",
        "json",
        "--model",
        "opencode/beam-free",
      ],
      expect.objectContaining({ windowsHide: true })
    )
    expect(result.content).toEqual([{ type: "text", text: "Hello" }])
    expect(result.finishReason.unified).toBe("stop")
    expect(result.usage.inputTokens).toMatchObject({
      total: 10,
      noCache: 6,
      cacheRead: 4,
      cacheWrite: 0,
    })
    expect(result.usage.outputTokens).toMatchObject({
      total: 5,
      text: 5,
      reasoning: 2,
    })
    expect(result.response?.id).toBe("sess_1")
  })

  it("unwraps one Markdown fence for JSON response format", async () => {
    const child = fakeChild()
    mockSpawn.mockReturnValue(child)
    const model = getOpenCodeCliModel("opencode/beam-free")

    const pending = model.doGenerate(
      callOptions({
        responseFormat: {
          type: "json",
          schema: { type: "object", properties: { ok: { type: "boolean" } } },
        },
      })
    )
    child.stdout.write(
      `${JSON.stringify({
        type: "text",
        part: { text: '```json\n{"ok":true}\n```' },
      })}\n`
    )
    child.emit("close", 0)

    const result = await pending

    expect(result.content).toEqual([{ type: "text", text: '{"ok":true}' }])
  })

  it("rejects with the CLI error message instead of an empty result", async () => {
    const child = fakeChild()
    mockSpawn.mockReturnValue(child)
    const model = getOpenCodeCliModel("opencode/beam-free")

    const pending = model.doGenerate(callOptions())
    child.stdout.write(
      `${JSON.stringify({
        type: "error",
        error: {
          name: "APIError",
          data: {
            message: "Free tier rejected",
            statusCode: 403,
            responseBody: "not allowed",
          },
        },
      })}\n`
    )
    child.emit("close", 0)

    const error = await pending.catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(OpenCodeCliError)
    expect((error as Error).message).toBe("Free tier rejected (status 403)")
    expect((error as OpenCodeCliError).data.stderr).toBe("not allowed")
  })

  it("rejects an unsafe model id without spawning a shell", async () => {
    const model = getOpenCodeCliModel("opencode/beam-free & calc")

    await expect(model.doGenerate(callOptions())).rejects.toMatchObject({
      name: "OpenCodeCliError",
      message: expect.stringContaining("not a valid OpenCode model id"),
    })
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it("rejects when the CLI exits with a non-zero code", async () => {
    const child = fakeChild()
    mockSpawn.mockReturnValue(child)
    const model = getOpenCodeCliModel("opencode/beam-free")

    const pending = model.doGenerate(callOptions())
    child.stderr.write("could not start")
    child.emit("close", 2)

    await expect(pending).rejects.toMatchObject({
      name: "OpenCodeCliError",
      message: "OpenCode CLI exited with code 2.",
    })
  })
})
