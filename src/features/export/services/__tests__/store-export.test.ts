import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const { mockPut, mockList, mockDel, mockDeleteMany } = vi.hoisted(() => ({
  mockPut: vi.fn(),
  mockList: vi.fn(),
  mockDel: vi.fn(),
  mockDeleteMany: vi.fn(),
}))

vi.mock("@vercel/blob", () => ({ put: mockPut, list: mockList, del: mockDel }))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: { resumeExport: { deleteMany: mockDeleteMany } },
}))

// A directory `rm` genuinely refuses: `force: true` swallows ENOENT and ENOTDIR,
// so a NUL byte in the path is the reliable way to make the real call throw.
const UNREMOVABLE_DIR = "C:\\rolespec-test\u0000invalid"

import {
  DEFAULT_EXPORT_RETENTION_DAYS,
  deleteExportFilesForResumes,
  exportRetentionDays,
  pruneExpiredExports,
  sanitizeTemplateUrls,
  storeAllTemplateExports,
} from "../store-export"

// Mirrors SAFE_FILENAME in src/app/api/exports/[...path]/route.ts — a filename
// the route rejects would be an export nobody can download.
const SAFE_FILENAME = /^[A-Za-z0-9_-]+\.pdf$/

function exportsFor(templates: string[]) {
  return templates.map((template) => ({
    template,
    pdfBuffer: Buffer.from(`${template}-pdf`),
  }))
}

function pathnames() {
  return mockPut.mock.calls.map((call) => call[0] as string)
}

describe("storeAllTemplateExports", () => {
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token"
    mockPut.mockReset()
    mockPut.mockImplementation((pathname: string) =>
      Promise.resolve({ url: `https://blob.test/${pathname}` })
    )
  })

  afterEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it("uploads the pdf with resumeId, lowercased template, extension and content type", async () => {
    await storeAllTemplateExports("resume-1", exportsFor(["Modern"]))

    expect(mockPut).toHaveBeenCalledTimes(1)

    const pdfCall = mockPut.mock.calls.find((call) => (call[0] as string).endsWith(".pdf"))!

    expect(pdfCall[0]).toMatch(/^exports\/resume-1\/[^/]+\/modern-[A-Za-z0-9_-]+\.pdf$/)
    expect(pdfCall[2]).toEqual({
      access: "private",
      contentType: "application/pdf",
    })
  })

  it("stores blobs privately and does not delegate naming to addRandomSuffix", async () => {
    await storeAllTemplateExports("resume-1", exportsFor(["Modern", "Classic"]))

    expect(mockPut).toHaveBeenCalledTimes(2)
    for (const call of mockPut.mock.calls) {
      expect(call[2]).toMatchObject({ access: "private" })
      expect(call[2]).not.toHaveProperty("addRandomSuffix")
    }
  })

  it("returns same-origin /api/exports URLs, never the blob URL", async () => {
    const result = await storeAllTemplateExports("resume-1", exportsFor(["Modern", "Classic"]))

    expect(Object.keys(result).sort()).toEqual(["Classic", "Modern"])

    for (const template of ["Modern", "Classic"] as const) {
      const url = result[template].pdfUrl
      expect(url).not.toContain("blob.test")
      expect(url).toMatch(
        new RegExp(`^/api/exports/resume-1/[^/]+/${template.toLowerCase()}-[A-Za-z0-9_-]+\\.pdf$`)
      )
      expect(url.split("/").pop()!).toMatch(SAFE_FILENAME)
    }
  })

  it("uploads to the same pathname it hands back as a download URL", async () => {
    const result = await storeAllTemplateExports("resume-1", exportsFor(["Modern"]))

    expect(result.Modern.pdfUrl).toBe(`/api/exports/${pathnames()[0].replace("exports/", "")}`)
  })

  it("produces different pathnames across successive calls for the same resume and template", async () => {
    await storeAllTemplateExports("resume-1", exportsFor(["Modern"]))
    const first = pathnames()

    await storeAllTemplateExports("resume-1", exportsFor(["Modern"]))
    const second = pathnames().slice(first.length)

    expect(second).toHaveLength(1)
    for (const pathname of second) {
      expect(first).not.toContain(pathname)
    }
    expect(new Set([...first, ...second]).size).toBe(2)
  })

  it("keeps filenames unguessable even within one batch", async () => {
    await storeAllTemplateExports("resume-1", exportsFor(["Modern"]))
    await storeAllTemplateExports("resume-1", exportsFor(["Modern"]))

    const filenames = pathnames().map((pathname) => pathname.split("/").pop()!)
    expect(new Set(filenames).size).toBe(2)
    for (const filename of filenames) {
      expect(filename).toMatch(/^modern-[A-Za-z0-9_-]{12}\.pdf$/)
    }
  })

  it("shares one batch segment between templates within a single call", async () => {
    await storeAllTemplateExports("resume-1", exportsFor(["Modern", "Classic"]))

    const batches = pathnames().map((pathname) => pathname.split("/")[2])
    expect(batches).toHaveLength(2)
    expect(new Set(batches).size).toBe(1)
  })

  it("returns pdfUrl per template", async () => {
    const result = await storeAllTemplateExports("resume-1", exportsFor(["Modern", "Classic"]))

    const batch = pathnames()[0].split("/")[2]
    expect(result.Modern.pdfUrl.startsWith(`/api/exports/resume-1/${batch}/modern-`)).toBe(true)
    expect(result.Classic.pdfUrl.startsWith(`/api/exports/resume-1/${batch}/classic-`)).toBe(true)
  })
})

