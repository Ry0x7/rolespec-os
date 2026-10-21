#!/usr/bin/env node
/**
 * Generates the desktop icon set and NSIS installer images.
 *
 * The single source of truth is the SVG built below: a pixel-block "R" on a
 * purple gradient squircle with an amber terminal-cursor block, matching the
 * project's pixel-art banner aesthetic. Run with: npm run desktop:icons
 *
 * Outputs (desktop/src-tauri/icons/):
 *   icon.svg     - vector source of the mark
 *   icon.png     - 512px master raster (transparent)
 *   icon.ico     - 7-size ICO (16/24/32/48/64/128/256, PNG-compressed)
 *   sidebar.bmp  - 164x314 installer welcome/finish image
 *   header.bmp   - 150x57 installer page header image (also used for uninstall)
 *
 * Rendering uses the playwright DevDependency (headless Chromium), so no extra
 * tooling or downloads are required.
 */

import { readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { inflateSync } from "node:zlib"
import { chromium } from "playwright"

const here = path.dirname(fileURLToPath(import.meta.url))
const iconsDir = path.resolve(here, "..", "..", "desktop", "src-tauri", "icons")

// ---------------------------------------------------------------------------
// The mark
// ---------------------------------------------------------------------------

const R_GRID = [
  ".XXXX.",
  "XX..XX",
  "XX..XX",
  "XXXXX.",
  "XX.X..",
  "XX..XX",
  "XX..XX",
]

const BRAND = {
  bgTop: "#8b5cf6",
  bgBottom: "#4c1d95",
  ink: "#f5f3ff",
  cursor: "#fcd34d",
  edge: "rgba(255,255,255,0.22)",
}

function markBody(size) {
  const cell = size * 0.098
  const gap = size * 0.02
  const columns = R_GRID[0].length
  const rows = R_GRID.length
  const gridW = columns * cell - gap
  const gridH = rows * cell - gap
  const x0 = (size - gridW) / 2
  const y0 = size * 0.14

  const blocks = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      if (R_GRID[r][c] !== "X") continue
      const x = x0 + c * (cell + gap)
      const y = y0 + r * (cell + gap)
      blocks.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="${(cell * 0.14).toFixed(2)}" fill="${BRAND.ink}"/>`,
      )
    }
  }
  const cursor = size * 0.06
  const cx = x0 + (columns - 1) * (cell + gap) + cell - cursor
  const cy = y0 + gridH + size * 0.03
  return `${blocks.join("\n  ")}
  <rect x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" width="${cursor.toFixed(2)}" height="${cursor.toFixed(2)}" rx="${(cursor * 0.18).toFixed(2)}" fill="${BRAND.cursor}"/>`
}

function iconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND.bgTop}"/>
      <stop offset="1" stop-color="${BRAND.bgBottom}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${(size * 0.225).toFixed(1)}" fill="url(#bg)"/>
  <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="${(size * 0.22).toFixed(1)}" fill="none" stroke="${BRAND.edge}" stroke-width="${(size * 0.008).toFixed(2)}"/>
  ${markBody(size)}
</svg>`
}

const GRADIENT_DEFS = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${BRAND.bgTop}"/>
    <stop offset="1" stop-color="${BRAND.bgBottom}"/>
  </linearGradient>
</defs>`

function sidebarSvg(width, height) {
  const markPx = width * 0.46
  const nameY = height * 0.56
  const markInner = markBody(512).replace(/\n/g, "\n      ")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${GRADIENT_DEFS}
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <g transform="translate(0, ${height * 0.12})">
    <svg x="${(width - markPx) / 2}" y="0" width="${markPx}" height="${markPx}" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="115" fill="${BRAND.bgBottom}" opacity="0.35"/>
      <rect x="4" y="4" width="504" height="504" rx="113" fill="none" stroke="${BRAND.edge}" stroke-width="4"/>
      ${markInner}
    </svg>
  </g>
  <text x="${width / 2}" y="${nameY}" text-anchor="middle" fill="${BRAND.ink}" font-family="Segoe UI, sans-serif" font-size="${width * 0.125}" font-weight="700">RoleSpec</text>
  <text x="${width / 2}" y="${nameY + width * 0.1}" text-anchor="middle" fill="rgba(237,233,254,0.9)" font-family="Segoe UI, sans-serif" font-size="${width * 0.055}">The job-search operating</text>
  <text x="${width / 2}" y="${nameY + width * 0.185}" text-anchor="middle" fill="rgba(237,233,254,0.9)" font-family="Segoe UI, sans-serif" font-size="${width * 0.055}">system — free &amp; private</text>
</svg>`
}

function headerSvg(width, height) {
  const markPx = height * 0.72
  const markX = width * 0.07
  const textX = markX + markPx + width * 0.045
  const markInner = markBody(512).replace(/\n/g, "\n      ")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${GRADIENT_DEFS}
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <g transform="translate(${markX}, ${(height - markPx) / 2})">
    <svg width="${markPx}" height="${markPx}" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="115" fill="${BRAND.bgBottom}" opacity="0.35"/>
      ${markInner}
    </svg>
  </g>
  <text x="${textX}" y="${height * 0.7}" fill="${BRAND.ink}" font-family="Segoe UI, sans-serif" font-size="${height * 0.34}" font-weight="700">RoleSpec</text>
</svg>`
}

// ---------------------------------------------------------------------------
// Rendering helpers (Chromium screenshot of an inline <img>)
// ---------------------------------------------------------------------------

