import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }))

vi.mock("node:dns", () => ({ default: { lookup: mockLookup }, lookup: mockLookup }))

import { safeLookup } from "../web-presence.service"

const ADDRESSES = [
  { address: "104.20.23.154", family: 4 },
  { address: "172.66.147.243", family: 4 },
]

function run(options?: { all?: boolean } | number) {
  return new Promise<{ error: unknown; args: unknown[] }>((resolve) => {
    safeLookup("example.com", options, (...args: unknown[]) => {
      resolve({ error: args[0], args: args.slice(1) })
    })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLookup.mockImplementation((_host, _options, callback) => callback(null, ADDRESSES))
})

describe("safeLookup", () => {
  it("returns the full validated list when Node asks for all addresses", async () => {
    const result = await run({ all: true })

    expect(result.error).toBeNull()
    expect(result.args).toEqual([ADDRESSES])
  })

  it("returns one address and its family for a single-address lookup", async () => {
    const result = await run({})

    expect(result.error).toBeNull()
    expect(result.args).toEqual(["104.20.23.154", 4])
  })

  it("blocks a host when any resolved address is private", async () => {
    mockLookup.mockImplementation((_host, _options, callback) =>
      callback(null, [{ address: "127.0.0.1", family: 4 }])
    )

    const result = await run({ all: true })

    expect(result.error).toMatchObject({ code: "EBLOCKED" })
  })

  it("fails instead of dialling when the host resolves to nothing", async () => {
    mockLookup.mockImplementation((_host, _options, callback) => callback(null, []))

    const result = await run({ all: true })

    expect(result.error).toMatchObject({ code: "EBLOCKED" })
  })
})