describe("storeAllTemplateExports without blob credentials (local fallback)", () => {
  let storageDir: string

  beforeEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    storageDir = mkdtempSync(path.join(tmpdir(), "rolespec-exports-"))
    process.env.EXPORT_STORAGE_DIR = storageDir
    mockPut.mockReset()
  })

  afterEach(() => {
    delete process.env.EXPORT_STORAGE_DIR
    rmSync(storageDir, { recursive: true, force: true })
  })

  it("never calls Vercel Blob", async () => {
    await storeAllTemplateExports("resume-1", exportsFor(["Modern"]))
    expect(mockPut).not.toHaveBeenCalled()
  })

  it("writes the pdf to EXPORT_STORAGE_DIR and returns /api/exports URLs", async () => {
    const result = await storeAllTemplateExports("resume-1", exportsFor(["Modern"]))

    expect(result.Modern.pdfUrl).toMatch(
      /^\/api\/exports\/resume-1\/[^/]+\/modern-[A-Za-z0-9_-]+\.pdf$/
    )

    const [, , resumeId, batch, pdfName] = result.Modern.pdfUrl.split("/").slice(1)
    void resumeId
    const files = readdirSync(path.join(storageDir, "resume-1", batch))
    expect(files.sort()).toHaveLength(1)
    expect(readFileSync(path.join(storageDir, "resume-1", batch, pdfName), "utf8")).toBe(
      "Modern-pdf"
    )
  })

  it("keeps filenames unguessable with a random suffix per upload", async () => {
    const first = await storeAllTemplateExports("resume-1", exportsFor(["Modern"]))
    const second = await storeAllTemplateExports("resume-1", exportsFor(["Modern"]))
    expect(first.Modern.pdfUrl).not.toBe(second.Modern.pdfUrl)
  })
})