const toDataUri = (svg) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`

async function openRenderer() {
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: 600, height: 600 },
    deviceScaleFactor: 1,
  })
  return { browser, page }
}

async function shot(page, svg, w, h, target) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;overflow:hidden;background:transparent}img{display:block}</style>` +
      `<img src="${toDataUri(svg)}" width="${w}" height="${h}">`,
  )
  await page.screenshot({ path: target, omitBackground: true })
}

// ---------------------------------------------------------------------------
// Minimal PNG decoder (handles our own output: 8-bit RGB or RGBA PNGs)
// ---------------------------------------------------------------------------

function decodePng(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (!buf.subarray(0, 8).equals(sig)) throw new Error("not a PNG")
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString("ascii", off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === "IDAT") {
      idat.push(data)
    } else if (type === "IEND") {
      break
    }
    off += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType}`)
  }
  const channels = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = channels
  const stride = width * 4
  const rawStride = width * channels
  const rawBuf = Buffer.alloc(rawStride)
  const out = Buffer.alloc(stride * height)
  const prev = Buffer.alloc(rawStride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const row = raw.subarray(pos, pos + rawStride)
    pos += rawStride
    const dst = y * stride
    rawBuf.set(prev.subarray(0, rawStride), 0)
    for (let i = 0; i < rawStride; i++) {
      const a = i >= bpp ? rawBuf[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = row[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      rawBuf[i] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = dst + x * 4
      out[d] = rawBuf[s]
      out[d + 1] = rawBuf[s + 1]
      out[d + 2] = rawBuf[s + 2]
      out[d + 3] = channels === 4 ? rawBuf[s + 3] : 0xff
    }
    prev.set(rawBuf.subarray(0, rawStride))
  }
  return { width, height, rgba: out }
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

/** Encode RGBA pixels as a 32bpp bottom-up BI_RGB BMP. Alpha (if any) is
 *  flattened onto the dark brand base because NSIS ignores BMP alpha. */
function encodeBmp(width, height, rgba) {
  const stride = width * 4
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * stride // BMPs are bottom-up
    for (let x = 0; x < width; x++) {
      const s = src + x * 4
      const d = y * stride + x * 4
      const a = rgba[s + 3] / 255
      pixels[d] = Math.round(rgba[s + 2] * a + 0x10 * (1 - a)) // B
      pixels[d + 1] = Math.round(rgba[s + 1] * a + 0x0e * (1 - a)) // G
      pixels[d + 2] = Math.round(rgba[s] * a + 0x1b * (1 - a)) // R
      pixels[d + 3] = 0xff
    }
  }
  const header = Buffer.alloc(54)
  header.write("BM", 0)
  header.writeUInt32LE(54 + pixels.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(width, 18)
  header.writeInt32LE(height, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(32, 28)
  header.writeUInt32LE(0, 30) // BI_RGB (uncompressed)
  header.writeUInt32LE(pixels.length, 34)
  return Buffer.concat([header, pixels])
}

/** Wrap PNG frames into a multi-size, PNG-compressed ICO. */
function encodeIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(frames.length, 4)
  const dirs = []
  const blobs = []
  let offset = 6 + 16 * frames.length
  for (const { size, data } of frames) {
    const d = Buffer.alloc(16)
    d[0] = size >= 256 ? 0 : size // width (0 = 256)
    d[1] = size >= 256 ? 0 : size // height
    d[2] = 0 // palette
    d[3] = 0 // reserved
    d.writeUInt16LE(1, 4) // color planes
    d.writeUInt16LE(32, 6) // bits per pixel
    d.writeUInt32LE(data.length, 8)
    d.writeUInt32LE(offset, 12)
    dirs.push(d)
    blobs.push(data)
    offset += data.length
  }
  return Buffer.concat([header, ...dirs, ...blobs])
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

async function main() {
  await writeFile(path.join(iconsDir, "icon.svg"), iconSvg(512))

  const masterPng = path.join(iconsDir, "icon.png")
  const tmp = (name) => path.join(iconsDir, `_tmp_${name}`)

  const { browser, page } = await openRenderer()
  try {
    await shot(page, iconSvg(512), 512, 512, masterPng)
    const frames = []
    for (const size of ICO_SIZES) {
      const target = tmp(`${size}.png`)
      await shot(page, iconSvg(512), size, size, target)
      frames.push({ size, data: await readFile(target) })
    }

    const sidebarPng = tmp("sidebar.png")
    const headerPng = tmp("header.png")
    await shot(page, sidebarSvg(164, 314), 164, 314, sidebarPng)
    await shot(page, headerSvg(150, 57), 150, 57, headerPng)

    await writeFile(path.join(iconsDir, "icon.ico"), encodeIco(frames))
    for (const [name, target, w, h] of [
      ["sidebar.bmp", sidebarPng, 164, 314],
      ["header.bmp", headerPng, 150, 57],
    ]) {
      const png = decodePng(await readFile(target))
      if (png.width !== w || png.height !== h) {
        throw new Error(`${name}: got ${png.width}x${png.height}, expected ${w}x${h}`)
      }
      await writeFile(path.join(iconsDir, name), encodeBmp(w, h, png.rgba))
    }
  } finally {
    await browser.close()
    await Promise.allSettled(
      [...ICO_SIZES.map((s) => tmp(`${s}.png`)), tmp("sidebar.png"), tmp("header.png")].map(
        (target) => unlink(target),
      ),
    )
  }

  console.log(`Icons written to ${iconsDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
