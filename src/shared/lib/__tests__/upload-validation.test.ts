import { describe, it, expect } from "vitest"

import {
  checkZipSanity,
  sanitizeUploadTitle,
  sniffUploadKind,
} from "../upload-validation"

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0))
}

function uint16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff]
}

function uint32(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]
}

interface ZipEntry {
  name: string
  uncompressedSize: number
}

/**
 * Builds the parts of a zip this validator actually reads: a local header per
 * entry, a central directory, and an EOCD. File data is empty — the declared
 * uncompressed size is what `checkZipSanity` inspects.
 */
function buildZip(entries: ZipEntry[], comment = ""): Uint8Array {
  const out: number[] = []
  const offsets: number[] = []

  for (const entry of entries) {
    offsets.push(out.length)
    out.push(
      ...uint32(0x04034b50),
      ...uint16(20), // version needed
      ...uint16(0), // flags
      ...uint16(0), // method: stored
      ...uint16(0), // time
      ...uint16(0), // date
      ...uint32(0), // crc
      ...uint32(0), // compressed size
      ...uint32(entry.uncompressedSize),
      ...uint16(entry.name.length),
      ...uint16(0), // extra length
      ...ascii(entry.name)
    )
  }

  const directoryOffset = out.length
  entries.forEach((entry, i) => {
    out.push(
      ...uint32(0x02014b50),
      ...uint16(20), // version made by
      ...uint16(20), // version needed
      ...uint16(0), // flags
      ...uint16(0), // method
      ...uint16(0), // time
      ...uint16(0), // date
      ...uint32(0), // crc
      ...uint32(0), // compressed size
      ...uint32(entry.uncompressedSize),
      ...uint16(entry.name.length),
      ...uint16(0), // extra length
      ...uint16(0), // comment length
      ...uint16(0), // disk number
      ...uint16(0), // internal attrs
      ...uint32(0), // external attrs
      ...uint32(offsets[i]),
      ...ascii(entry.name)
    )
  })
  const directorySize = out.length - directoryOffset

  out.push(
    ...uint32(0x06054b50),
    ...uint16(0), // disk
    ...uint16(0), // disk with cd
    ...uint16(entries.length),
    ...uint16(entries.length),
    ...uint32(directorySize),
    ...uint32(directoryOffset),
    ...uint16(comment.length),
    ...ascii(comment)
  )

  return new Uint8Array(out)
}

describe("sniffUploadKind", () => {
  it("recognises a PDF header", () => {
    expect(sniffUploadKind(new Uint8Array(ascii("%PDF-1.4\n%\xe2\xe3")))).toBe("pdf")
  })

  it("recognises a zip (DOCX container) header", () => {
    expect(sniffUploadKind(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00))).toBe("zip")
  })

  it("returns null for anything else", () => {
    expect(sniffUploadKind(new Uint8Array(ascii("<html><body>hi")))).toBeNull()
    // A PNG — an easy thing to rename to .pdf.
    expect(sniffUploadKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBeNull()
  })

  it("returns null for a buffer too short to tell", () => {
    expect(sniffUploadKind(new Uint8Array(ascii("%PD")))).toBeNull()
    expect(sniffUploadKind(bytes(0x50, 0x4b))).toBeNull()
    expect(sniffUploadKind(new Uint8Array())).toBeNull()
  })

  it("does not accept a PDF header that is not at the start", () => {
    expect(sniffUploadKind(new Uint8Array(ascii("junk%PDF-1.4")))).toBeNull()
  })
})

describe("checkZipSanity", () => {
  it("accepts a small well-formed archive", () => {
    const zip = buildZip([
      { name: "[Content_Types].xml", uncompressedSize: 1200 },
      { name: "word/document.xml", uncompressedSize: 40_000 },
    ])

    expect(checkZipSanity(zip)).toMatchObject({
      ok: true,
      entries: 2,
      totalUncompressedBytes: 41_200,
    })
  })

  it("rejects an archive declaring more uncompressed bytes than the cap", () => {
    const zip = buildZip([{ name: "bomb.bin", uncompressedSize: 4_000_000_000 }])

    expect(checkZipSanity(zip)).toMatchObject({
      ok: false,
      reason: "too_large_uncompressed",
    })
  })

  it("honours a caller-supplied byte cap", () => {
    const zip = buildZip([{ name: "a.xml", uncompressedSize: 5000 }])

    expect(checkZipSanity(zip, { maxTotalUncompressedBytes: 1000 })).toMatchObject({
      ok: false,
      reason: "too_large_uncompressed",
    })
    expect(checkZipSanity(zip, { maxTotalUncompressedBytes: 6000 }).ok).toBe(true)
  })

  it("rejects an archive with more entries than the cap", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      name: `f${i}.xml`,
      uncompressedSize: 10,
    }))

    expect(checkZipSanity(buildZip(many), { maxEntries: 5 })).toMatchObject({
      ok: false,
      reason: "too_many_entries",
      entries: 20,
    })
  })

  it("rejects garbage with no EOCD record", () => {
    const junk = new Uint8Array(500).fill(0x41)

    expect(checkZipSanity(junk)).toMatchObject({ ok: false, reason: "no_eocd" })
  })

  it("rejects an EOCD pointing past the end of the buffer", () => {
    const zip = buildZip([{ name: "a.xml", uncompressedSize: 10 }])
    // Overwrite the central-directory offset (EOCD + 16) with a bogus value.
    const eocd = zip.length - 22
    zip.set(uint32(0xfffffff0), eocd + 16)

    expect(checkZipSanity(zip)).toMatchObject({ ok: false, reason: "malformed" })
  })

  it("rejects a central directory whose records lack the signature", () => {
    const zip = buildZip([{ name: "a.xml", uncompressedSize: 10 }])
    const eocd = zip.length - 22
    const directoryOffset =
      zip[eocd + 16] | (zip[eocd + 17] << 8) | (zip[eocd + 18] << 16) | (zip[eocd + 19] << 24)
    zip.set([0, 0, 0, 0], directoryOffset)

    expect(checkZipSanity(zip)).toMatchObject({ ok: false, reason: "malformed" })
  })

  it("finds the EOCD behind an archive comment", () => {
    const zip = buildZip([{ name: "a.xml", uncompressedSize: 10 }], "x".repeat(300))

    expect(checkZipSanity(zip)).toMatchObject({ ok: true, entries: 1 })
  })
})

describe("sanitizeUploadTitle", () => {
  it("strips only the last extension", () => {
    expect(sanitizeUploadTitle("Ada Lovelace Resume.pdf")).toBe("Ada Lovelace Resume")
    expect(sanitizeUploadTitle("resume.v2.final.docx")).toBe("resume.v2.final")
  })

  it("removes control characters and collapses whitespace", () => {
    expect(sanitizeUploadTitle("a\u0000b\u001fc\u007fd.pdf")).toBe("a b c d")
    expect(sanitizeUploadTitle("  spaced   out  .pdf")).toBe("spaced out")
    expect(sanitizeUploadTitle("line\nbreak.pdf")).toBe("line break")
  })

  it("caps the length at 120 characters", () => {
    const result = sanitizeUploadTitle(`${"a".repeat(300)}.pdf`)
    expect(result).toHaveLength(120)
  })

  it("returns an empty string for a dotfile or an empty name", () => {
    expect(sanitizeUploadTitle(".pdf")).toBe("")
    expect(sanitizeUploadTitle("")).toBe("")
    expect(sanitizeUploadTitle("   .pdf")).toBe("")
    expect(sanitizeUploadTitle("\u0000\u0001.pdf")).toBe("")
  })
})
