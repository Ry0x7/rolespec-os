// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  DEFAULT_OPENCODE_MODEL,
  freeOpenCodeModels,
  isOpenCodeModelId,
  parseOpenCodeModels,
  resolveOpenCodeModelId,
} from "../opencode-models"

/** One `id` line followed by the pretty-printed metadata block the CLI emits. */
function block(
  id: string,
  metadata: Record<string, unknown> = {},
  provider = "opencode"
): string {
  return `${id}\n${JSON.stringify(
    {
      id: id.split("/")[1],
      providerID: provider,
      name: id.split("/")[1],
      cost: { input: 0, output: 0 },
      ...metadata,
    },
    null,
    2
  )}\n`
}

describe("isOpenCodeModelId", () => {
  it("accepts the CLI's provider/model ids", () => {
    expect(isOpenCodeModelId("opencode/beam-free")).toBe(true)
    expect(isOpenCodeModelId("opencode/nemotron-3.5-super-vl-free")).toBe(true)
  })

  it("rejects shell syntax and malformed ids", () => {
    expect(isOpenCodeModelId("opencode/beam-free & calc")).toBe(false)
    expect(isOpenCodeModelId("opencode/beam-free\n")).toBe(false)
    expect(isOpenCodeModelId("beam-free")).toBe(false)
    expect(isOpenCodeModelId("")).toBe(false)
  })
})

describe("parseOpenCodeModels", () => {
  it("parses repeated id + metadata blocks", () => {
    const models = parseOpenCodeModels(
      block("opencode/beam-free", { name: "Beam Free" }) +
        block("opencode/deepseek-v4.1-flash-free", {
          name: "DeepSeek V4.1 Flash Free",
        })
    )

    expect(models).toHaveLength(2)
    expect(models[0]).toMatchObject({
      id: "opencode/beam-free",
      provider: "opencode",
      name: "Beam Free",
      free: true,
    })
    expect(models[1].name).toBe("DeepSeek V4.1 Flash Free")
  })

  it("marks paid and non-opencode models as not free", () => {
    const models = parseOpenCodeModels(
      block("opencode/paid-model", { cost: { input: 1, output: 2 } }) +
        block("anthropic/claude-sonnet-4", {}, "anthropic")
    )

    expect(models.map((model) => model.free)).toEqual([false, false])
  })

  it("keeps ids usable when a metadata block is malformed", () => {
    const models = parseOpenCodeModels(
      "opencode/broken\n{ not json\nopencode/beam-free\n" +
        JSON.stringify({
          providerID: "opencode",
          name: "Beam Free",
          cost: { input: 0, output: 0 },
        })
    )

    expect(models).toHaveLength(2)
    expect(models[0]).toMatchObject({
      id: "opencode/broken",
      name: "Broken",
      free: false,
    })
    expect(models[1].free).toBe(true)
  })

  it("ignores prose that is not part of a model block", () => {
    const models = parseOpenCodeModels(
      "Available models:\n" + block("opencode/beam-free")
    )

    expect(models.map((model) => model.id)).toEqual(["opencode/beam-free"])
  })
})

describe("freeOpenCodeModels", () => {
  it("filters and de-duplicates the free tier in CLI order", () => {
    const models = parseOpenCodeModels(
      block("opencode/beam-free") +
        block("opencode/paid-model", { cost: { input: 1, output: 0 } }) +
        block("opencode/beam-free")
    )

    expect(freeOpenCodeModels(models).map((model) => model.id)).toEqual([
      "opencode/beam-free",
    ])
  })
})

describe("resolveOpenCodeModelId", () => {
  const available = parseOpenCodeModels(
    block("opencode/beam-free") +
      block("opencode/glm-5.3-flash-free") +
      block("opencode/deepseek-v4.1-flash-free")
  )
  const previousEnv = process.env.OPENCODE_MODEL

  beforeEach(() => {
    delete process.env.OPENCODE_MODEL
  })

  afterEach(() => {
    if (previousEnv === undefined) delete process.env.OPENCODE_MODEL
    else process.env.OPENCODE_MODEL = previousEnv
  })

  it("prefers the configured model over the catalog", () => {
    expect(resolveOpenCodeModelId("opencode/beam-free", available)).toBe(
      "opencode/beam-free"
    )
  })

  it("honors OPENCODE_MODEL when nothing is pinned in the database", () => {
    process.env.OPENCODE_MODEL = "opencode/beam-free"
    expect(resolveOpenCodeModelId(null, available)).toBe("opencode/beam-free")
  })

  it("picks the most preferred free model that exists", () => {
    // deepseek is first in the preference list, glm second.
    expect(resolveOpenCodeModelId(null, available)).toBe(
      "opencode/deepseek-v4.1-flash-free"
    )
  })

  it("falls back to the first available free model", () => {
    const onlyBeam = parseOpenCodeModels(block("opencode/beam-free"))
    expect(resolveOpenCodeModelId(null, onlyBeam)).toBe("opencode/beam-free")
  })

  it("falls back to the built-in default when the catalog is empty", () => {
    expect(resolveOpenCodeModelId(null, [])).toBe(DEFAULT_OPENCODE_MODEL)
  })
})