describe("deleteExportFilesForResumes", () => {
  let storageDir: string

  function seedDiskExport(resumeId: string) {
    const dir = path.join(storageDir, resumeId, "batch-1")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "modern-abc123.pdf"), "%PDF-fake")
    return dir
  }

  beforeEach(() => {
    storageDir = mkdtempSync(path.join(tmpdir(), "rolespec-exports-delete-"))
    process.env.EXPORT_STORAGE_DIR = storageDir
    mockList.mockReset().mockResolvedValue({ blobs: [], hasMore: false })
    mockDel.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete process.env.EXPORT_STORAGE_DIR
    delete process.env.BLOB_READ_WRITE_TOKEN
    rmSync(storageDir, { recursive: true, force: true })
  })

  it("does nothing when there are no resumes", async () => {
    await deleteExportFilesForResumes([])
    expect(mockList).not.toHaveBeenCalled()
    expect(mockDel).not.toHaveBeenCalled()
  })

  it("removes the resume's export directory from disk", async () => {
    const dir = seedDiskExport("resume-1")
    seedDiskExport("resume-2")

    await deleteExportFilesForResumes(["resume-1"])

    expect(existsSync(dir)).toBe(false)
    expect(existsSync(path.join(storageDir, "resume-1"))).toBe(false)
    // Only the requested resume is touched.
    expect(existsSync(path.join(storageDir, "resume-2"))).toBe(true)
  })

  it("does not call blob storage without a token, but still cleans disk", async () => {
    seedDiskExport("resume-1")

    await deleteExportFilesForResumes(["resume-1"])

    expect(mockList).not.toHaveBeenCalled()
    expect(mockDel).not.toHaveBeenCalled()
    expect(existsSync(path.join(storageDir, "resume-1"))).toBe(false)
  })

  it("lists and deletes the blobs under each resume prefix", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token"
    mockList.mockImplementation(async ({ prefix }: { prefix: string }) => ({
      blobs: [{ pathname: `${prefix}batch-1/modern-abc.pdf` }],
      hasMore: false,
    }))

    await deleteExportFilesForResumes(["resume-1", "resume-2"])

    expect(mockList).toHaveBeenNthCalledWith(1, { prefix: "exports/resume-1/", cursor: undefined })
    expect(mockList).toHaveBeenNthCalledWith(2, { prefix: "exports/resume-2/", cursor: undefined })
    expect(mockDel).toHaveBeenCalledTimes(2)
    expect(mockDel).toHaveBeenNthCalledWith(1, ["exports/resume-1/batch-1/modern-abc.pdf"])
    expect(mockDel).toHaveBeenNthCalledWith(2, ["exports/resume-2/batch-1/modern-abc.pdf"])
  })

  it("follows list pagination and deletes every page's blobs in one call", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token"
    mockList
      .mockResolvedValueOnce({
        blobs: [{ pathname: "exports/resume-1/b1/modern-1.pdf" }],
        cursor: "cursor-2",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        blobs: [{ pathname: "exports/resume-1/b2/classic-2.pdf" }],
        hasMore: false,
      })

    await deleteExportFilesForResumes(["resume-1"])

    expect(mockList).toHaveBeenCalledTimes(2)
    expect(mockList).toHaveBeenNthCalledWith(2, {
      prefix: "exports/resume-1/",
      cursor: "cursor-2",
    })
    expect(mockDel).toHaveBeenCalledTimes(1)
    expect(mockDel).toHaveBeenCalledWith([
      "exports/resume-1/b1/modern-1.pdf",
      "exports/resume-1/b2/classic-2.pdf",
    ])
  })

  it("skips the delete call when a resume has no blobs", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token"

    await deleteExportFilesForResumes(["resume-1"])

    expect(mockList).toHaveBeenCalledTimes(1)
    expect(mockDel).not.toHaveBeenCalled()
  })

  it("swallows a failing list and still cleans the disk copy", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token"
    seedDiskExport("resume-1")
    mockList.mockRejectedValue(new Error("blob store unavailable"))

    await expect(deleteExportFilesForResumes(["resume-1"])).resolves.toBeUndefined()

    expect(existsSync(path.join(storageDir, "resume-1"))).toBe(false)
  })

  it("swallows a failing del and keeps going to the next resume", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token"
    mockList.mockResolvedValue({
      blobs: [{ pathname: "exports/x/b/modern.pdf" }],
      hasMore: false,
    })
    mockDel.mockRejectedValueOnce(new Error("blob delete failed"))

    await expect(
      deleteExportFilesForResumes(["resume-1", "resume-2"])
    ).resolves.toBeUndefined()

    expect(mockDel).toHaveBeenCalledTimes(2)
  })

  it("swallows a failing disk removal", async () => {
    process.env.EXPORT_STORAGE_DIR = UNREMOVABLE_DIR

    await expect(deleteExportFilesForResumes(["resume-1"])).resolves.toBeUndefined()
  })

  it("keeps going to the next resume after a disk removal fails", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token"
    process.env.EXPORT_STORAGE_DIR = UNREMOVABLE_DIR
    mockList.mockResolvedValue({
      blobs: [{ pathname: "exports/x/b/modern.pdf" }],
      hasMore: false,
    })

    await deleteExportFilesForResumes(["resume-1", "resume-2"])

    expect(mockDel).toHaveBeenCalledTimes(2)
  })
})

