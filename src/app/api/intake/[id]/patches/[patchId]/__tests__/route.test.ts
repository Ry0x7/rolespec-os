// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveApiUserId: vi.fn(),
  applyIntakePatch: vi.fn(),
  correctIntakePatch: vi.fn(),
  rejectIntakePatch: vi.fn(),
}))

vi.mock("@/features/auth/api-auth", () => ({
  resolveApiUserId: mocks.resolveApiUserId,
}))

vi.mock("@/features/intake/services/intake-apply.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/intake/services/intake-apply.service")>()
  return {
    ...actual,
    applyIntakePatch: mocks.applyIntakePatch,
    correctIntakePatch: mocks.correctIntakePatch,
    rejectIntakePatch: mocks.rejectIntakePatch,
  }
})

import { IntakeApplyError } from "@/features/intake/services/intake-apply.service"
import { DELETE, PATCH, POST } from "../route"

const params = {
  params: Promise.resolve({ id: "run-1", patchId: "patch-1" }),
}

function request(method: string, body: unknown) {
  return new Request("http://localhost/api/intake/run-1/patches/patch-1", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const CONFLICT = {
  status: "CONFLICT",
  patchId: "patch-1",
  appliedTargetType: null,
  appliedTargetId: null,
  conflict: {
    id: "conflict-1",
    existingType: "career_profile",
    existingId: "profile-1",
    field: "contactEmail",
    incoming: { value: "ada@new.example" },
    existing: { value: "ada@old.example" },
    status: "OPEN",
    resolution: null,
  },
  message: "This fact already exists with different details.",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveApiUserId.mockResolvedValue("user-1")
  mocks.applyIntakePatch.mockResolvedValue(CONFLICT)
  mocks.correctIntakePatch.mockResolvedValue({ status: "APPLIED", patchId: "patch-1" })
  mocks.rejectIntakePatch.mockResolvedValue({ status: "REJECTED", patchId: "patch-1" })
})

describe("intake patch authorization", () => {
  it("rejects anonymous calls on every method", async () => {
    mocks.resolveApiUserId.mockResolvedValue(null)

    for (const [handler, method] of [
      [POST, "POST"],
      [PATCH, "PATCH"],
      [DELETE, "DELETE"],
    ] as const) {
      const res = await handler(request(method, {}), params)
      expect(res.status).toBe(401)
    }
    expect(mocks.applyIntakePatch).not.toHaveBeenCalled()
    expect(mocks.correctIntakePatch).not.toHaveBeenCalled()
    expect(mocks.rejectIntakePatch).not.toHaveBeenCalled()
  })
})

describe("POST /api/intake/[id]/patches/[patchId]", () => {
  it("rejects an unknown disposition", async () => {
    const res = await POST(request("POST", { disposition: "OVERWRITE" }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("INVALID_INPUT")
    expect(mocks.applyIntakePatch).not.toHaveBeenCalled()
  })

  it("returns a conflict review task when the profile already has a different value", async () => {
    const res = await POST(request("POST", {}), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(CONFLICT)
    expect(mocks.applyIntakePatch).toHaveBeenCalledWith("user-1", "patch-1", undefined)
  })

  it("passes an explicit resolution through", async () => {
    mocks.applyIntakePatch.mockResolvedValue({
      status: "APPLIED",
      patchId: "patch-1",
      appliedTargetType: "career_profile",
      appliedTargetId: "profile-1",
      conflict: null,
      message: "contactEmail updated.",
    })

    const res = await POST(request("POST", { disposition: "ACCEPT_INCOMING" }), params)

    expect(res.status).toBe(200)
    expect(mocks.applyIntakePatch).toHaveBeenCalledWith(
      "user-1",
      "patch-1",
      "ACCEPT_INCOMING"
    )
  })

  it("maps a confirmed-evidence refusal to 409", async () => {
    mocks.applyIntakePatch.mockRejectedValue(
      new IntakeApplyError(409, "That evidence is already confirmed.")
    )

    const res = await POST(request("POST", {}), params)

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("CONFLICT")
  })

  it("maps a foreign patch id to 404", async () => {
    mocks.applyIntakePatch.mockRejectedValue(new IntakeApplyError(404, "Intake fact not found"))

    const res = await POST(request("POST", {}), params)

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("PATCH_NOT_FOUND")
  })
})

describe("PATCH /api/intake/[id]/patches/[patchId]", () => {
  it("rejects a correction whose kind does not carry its required data", async () => {
    const res = await PATCH(request("PATCH", { correction: { kind: "SKILL" } }), params)

    expect(res.status).toBe(400)
    expect(mocks.correctIntakePatch).not.toHaveBeenCalled()
  })

  it("forwards the correction, note and authenticated owner", async () => {
    const correction = {
      kind: "SKILL",
      data: { name: "TypeScript", category: "Language" },
    }

    const res = await PATCH(
      request("PATCH", { correction, note: "Capitalize the product name." }),
      params
    )

    expect(res.status).toBe(200)
    expect(mocks.correctIntakePatch).toHaveBeenCalledWith(
      "user-1",
      "patch-1",
      correction,
      "Capitalize the product name."
    )
  })

  it("maps a foreign patch correction to 404", async () => {
    mocks.correctIntakePatch.mockRejectedValue(
      new IntakeApplyError(404, "Intake fact not found")
    )

    const res = await PATCH(
      request("PATCH", {
        correction: { kind: "SKILL", data: { name: "Go", category: null } },
      }),
      params
    )

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("PATCH_NOT_FOUND")
  })
})

describe("DELETE /api/intake/[id]/patches/[patchId]", () => {
  it("forwards a rejection reason for the authenticated owner", async () => {
    const res = await DELETE(request("DELETE", { reason: "Not my claim." }), params)

    expect(res.status).toBe(200)
    expect(mocks.rejectIntakePatch).toHaveBeenCalledWith(
      "user-1",
      "patch-1",
      "Not my claim."
    )
  })

  it("refuses to reject an already-applied fact", async () => {
    mocks.rejectIntakePatch.mockRejectedValue(
      new IntakeApplyError(409, "This fact is already in the profile.")
    )

    const res = await DELETE(request("DELETE", {}), params)

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("CONFLICT")
  })
})
