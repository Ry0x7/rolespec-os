// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockExecFile = vi.hoisted(() => vi.fn())

vi.mock("node:child_process", () => ({ execFile: mockExecFile }))

import {
  clearProviderDiagnosticsCache,
  diagnoseProvider,
  diagnoseProviders,
  lmStudioBaseUrl,
  ollamaRootUrl,
} from "../provider-diagnostics"

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

function commandSucceeds(stdout = "") {
  mockExecFile.mockImplementation(
    (_command: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(null, stdout, "")
    }
  )
}

function commandFails(code: number | string = 1) {
  mockExecFile.mockImplementation(
    (_command: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(Object.assign(new Error("command failed"), { code }), "", "")
    }
  )
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response
}

function stubFetch(result: Response | Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (result instanceof Error) throw result
      return result
    })
  )
}

beforeEach(() => {
  mockExecFile.mockReset()
  vi.unstubAllGlobals()
  clearProviderDiagnosticsCache()
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  delete process.env.OLLAMA_BASE_URL
  delete process.env.OLLAMA_MODEL
  delete process.env.LMSTUDIO_BASE_URL
  delete process.env.LMSTUDIO_MODEL
})

describe("Codex CLI detection", () => {
  it("is ready when installed and signed in", async () => {
    mockExecFile
      .mockImplementationOnce((_c: string, _a: string[], _o: unknown, cb: ExecCallback) => {
        cb(null, "codex 1.2.3", "")
      })
      .mockImplementationOnce((_c: string, _a: string[], _o: unknown, cb: ExecCallback) => {
        cb(null, "Logged in", "")
      })

    const result = await diagnoseProvider("codex-cli")

    expect(result.status).toBe("ready")
    expect(result.reason).toBe("ready")
    expect(result.message).toContain("signed in")
    expect(mockExecFile.mock.calls[1][1]).toEqual(["login", "status"])
  })

  it("asks the user to sign in when the CLI status command fails", async () => {
    mockExecFile
      .mockImplementationOnce((_c: string, _a: string[], _o: unknown, cb: ExecCallback) => {
        cb(null, "codex 1.2.3", "")
      })
      .mockImplementationOnce((_c: string, _a: string[], _o: unknown, cb: ExecCallback) => {
        cb(Object.assign(new Error("not logged in"), { code: 1 }), "", "")
      })

    const result = await diagnoseProvider("codex-cli")

    expect(result.status).toBe("needs-setup")
    expect(result.reason).toBe("not-signed-in")
    expect(result.message).toContain("not signed in")
  })

  it("reports a missing CLI without trying the login status command", async () => {
    commandFails("ENOENT")

    const result = await diagnoseProvider("codex-cli")

    expect(result.status).toBe("unavailable")
    expect(result.reason).toBe("not-installed")
    expect(result.message).toContain("not found")
    expect(mockExecFile).toHaveBeenCalledTimes(1)
  })
})

describe("Claude Code detection", () => {
  it("accepts a long-lived OAuth token without a CLI login check", async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "token-present"
    commandSucceeds("claude 1.0.0")

    const result = await diagnoseProvider("claude-code")

    expect(result.status).toBe("ready")
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(mockExecFile.mock.calls[0][1]).toEqual(["--version"])
  })

  it("uses the official auth status exit code when no token is set", async () => {
    mockExecFile
      .mockImplementationOnce((_c: string, _a: string[], _o: unknown, cb: ExecCallback) => {
        cb(null, "claude 1.0.0", "")
      })
      .mockImplementationOnce((_c: string, _a: string[], _o: unknown, cb: ExecCallback) => {
        cb(Object.assign(new Error("not signed in"), { code: 1 }), "", "")
      })

    const result = await diagnoseProvider("claude-code")

    expect(result.status).toBe("needs-setup")
    expect(result.reason).toBe("not-signed-in")
    expect(mockExecFile.mock.calls[1][1]).toEqual(["auth", "status"])
  })
})