describe("exportRetentionDays", () => {
  afterEach(() => {
    delete process.env.EXPORT_RETENTION_DAYS
  })

  it("defaults to 90 days when unset", () => {
    expect(DEFAULT_EXPORT_RETENTION_DAYS).toBe(90)
    expect(exportRetentionDays()).toBe(90)
  })

  it("reads a positive integer, trimming whitespace", () => {
    process.env.EXPORT_RETENTION_DAYS = "30"
    expect(exportRetentionDays()).toBe(30)

    process.env.EXPORT_RETENTION_DAYS = "  365  "
    expect(exportRetentionDays()).toBe(365)
  })

  it("falls back to the default for empty, zero, negative and malformed values", () => {
    for (const value of ["", "   ", "0", "-5", "-1", "abc", "12.5", "90d", "NaN", "Infinity"]) {
      process.env.EXPORT_RETENTION_DAYS = value
      expect(exportRetentionDays(), `value=${JSON.stringify(value)}`).toBe(90)
    }
  })
})

describe("pruneExpiredExports", () => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  let storageDir: string

  /** Batch names are `${Date.now()}-${uuid.slice(0,8)}` — decimal epoch ms. */
  function seedBatch(resumeId: string, batchName: string, ageDays?: number) {
    const dir = path.join(storageDir, resumeId, batchName)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "modern-abc123.pdf"), "%PDF-fake")
    if (ageDays !== undefined) {
      const when = new Date(Date.now() - ageDays * MS_PER_DAY)
      utimesSync(dir, when, when)
    }
    return dir
  }

  function batchNameAged(ageDays: number) {
    return `${Date.now() - ageDays * MS_PER_DAY}-a1b2c3d4`
  }

  function blob(pathname: string, ageDays: number) {
    return { pathname, uploadedAt: new Date(Date.now() - ageDays * MS_PER_DAY) }
  }

  beforeEach(() => {
    storageDir = mkdtempSync(path.join(tmpdir(), "rolespec-exports-prune-"))
    process.env.EXPORT_STORAGE_DIR = storageDir
    mockList.mockReset().mockResolvedValue({ blobs: [], hasMore: false })
    mockDel.mockReset().mockResolvedValue(undefined)
    mockDeleteMany.mockReset().mockResolvedValue({ count: 0 })
  })

  afterEach(() => {
    delete process.env.EXPORT_STORAGE_DIR
    delete process.env.EXPORT_RETENTION_DAYS
    delete process.env.BLOB_READ_WRITE_TOKEN
    rmSync(storageDir, { recursive: true, force: true })
  })

  describe("ResumeExport rows", () => {
    it("deletes rows older than the retention cutoff and reports the count", async () => {
      mockDeleteMany.mockResolvedValue({ count: 7 })

      const before = Date.now()
      const result = await pruneExpiredExports(30)
      const after = Date.now()

      expect(mockDeleteMany).toHaveBeenCalledTimes(1)
      const cutoff = mockDeleteMany.mock.calls[0][0].where.createdAt.lt as Date
      expect(cutoff).toBeInstanceOf(Date)
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 30 * MS_PER_DAY)
      expect(cutoff.getTime()).toBeLessThanOrEqual(after - 30 * MS_PER_DAY)

      expect(result.rows).toBe(7)
      expect(result.retentionDays).toBe(30)
      expect(result.cutoff).toBe(cutoff.toISOString())
    })

    it("uses EXPORT_RETENTION_DAYS when no retention is passed", async () => {
      process.env.EXPORT_RETENTION_DAYS = "10"

      const before = Date.now()
      const result = await pruneExpiredExports()

      const cutoff = mockDeleteMany.mock.calls[0][0].where.createdAt.lt as Date
      expect(result.retentionDays).toBe(10)
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 10 * MS_PER_DAY)
      expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - 10 * MS_PER_DAY)
    })

    it("defaults to 90 days when EXPORT_RETENTION_DAYS is unset", async () => {
      const before = Date.now()
      const result = await pruneExpiredExports()

      const cutoff = mockDeleteMany.mock.calls[0][0].where.createdAt.lt as Date
      expect(result.retentionDays).toBe(90)
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 90 * MS_PER_DAY)
      expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - 90 * MS_PER_DAY)
    })

    it("aborts before deleting any file when the row delete fails", async () => {
      process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token"
      const dir = seedBatch("resume-1", batchNameAged(200))
      mockDeleteMany.mockRejectedValue(new Error("db down"))

      await expect(pruneExpiredExports(90)).rejects.toThrow("db down")

      expect(mockList).not.toHaveBeenCalled()
      expect(mockDel).not.toHaveBeenCalled()
      expect(existsSync(dir)).toBe(true)
    })
  })

  describe("blob backend", () => {
    beforeEach(() => {
      process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token"
    })

    it("is skipped entirely without a blob token", async () => {
      delete process.env.BLOB_READ_WRITE_TOKEN

      const result = await pruneExpiredExports(90)

      expect(mockList).not.toHaveBeenCalled()
      expect(mockDel).not.toHaveBeenCalled()
      expect(result.blobs).toBe(0)
    })

    it("deletes blobs older than the cutoff and keeps fresh ones", async () => {
      mockList.mockResolvedValue({
        blobs: [
          blob("exports/resume-1/b1/modern-old.pdf", 120),
          blob("exports/resume-1/b2/modern-fresh.pdf", 3),
          blob("exports/resume-2/b3/classic-old.pdf", 91),
        ],
        hasMore: false,
      })

      const result = await pruneExpiredExports(90)

      expect(mockList).toHaveBeenCalledWith({ prefix: "exports/", cursor: undefined })
      expect(mockDel).toHaveBeenCalledTimes(1)
      expect(mockDel).toHaveBeenCalledWith([
        "exports/resume-1/b1/modern-old.pdf",
        "exports/resume-2/b3/classic-old.pdf",
      ])
      expect(result.blobs).toBe(2)
    })

    it("keeps a blob whose uploadedAt is unparseable rather than guessing", async () => {
      mockList.mockResolvedValue({
        blobs: [{ pathname: "exports/resume-1/b1/modern-x.pdf", uploadedAt: "not-a-date" }],
        hasMore: false,
      })

      const result = await pruneExpiredExports(90)

      expect(mockDel).not.toHaveBeenCalled()
      expect(result.blobs).toBe(0)
    })

    it("follows list pagination before deleting anything", async () => {
      mockList
        .mockResolvedValueOnce({
          blobs: [blob("exports/resume-1/b1/modern-1.pdf", 120)],
          cursor: "cursor-2",
          hasMore: true,
        })
        .mockResolvedValueOnce({
          blobs: [blob("exports/resume-1/b2/classic-2.pdf", 200)],
          hasMore: false,
        })

      const result = await pruneExpiredExports(90)

      expect(mockList).toHaveBeenCalledTimes(2)
      expect(mockList).toHaveBeenNthCalledWith(2, { prefix: "exports/", cursor: "cursor-2" })
      expect(mockDel).toHaveBeenCalledTimes(1)
      expect(mockDel).toHaveBeenCalledWith([
        "exports/resume-1/b1/modern-1.pdf",
        "exports/resume-1/b2/classic-2.pdf",
      ])
      expect(result.blobs).toBe(2)
    })

    it("logs a failing del instead of throwing, and still prunes disk", async () => {
      const dir = seedBatch("resume-1", batchNameAged(200))
      mockList.mockResolvedValue({
        blobs: [blob("exports/resume-1/b1/modern-old.pdf", 120)],
        hasMore: false,
      })
      mockDel.mockRejectedValue(new Error("blob delete failed"))

      const result = await pruneExpiredExports(90)

      expect(result.blobs).toBe(0)
      expect(result.batches).toBe(1)
      expect(existsSync(dir)).toBe(false)
    })

    it("logs a failing list instead of throwing, and still prunes disk", async () => {
      const dir = seedBatch("resume-1", batchNameAged(200))
      mockList.mockRejectedValue(new Error("blob store unavailable"))

      const result = await pruneExpiredExports(90)

      expect(result.blobs).toBe(0)
      expect(existsSync(dir)).toBe(false)
    })
  })

  describe("disk backend", () => {
    it("removes expired batch directories and keeps fresh ones", async () => {
      const expired = seedBatch("resume-1", batchNameAged(120))
      const fresh = seedBatch("resume-1", batchNameAged(2))

      const result = await pruneExpiredExports(90)

      expect(existsSync(expired)).toBe(false)
      expect(existsSync(fresh)).toBe(true)
      expect(result.batches).toBe(1)
    })

    it("keeps a batch exactly at the retention boundary", async () => {
      // Named a hair inside the window; the sweep deletes strictly older only.
      const dir = seedBatch("resume-1", `${Date.now() - 90 * MS_PER_DAY + 5_000}-a1b2c3d4`)

      const result = await pruneExpiredExports(90)

      expect(existsSync(dir)).toBe(true)
      expect(result.batches).toBe(0)
    })

    it("removes the resume directory once its last batch is gone", async () => {
      seedBatch("resume-1", batchNameAged(120))
      seedBatch("resume-2", batchNameAged(120))
      seedBatch("resume-2", batchNameAged(1))

      await pruneExpiredExports(90)

      expect(existsSync(path.join(storageDir, "resume-1"))).toBe(false)
      expect(existsSync(path.join(storageDir, "resume-2"))).toBe(true)
    })

    it("falls back to directory mtime when the name carries no timestamp", async () => {
      const legacy = seedBatch("resume-1", "batch-1", 120)
      const recent = seedBatch("resume-1", "batch-2", 1)

      const result = await pruneExpiredExports(90)

      expect(existsSync(legacy)).toBe(false)
      expect(existsSync(recent)).toBe(true)
      expect(result.batches).toBe(1)
    })

    it("ignores a future timestamp in the name and uses mtime instead", async () => {
      const dir = seedBatch("resume-1", `${Date.now() + 10 * MS_PER_DAY}-a1b2c3d4`, 120)

      const result = await pruneExpiredExports(90)

      expect(existsSync(dir)).toBe(false)
      expect(result.batches).toBe(1)
    })

    it("ignores loose files at the resume and root level", async () => {
      writeFileSync(path.join(storageDir, "stray.pdf"), "%PDF-fake")
      mkdirSync(path.join(storageDir, "resume-1"), { recursive: true })
      const strayInResume = path.join(storageDir, "resume-1", "stray.pdf")
      writeFileSync(strayInResume, "%PDF-fake")

      const result = await pruneExpiredExports(90)

      expect(result.batches).toBe(0)
      expect(existsSync(path.join(storageDir, "stray.pdf"))).toBe(true)
      expect(existsSync(strayInResume)).toBe(true)
    })

    it("reports zero when the storage directory does not exist", async () => {
      process.env.EXPORT_STORAGE_DIR = path.join(storageDir, "does-not-exist")

      const result = await pruneExpiredExports(90)

      expect(result).toMatchObject({ rows: 0, blobs: 0, batches: 0 })
    })
  })
})

