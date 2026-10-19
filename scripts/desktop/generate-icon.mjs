#!/usr/bin/env node
/**
 * Generates `desktop/src-tauri/icons/icon.ico` without image dependencies.
 *
 * Tauri's Windows build script requires an .ico. The mark is intentionally
 * simple: a brand-purple rounded square with a white R, matching the app's
 * existing dark/purple visual language. Replace it with a designed asset when
 * the product has one; the desktop build only needs a valid ICO.
 */

import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const output = path.resolve(here, "..", "..", "desktop", "src-tauri", "icons", "icon.ico")
const SIZE = 32

const pixels = Buffer.alloc(SIZE * SIZE * 4)

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const index = (y * SIZE + x) * 4
  pixels[index] = r
  pixels[index + 1] = g
  pixels[index + 2] = b
  pixels[index + 3] = a
}

function fillRect(x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) set(x, y, ...color)
  }
}

// Rounded brand tile.
for (let y = 2; y <= 29; y += 1) {
  for (let x = 2; x <= 29; x += 1) {
    const dx = Math.max(2 + 6 - x, 0, x - (29 - 6))
    const dy = Math.max(2 + 6 - y, 0, y - (29 - 6))
    if (dx * dx + dy * dy <= 6 * 6) set(x, y, 109, 40, 217)
  }
}

// White R.
const white = [245, 243, 255]
fillRect(10, 8, 13, 24, white) // stem
fillRect(10, 8, 21, 11, white) // top
fillRect(19, 8, 22, 16, white) // bowl right
fillRect(10, 14, 21, 17, white) // bowl bottom
fillRect(16, 17, 18, 24, white) // leg
fillRect(18, 18, 21, 24, white) // leg foot

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function png() {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  header[10] = 0
  header[11] = 0
  header[12] = 0

  const stride = SIZE * 4
  const raw = Buffer.alloc((stride + 1) * SIZE)
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

const image = png()
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)

const entry = Buffer.alloc(16)
entry[0] = SIZE
entry[1] = SIZE
entry[2] = 0
entry[3] = 0
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(image.length, 8)
entry.writeUInt32LE(22, 12)

mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, Buffer.concat([header, entry, image]))
console.log(`Wrote ${output} (${image.length} byte PNG payload)`)