describe("Ollama detection", () => {
  it("is ready when the configured model is installed", async () => {
    stubFetch(jsonResponse({ models: [{ name: "qwen2.5vl:7b" }, { name: "llama3:8b" }] }))

    const result = await diagnoseProvider("ollama")

    expect(result.status).toBe("ready")
    expect(result.reason).toBe("ready")
    expect(result.models).toEqual(["qwen2.5vl:7b", "llama3:8b"])
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("http://localhost:11434/api/tags")
  })

  it("treats an unreachable server as not running", async () => {
    stubFetch(new Error("connect ECONNREFUSED"))

    const result = await diagnoseProvider("ollama")

    expect(result.status).toBe("unavailable")
    expect(result.reason).toBe("not-running")
    expect(result.message).toContain("isn't running")
  })

  it("reports no models separately from a stopped server", async () => {
    stubFetch(jsonResponse({ models: [] }))

    const result = await diagnoseProvider("ollama")

    expect(result.status).toBe("needs-setup")
    expect(result.reason).toBe("no-models")
  })

  it("names the missing model and lists what is installed", async () => {
    stubFetch(jsonResponse({ models: [{ name: "llama3:8b" }] }))

    const result = await diagnoseProvider("ollama")

    expect(result.status).toBe("needs-setup")
    expect(result.reason).toBe("model-missing")
    expect(result.message).toContain("qwen2.5vl:7b")
    expect(result.detail).toContain("llama3:8b")
  })

  it("ignores an explicit :latest tag when matching", async () => {
    process.env.OLLAMA_MODEL = "llama3:latest"
    stubFetch(jsonResponse({ models: [{ name: "llama3" }] }))

    const result = await diagnoseProvider("ollama")

    expect(result.status).toBe("ready")
  })
})

describe("LM Studio detection", () => {
  it("is ready when the server reports the configured model", async () => {
    stubFetch(jsonResponse({ data: [{ id: "qwen3:8b" }] }))

    const result = await diagnoseProvider("lmstudio")

    expect(result.status).toBe("ready")
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("http://localhost:1234/v1/models")
  })

  it("respects base URL overrides", () => {
    process.env.LMSTUDIO_BASE_URL = "http://localhost:9999/v1/"
    expect(lmStudioBaseUrl()).toBe("http://localhost:9999/v1")
    process.env.OLLAMA_BASE_URL = "http://localhost:9998/v1/"
    expect(ollamaRootUrl()).toBe("http://localhost:9998")
  })
})

describe("API-key providers", () => {
  it("is ready when a stored key exists", async () => {
    const result = await diagnoseProvider("openai", {
      storedKeyProviders: ["openai"],
    })

    expect(result.status).toBe("ready")
    expect(result.message).toContain("OpenAI")
    expect(result.message).not.toContain("sk-")
  })

  it("asks for a key when none is stored or present in the environment", async () => {
    const result = await diagnoseProvider("deepseek", { envKeyProviders: [] })

    expect(result.status).toBe("needs-setup")
    expect(result.reason).toBe("no-key")
  })

  it("accepts an environment key without a stored row", async () => {
    const result = await diagnoseProvider("anthropic", {
      envKeyProviders: ["anthropic"],
    })

    expect(result.status).toBe("ready")
  })
})

describe("diagnoseProviders", () => {
  it("returns every requested provider and isolates a failure", async () => {
    commandFails("ENOENT")
    stubFetch(jsonResponse({ models: [] }))

    const result = await diagnoseProviders(["codex-cli", "ollama", "openai"], {})

    expect(result["codex-cli"].status).toBe("unavailable")
    expect(result.ollama.status).toBe("needs-setup")
    expect(result.openai.status).toBe("needs-setup")
  })

  it("reuses the snapshot for an unchanged configuration", async () => {
    commandFails("ENOENT")

    await diagnoseProviders(["codex-cli"], {})
    await diagnoseProviders(["codex-cli"], {})

    expect(mockExecFile).toHaveBeenCalledTimes(1)
  })
})
