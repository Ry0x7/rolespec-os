// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const auth = vi.fn()
const resumeFindUnique = vi.fn()
const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))

vi.mock("@/features/auth/config", () => ({ auth: () => auth() }))
vi.mock("@vercel/blob", () => ({ get: mockGet }))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    resume: { findUnique: (...args: unknown[]) => resumeFindUnique(...args) },
  },
}))

import { GET } from "../route"

const USER_ID = "user-1"
const REQ = new Request("http://localhost/api/exports/x")

function call(segments: string[]) {
  return GET(REQ, { params: Promise.resolve({ path: segments }) })
}

function blobHit(body: string) {
  return {
    statusCode: 200 as const,
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    }),
  }
}

describe("GET /api/exports/[...path]", () => {
  let storageDir: string

  beforeEach(() => {
    storageDir = mkdtempSync(path.join(tmpdir(), "rolespec-exports-route-"))
    process.env.EXPORT_STORAGE_DIR = storageDir
    auth.mockReset().mockResolvedValue({ user: { id: USER_ID } })
    resumeFindUnique.mockReset().mockResolvedValue({ id: "resume-1" })
    mockGet.mockReset().mockResolvedValue(null)
    delete process.env.BLOB_READ_WRITE_TOKEN

    mkdirSync(path.join(storageDir, "resume-1", "batch-1"), { recursive: true })
    writeFileSync(path.join(storageDir, "resume-1", "batch-1", "modern-abc123.pdf"), "%PDF-fake")
  })

  afterEach(() => {
    delete process.env.EXPORT_STORAGE_DIR
    delete process.env.BLOB_READ_WRITE_TOKEN
    rmSync(storageDir, { recursive: true, force: true })
  })

  it("serves an owned export with the right content type", async () => {
    const res = await call(["resume-1", "batch-1", "modern-abc123.pdf"])

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(await res.text()).toBe("%PDF-fake")
    expect(resumeFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "resume-1", userId: USER_ID } })
    )
  })

  it("401s without a session", async () => {
    auth.mockResolvedValue(null)
    const res = await call(["resume-1", "batch-1", "modern-abc123.pdf"])
    expect(res.status).toBe(401)
  })

  it("404s when the resume belongs to someone else", async () => {
    resumeFindUnique.mockResolvedValue(null)
    const res = await call(["resume-1", "batch-1", "modern-abc123.pdf"])
    expect(res.status).toBe(404)
  })

  it("404s on path traversal attempts", async () => {
    for (const segments of [
      ["..", "batch-1", "modern-abc123.pdf"],
      ["resume-1", "..", "modern-abc123.pdf"],
      ["resume-1", "batch-1", "..%2F..%2Fsecret.pdf"],
      ["resume-1", "batch-1", "modern.pdf", "extra"],
      ["resume-1", "batch-1", "modern.exe"],
    ]) {
      const res = await call(segments)
      expect(res.status).toBe(404)
    }
  })

  it("404s when the file does not exist on disk", async () => {
    const res = await call(["resume-1", "batch-1", "missing-file.pdf"])
    expect(res.status).toBe(404)
  })

  it("never touches blob storage when no token is configured", async () => {
    await call(["resume-1", "batch-1", "modern-abc123.pdf"])
    expect(mockGet).not.toHaveBeenCalled()
  })
})

describe("GET /api/exports/[...path] with Vercel Blob configured", () => {
  let storageDir: string

  beforeEach(() => {
    storageDir = mkdtempSync(path.join(tmpdir(), "rolespec-exports-route-blob-"))
    process.env.EXPORT_STORAGE_DIR = storageDir
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token"
    auth.mockReset().mockResolvedValue({ user: { id: USER_ID } })
    resumeFindUnique.mockReset().mockResolvedValue({ id: "resume-1" })
    mockGet.mockReset().mockResolvedValue(blobHit("%PDF-blob"))
  })

  afterEach(() => {
    delete process.env.EXPORT_STORAGE_DIR
    delete process.env.BLOB_READ_WRITE_TOKEN
    rmSync(storageDir, { recursive: true, force: true })
  })

  it("streams the private blob with the same headers as a disk download", async () => {
    const res = await call(["resume-1", "batch-1", "modern-abc123.pdf"])

    expect(mockGet).toHaveBeenCalledWith("exports/resume-1/batch-1/modern-abc123.pdf", {
      access: "private",
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toBe("inline")
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable")
    expect(await res.text()).toBe("%PDF-blob")
  })

  it("401s before reading the blob when nobody is signed in", async () => {
    auth.mockResolvedValue(null)

    const res = await call(["resume-1", "batch-1", "modern-abc123.pdf"])

    expect(res.status).toBe(401)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it("404s before reading the blob when the resume belongs to someone else", async () => {
    resumeFindUnique.mockResolvedValue(null)

    const res = await call(["resume-1", "batch-1", "modern-abc123.pdf"])

    expect(res.status).toBe(404)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it("falls back to disk when the blob is missing (deployment moved backends)", async () => {
    mockGet.mockResolvedValue(null)
    mkdirSync(path.join(storageDir, "resume-1", "batch-1"), { recursive: true })
    writeFileSync(path.join(storageDir, "resume-1", "batch-1", "modern-abc123.pdf"), "%PDF-disk")

    const res = await call(["resume-1", "batch-1", "modern-abc123.pdf"])

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("%PDF-disk")
  })

  it("404s when the blob is missing and there is no disk copy either", async () => {
    mockGet.mockResolvedValue(null)

    const res = await call(["resume-1", "batch-1", "modern-abc123.pdf"])

    expect(res.status).toBe(404)
  })

  it("falls back to disk when the blob read throws", async () => {
    mockGet.mockRejectedValue(new Error("blob store unavailable"))
    mkdirSync(path.join(storageDir, "resume-1", "batch-1"), { recursive: true })
    writeFileSync(path.join(storageDir, "resume-1", "batch-1", "modern-abc123.pdf"), "%PDF-disk")

    const res = await call(["resume-1", "batch-1", "modern-abc123.pdf"])

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("%PDF-disk")
  })
})
