#!/usr/bin/env node
/**
 * Generates the desktop icon set and NSIS installer images.
 *
 * The single source of truth is the SVG built below: the product's hand-drawn
 * "R" monogram (the same stroke geometry as the in-app LogoMark) in white on a
 * vivid brand-blue squircle. The mark is stroke-based rather than pixel-block,
 * so it stays crisp at 16px in the taskbar and matches the app's Apple-blue
 * design system instead of the retired purple pixel-art banner. Run with:
 * npm run desktop:icons
 *
 * Outputs (desktop/src-tauri/icons/):
 *   icon.svg     - vector source of the mark
 *   icon.png     - 512px master raster (transparent outside the squircle)
 *   icon.ico     - 9-size ICO (16/20/24/32/40/48/64/128/256, PNG-compressed)
 *   icon.icns    - macOS app icon (16-1024 incl. Retina variants)
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

// 24x24 stroke geometry shared with src/features/marketing/components/logo-mark.tsx.
// Keeping one geometry means the taskbar icon, installer art and in-app sidebar
// logo all show the same hand-drawn "R".
const MARK_PATHS = [
  "M7 19.5v-15h5.5a3.75 3.75 0 0 1 0 7.5H7",
  "M12.5 12 17.5 19.5",
]
const MARK_STROKE = 2.7
const FONT = "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif"

const BRAND = {
  top: "#4F9BFF",
  mid: "#1447E6",
  bottom: "#193CB8",
  deep: "#162456",
  ink: "#FFFFFF",
}

function markPaths() {
  return MARK_PATHS.map((d) => `<path d="${d}"/>`).join("")
}

/** Mark geometry on its own 24-unit grid, for composing into a larger SVG. */
function markAt(x, y, box) {
  return `<svg x="${x}" y="${y}" width="${box}" height="${box}" viewBox="0 0 24 24" fill="none" stroke="${BRAND.ink}" stroke-width="${MARK_STROKE}" stroke-linecap="round" stroke-linejoin="round">
    <g transform="translate(-0.12 0)">${markPaths()}</g>
  </svg>`
}

const GRADIENT_DEFS = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0.55" y2="1">
    <stop offset="0" stop-color="${BRAND.top}"/>
    <stop offset="0.55" stop-color="${BRAND.mid}"/>
    <stop offset="1" stop-color="${BRAND.bottom}"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.22" cy="0.08" r="0.85">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.24"/>
    <stop offset="0.6" stop-color="#FFFFFF" stop-opacity="0.05"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
  </radialGradient>
</defs>`

function iconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  ${GRADIENT_DEFS}
  <rect width="${size}" height="${size}" rx="${(size * 0.2225).toFixed(2)}" fill="url(#bg)"/>
  <rect width="${size}" height="${size}" rx="${(size * 0.2225).toFixed(2)}" fill="url(#glow)"/>
  <rect x="${(size * 0.006).toFixed(2)}" y="${(size * 0.006).toFixed(2)}" width="${(size * 0.988).toFixed(2)}" height="${(size * 0.988).toFixed(2)}" rx="${(size * 0.219).toFixed(2)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="${(size * 0.0055).toFixed(2)}"/>
  ${markAt(0, 0, size)}
</svg>`
}

function sidebarSvg(width, height) {
  const markBox = width * 0.58
  const markX = (width - markBox) / 2
  const markY = height * 0.085
  const markCenter = markY + markBox / 2
  const nameY = height * 0.55
  const features = [
    "Local-first workspace",
    "No account required",
    "Your data stays on-device",
  ]
  const featureRows = features
    .map((label, index) => {
      const y = nameY + 44 + index * 15
      return `<g>
    <circle cx="${(width / 2 - 46).toFixed(1)}" cy="${(y - 2.2).toFixed(1)}" r="1.6" fill="rgba(255,255,255,0.7)"/>
    <text x="${(width / 2 - 38).toFixed(1)}" y="${y.toFixed(1)}" fill="rgba(255,255,255,0.86)" font-family="${FONT}" font-size="7.4">${label}</text>
  </g>`
    })
    .join("\n  ")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${GRADIENT_DEFS}
  <defs>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <g opacity="0.06" fill="none" stroke="#FFFFFF" stroke-width="${MARK_STROKE}" stroke-linecap="round" stroke-linejoin="round">
    <svg x="${(width * 0.34).toFixed(1)}" y="${(height * 0.6).toFixed(1)}" width="${(width * 1.15).toFixed(1)}" height="${(width * 1.15).toFixed(1)}" viewBox="0 0 24 24">${markPaths()}</svg>
  </g>
  <circle cx="${width / 2}" cy="${markCenter.toFixed(1)}" r="${(markBox * 0.72).toFixed(1)}" fill="url(#halo)"/>
  ${markAt(markX.toFixed(1), markY.toFixed(1), markBox.toFixed(1))}
  <text x="${width / 2}" y="${nameY.toFixed(1)}" text-anchor="middle" fill="${BRAND.ink}" font-family="${FONT}" font-size="22" font-weight="600" letter-spacing="-0.4">RoleSpec</text>
  <text x="${width / 2}" y="${(nameY + 18).toFixed(1)}" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-family="${FONT}" font-size="9">The job-search operating system</text>
  ${featureRows}
  <rect x="${(width / 2 - 14).toFixed(1)}" y="${(height - 34).toFixed(1)}" width="28" height="1" fill="#FFFFFF" fill-opacity="0.25"/>
  <text x="${width / 2}" y="${(height - 16).toFixed(1)}" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-family="${FONT}" font-size="6.6" letter-spacing="0.4">rolespec.ry0x7.dev</text>
</svg>`
}

function headerSvg(width, height) {
  const markBox = height * 0.78
  const markX = width * 0.055
  const textX = markX + markBox + width * 0.035
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${GRADIENT_DEFS}
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  ${markAt(markX.toFixed(1), ((height - markBox) / 2).toFixed(1), markBox.toFixed(1))}
  <text x="${textX.toFixed(1)}" y="${(height * 0.62).toFixed(1)}" fill="${BRAND.ink}" font-family="${FONT}" font-size="${(height * 0.31).toFixed(1)}" font-weight="600" letter-spacing="-0.3">RoleSpec</text>
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
  await writeFile(path.join(iconsDir, "icon.svg"), iconSvg(512))

  const masterPng = path.join(iconsDir, "icon.png")
  const tmp = (name) => path.join(iconsDir, `_tmp_${name}`)

  const { browser, page } = await openRenderer()
  try {
    await shot(page, iconSvg(512), 512, 512, masterPng)

    // Render each distinct pixel size once; the ICO and ICNS share the frames.
    const pngBySize = new Map()
    for (const size of [...new Set([...ICO_SIZES, ...ICNS_SIZES])]) {
      const target = tmp(`${size}.png`)
      await shot(page, iconSvg(512), size, size, target)
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
