#!/usr/bin/env node
/**
 * Generates the desktop icon set and NSIS installer images from the supplied
 * RoleSpec OS brand kit.
 *
 * The app mark is the filled geometric monogram from
 * public/brand/rolespec-icon-brand.svg, and the installer lockup uses the
 * official wordmark (public/brand/rolespec-wordmark-dark.svg). Both are vector
 * and stay crisp at 16px in the taskbar. Colourways (ink, ice, mono and
 * on-dark) live alongside the primary icon in public/brand/. Run with:
 * npm run desktop:icons
 *
 * Outputs (desktop/src-tauri/icons/):
 *   icon.svg     - vector source of the primary brand mark
 *   icon.png     - 512px master raster (transparent outside the squircle)
 *   icon.ico     - 9-size ICO (16/20/24/32/40/48/64/128/256, PNG-compressed)
 *   icon.icns    - macOS app icon (16-1024 incl. Retina variants)
 *   sidebar.bmp  - 164x314 installer welcome/finish image
 *   header.bmp   - 150x57 installer page header image (also used for uninstall)
 *
 * Rendering uses the playwright DevDependency (headless Chromium), so no extra
 * tooling or downloads are required.
 */

import { readFileSync } from "node:fs"
import { readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { inflateSync } from "node:zlib"
import { chromium } from "playwright"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..", "..")
const iconsDir = path.join(repoRoot, "desktop", "src-tauri", "icons")
const wordmarkDark = readFileSync(
  path.join(repoRoot, "public", "brand", "rolespec-wordmark-dark.svg"),
  "utf8"
)
const WORDMARK_DARK_URI = `data:image/svg+xml;base64,${Buffer.from(wordmarkDark).toString("base64")}`

// ---------------------------------------------------------------------------
// The mark
// ---------------------------------------------------------------------------

// 64-unit geometry supplied in the brand kit. Keep it identical to
// public/brand/rolespec-icon-*.svg and
// src/features/marketing/components/logo-mark.tsx.
const MARK = "M14 13H35L47 25V31L36 42H25V52H14Z M25 23V32H32L36 28L31 23Z"
const ACCENT = "M31 45H43L51 53H39Z"
const FONT = "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif"

const BRAND = {
  blue: "#1447E6",
  ice: "#8EC5FF",
  ink: "#101828",
  white: "#FFFFFF",
}

/** The primary app tile at any position/size, for composing installer art. */
function iconAt(x, y, box) {
  return `<svg x="${x}" y="${y}" width="${box}" height="${box}" viewBox="0 0 64 64">
    <rect x="1" y="1" width="62" height="62" rx="15" fill="${BRAND.blue}"/>
    <path fill="${BRAND.white}" fill-rule="evenodd" d="${MARK}"/>
    <path fill="${BRAND.ice}" d="${ACCENT}"/>
  </svg>`
}

function iconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title id="title">RoleSpec OS app icon</title>
  <rect x="1" y="1" width="62" height="62" rx="15" fill="${BRAND.blue}"/>
  <path fill="${BRAND.white}" fill-rule="evenodd" d="${MARK}"/>
  <path fill="${BRAND.ice}" d="${ACCENT}"/>
</svg>`
}

const BACKGROUND_DEFS = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${BRAND.ink}"/>
    <stop offset="0.58" stop-color="#0B1220"/>
    <stop offset="1" stop-color="#111C33"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.16" cy="0.06" r="0.85">
    <stop offset="0" stop-color="${BRAND.blue}" stop-opacity="0.32"/>
    <stop offset="1" stop-color="${BRAND.blue}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${BRAND.ice}" stop-opacity="0.62"/>
    <stop offset="1" stop-color="${BRAND.ice}" stop-opacity="0"/>
  </linearGradient>
</defs>`

function sidebarSvg(width, height) {
  const features = [
    "Local-first workspace",
    "No account required",
    "Your data stays on-device",
  ]
  const featureRows = features
    .map((label, index) => {
      const y = 188 + index * 23
      return `<g>
    <circle cx="27" cy="${y}" r="5" fill="${BRAND.blue}"/>
    <path d="M24.6 ${y}.2l1.6 1.7 3-3.2" fill="none" stroke="${BRAND.white}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="38" y="${y + 3.2}" font-family="${FONT}" font-size="8.8" fill="#C9D8EF">${label}</text>
  </g>`
    })
    .join("\n  ")

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${BACKGROUND_DEFS}
  <defs>
    <pattern id="grid" width="12" height="12" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.55" fill="${BRAND.white}" fill-opacity="0.05"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>

  ${iconAt(22, 20, 72)}
  <svg x="22" y="102" width="120" height="39" viewBox="74 0 197 64" overflow="hidden">
    <image href="${WORDMARK_DARK_URI}" x="0" y="0" width="271" height="64"/>
  </svg>
  <text x="23" y="157" font-family="${FONT}" font-size="8.4" fill="#93A4C4">The job-search OS</text>
  <rect x="22" y="169" width="120" height="1" fill="url(#rule)"/>

  ${featureRows}

  <rect x="22" y="260" width="120" height="1" fill="${BRAND.white}" fill-opacity="0.08"/>
  <text x="22" y="279" font-family="${FONT}" font-size="7.6" letter-spacing="0.15" fill="#7E94B8">rolespec.ry0x7.dev</text>
  <text x="22" y="292" font-family="${FONT}" font-size="6.3" letter-spacing="0.9" fill="#4E6488">PRIVATE BY DEFAULT</text>
</svg>`
}

function headerSvg(width, height) {
  const logoWidth = 132
  const logoHeight = (logoWidth * 64) / 271
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${BACKGROUND_DEFS}
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <image href="${WORDMARK_DARK_URI}" x="9" y="${((height - logoHeight) / 2).toFixed(2)}" width="${logoWidth}" height="${logoHeight.toFixed(2)}" preserveAspectRatio="xMinYMid meet"/>
  <rect y="${height - 3}" width="${width}" height="3" fill="url(#rule)"/>
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
 *  flattened onto the ink base because NSIS ignores BMP alpha. */
function encodeBmp(width, height, rgba) {
  const stride = width * 4
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * stride // BMPs are bottom-up
    for (let x = 0; x < width; x++) {
      const s = src + x * 4
      const d = y * stride + x * 4
      const a = rgba[s + 3] / 255
      pixels[d] = Math.round(rgba[s + 2] * a + 0x28 * (1 - a)) // B
      pixels[d + 1] = Math.round(rgba[s + 1] * a + 0x18 * (1 - a)) // G
      pixels[d + 2] = Math.round(rgba[s] * a + 0x10 * (1 - a)) // R
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

/** Wrap PNG frames into an Apple icon archive (PNG-based element types). */
function encodeIcns(pngBySize) {
  const header = Buffer.alloc(8)
  header.write("icns", 0, "ascii")
  const elements = []
  for (const [type, size] of ICNS_TYPES) {
    const data = pngBySize.get(size)
    if (!data) throw new Error(`No ${size}px frame for ICNS ${type}`)
    const element = Buffer.alloc(8)
    element.write(type, 0, "ascii")
    element.writeUInt32BE(8 + data.length, 4)
    elements.push(element, data)
  }
  const total = 8 + elements.reduce((sum, part) => sum + part.length, 0)
  header.writeUInt32BE(total, 4)
  return Buffer.concat([header, ...elements])
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

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
// Apple element types: 1x sizes plus the @2x slots macOS actually asks for.
const ICNS_TYPES = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
]
const ICNS_SIZES = [...new Set(ICNS_TYPES.map(([, size]) => size))]

async function main() {
  await writeFile(path.join(iconsDir, "icon.svg"), iconSvg())

  const masterPng = path.join(iconsDir, "icon.png")
  const tmp = (name) => path.join(iconsDir, `_tmp_${name}`)

  const { browser, page } = await openRenderer()
  try {
    await shot(page, iconSvg(), 512, 512, masterPng)

    // Render each distinct pixel size once; the ICO and ICNS share the frames.
    const pngBySize = new Map()
    for (const size of [...new Set([...ICO_SIZES, ...ICNS_SIZES])]) {
      const target = tmp(`${size}.png`)
      await shot(page, iconSvg(), size, size, target)
      pngBySize.set(size, await readFile(target))
    }
    const frames = ICO_SIZES.map((size) => ({ size, data: pngBySize.get(size) }))

    const sidebarPng = tmp("sidebar.png")
    const headerPng = tmp("header.png")
    await shot(page, sidebarSvg(164, 314), 164, 314, sidebarPng)
    await shot(page, headerSvg(150, 57), 150, 57, headerPng)

    await writeFile(path.join(iconsDir, "icon.ico"), encodeIco(frames))
    await writeFile(path.join(iconsDir, "icon.icns"), encodeIcns(pngBySize))
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
      [
        ...[...new Set([...ICO_SIZES, ...ICNS_SIZES])].map((s) => tmp(`${s}.png`)),
        tmp("sidebar.png"),
        tmp("header.png"),
      ].map((target) => unlink(target)),
    )
  }

  console.log(`Icons written to ${iconsDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