describe("sanitizeTemplateUrls", () => {
  it("keeps only same-origin entries out of a mixed set", () => {
    const result = sanitizeTemplateUrls({
      modern: { pdfUrl: "/api/exports/resume-1/batch/modern-abc.pdf" },
      classic: {
        pdfUrl: "https://foo-bar.public.blob.vercel-storage.com/exports/resume-1/classic.pdf",
      },
    })

    expect(result).toEqual({
      modern: { pdfUrl: "/api/exports/resume-1/batch/modern-abc.pdf" },
    })
  })

  it("returns null when every entry is legacy", () => {
    const result = sanitizeTemplateUrls({
      modern: {
        pdfUrl: "https://foo-bar.public.blob.vercel-storage.com/exports/resume-1/modern.pdf",
      },
    })

    expect(result).toBeNull()
  })

  it("returns null for non-object values", () => {
    expect(sanitizeTemplateUrls(null)).toBeNull()
    expect(sanitizeTemplateUrls(undefined)).toBeNull()
    expect(sanitizeTemplateUrls("not-an-object")).toBeNull()
    expect(sanitizeTemplateUrls(42)).toBeNull()
    expect(sanitizeTemplateUrls([{ pdfUrl: "/api/exports/x" }])).toBeNull()
  })

  it("drops malformed entries without throwing", () => {
    const result = sanitizeTemplateUrls({
      missingUrl: {},
      nullEntry: null,
      wrongType: { pdfUrl: 123 },
      protocolRelative: { pdfUrl: "//evil.example.com/api/exports/x" },
      http: { pdfUrl: "http://localhost/api/exports/x" },
      uppercase: { pdfUrl: "/API/exports/x" },
      good: { pdfUrl: "/api/exports/resume-1/batch/good.pdf" },
    })

    expect(result).toEqual({
      good: { pdfUrl: "/api/exports/resume-1/batch/good.pdf" },
    })
  })
})
