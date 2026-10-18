import fs from "node:fs"
import path from "node:path"
import { chromium } from "playwright"

const WIDTH = 1200
const HEIGHT = 400

// 600x200 canvas rendered at 1200x400 (exact 2x pixel scale)
function generatePixelArtSvg(): string {
  const rect = (x: number, y: number, w: number, h: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" />`

  const pixel = (x: number, y: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}" />`

  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" width="${WIDTH}" height="${HEIGHT}" shape-rendering="crispEdges" style="background:#07080e; image-rendering:pixelated;">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&amp;family=JetBrains+Mono:wght@700&amp;display=swap');
      .pixel-title { font-family: 'Press Start 2P', monospace; font-size: 19px; fill: #ffffff; }
      .pixel-sub { font-family: 'Press Start 2P', monospace; font-size: 7.5px; fill: #38bdf8; letter-spacing: 0.5px; }
      .pixel-desc { font-family: 'Press Start 2P', monospace; font-size: 6px; fill: #94a3b8; letter-spacing: 0.2px; }
      .pixel-tag { font-family: 'Press Start 2P', monospace; font-size: 6px; font-weight: bold; }
      .pixel-cli { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; font-weight: 700; fill: #64748b; }
    </style>
  </defs>

  <!-- 1. NIGHT SKY & CYBER DITHERING (600x200) -->
  <rect x="0" y="0" width="600" height="200" fill="#07080e" />
  <rect x="0" y="145" width="600" height="55" fill="#0b0d16" />
`

  // Background pixel grid
  for (let x = 0; x < 600; x += 16) {
    out += rect(x, 0, 1, 145, "#101424")
  }
  for (let y = 0; y < 145; y += 16) {
    out += rect(0, y, 600, 1, "#101424")
  }

  // Pixel Stars
  const stars = [
    [12, 18], [42, 10], [78, 40], [115, 15], [145, 68], [185, 28], [225, 12],
    [265, 52], [305, 18], [335, 42], [375, 12], [415, 58], [455, 22], [505, 35],
    [535, 15], [570, 48], [32, 88], [90, 102], [168, 98], [520, 80], [555, 105]
  ]
  for (const [sx, sy] of stars) {
    out += rect(sx, sy, 2, 2, "#4f46e5")
    out += pixel(sx, sy, "#a5b4fc")
    out += pixel(sx + 1, sy + 1, "#ffffff")
  }

  // Cross Stars
  const crossStars = [[55, 30], [195, 65], [480, 45], [545, 25]]
  for (const [bx, by] of crossStars) {
    out += rect(bx - 2, by, 5, 1, "#00f0ff")
    out += rect(bx, by - 2, 1, 5, "#00f0ff")
    out += pixel(bx, by, "#ffffff")
  }

  // Distant City Skyline Silhouettes
  const buildings = [
    [8, 120, 16, 25], [28, 110, 14, 35], [46, 124, 20, 21], [70, 102, 16, 43],
    [90, 114, 18, 31], [112, 126, 14, 19], [130, 108, 22, 37], [156, 118, 16, 27],
    [460, 124, 18, 21], [482, 110, 16, 35], [502, 116, 20, 29], [526, 102, 18, 43],
    [548, 122, 22, 23], [574, 112, 16, 33]
  ]
  for (const [bx, by, bw, bh] of buildings) {
    out += rect(bx, by, bw, bh, "#121524")
    for (let wy = by + 4; wy < by + bh - 4; wy += 5) {
      for (let wx = bx + 3; wx < bx + bw - 3; wx += 4) {
        if ((wx + wy) % 3 === 0) {
          out += rect(wx, wy, 2, 2, (wx + wy) % 5 === 0 ? "#00ffcc" : "#f59e0b")
        }
      }
    }
  }

  // 2. RETRO 2D PIXEL WORKSTATION (Left: x: 15 to 195, y: 75 to 180)
  // Desk Surface
  out += rect(15, 152, 175, 4, "#38231c")
  out += rect(15, 156, 175, 2, "#201410")
  out += rect(24, 158, 6, 32, "#180f0c")
  out += rect(175, 158, 6, 32, "#180f0c")

  // MAIN CRT MONITOR (x=58, y=78, w=76, h=60)
  // Outer Bezel
  out += rect(56, 78, 80, 60, "#2b303c")
  out += rect(58, 80, 76, 56, "#373e4d")
  out += rect(60, 82, 72, 52, "#181a20")
  // Screen Inner
  out += rect(62, 84, 68, 48, "#09121a")

  // Screen Titlebar
  out += rect(64, 86, 64, 4, "#0d2232")
  out += rect(66, 87, 2, 2, "#ef4444")
  out += rect(70, 87, 2, 2, "#f59e0b")
  out += rect(74, 87, 2, 2, "#10b981")

  // Screen Code & Graphs
  out += rect(66, 94, 22, 2, "#10b981")
  out += rect(66, 98, 34, 2, "#38bdf8")
  out += rect(66, 102, 28, 2, "#fbbf24")
  out += rect(66, 106, 38, 2, "#c084fc")

  // Mini ATS Match Radar on Screen
  out += rect(108, 94, 16, 16, "#0e2636")
  out += rect(110, 96, 12, 12, "#081620")
  out += pixel(116, 98, "#00ffcc")
  out += pixel(113, 102, "#00ffcc")
  out += pixel(119, 102, "#00ffcc")
  out += pixel(116, 105, "#00ffcc")
  out += rect(115, 101, 3, 3, "#10b981")

  // Score Badge: "94"
  out += rect(66, 114, 24, 11, "#064e3b")
  out += rect(67, 115, 22, 9, "#047857")
  out += rect(69, 117, 3, 3, "#34d399")
  out += rect(75, 117, 8, 2, "#34d399")
  out += rect(78, 119, 5, 2, "#34d399")

  // Blinking cursor
  out += rect(96, 122, 4, 4, "#10b981")

  // Scanlines
  for (let sy = 84; sy < 132; sy += 3) {
    out += rect(62, sy, 68, 1, "rgba(0,0,0,0.35)")
  }

  // Monitor Stand
  out += rect(91, 138, 10, 8, "#2b303c")
  out += rect(85, 146, 22, 6, "#373e4d")

  // SECONDARY VERTICAL MONITOR (x=24, y=85, w=26, h=52)
  out += rect(24, 85, 26, 52, "#2b303c")
  out += rect(26, 87, 22, 48, "#181a20")
  out += rect(27, 89, 20, 44, "#0b1118")
  for (let cy = 92; cy < 129; cy += 4) {
    const clen = 6 + ((cy * 5) % 11)
    const color = cy % 8 === 0 ? "#c084fc" : (cy % 6 === 0 ? "#10b981" : "#38bdf8")
    out += rect(29, cy, clen, 2, color)
  }
  out += rect(33, 137, 8, 9, "#2b303c")
  out += rect(29, 146, 16, 6, "#373e4d")

  // Keyboard
  out += rect(70, 148, 44, 4, "#cbd5e1")
  out += rect(68, 149, 48, 2, "#475569")
  for (let kx = 72; kx < 112; kx += 4) {
    out += pixel(kx, 148, "#334155")
  }
  // Mouse
  out += rect(122, 148, 12, 4, "#334155")
  out += rect(125, 147, 6, 4, "#f1f5f9")

  // Coffee Mug
  out += rect(144, 143, 9, 9, "#f1f5f9")
  out += rect(145, 144, 7, 2, "#451a03")
  out += rect(153, 145, 3, 5, "#f1f5f9")
  out += pixel(147, 139, "#a5b4fc")
  out += pixel(148, 137, "#c7d2fe")
  out += pixel(150, 135, "#ffffff")

  // Potted Succulent
  out += rect(162, 144, 8, 8, "#d97706")
  out += rect(161, 143, 10, 2, "#b45309")
  out += rect(163, 139, 3, 4, "#10b981")
  out += rect(166, 137, 4, 6, "#059669")
  out += rect(169, 140, 3, 3, "#34d399")
  out += pixel(167, 135, "#6ee7b7")

  // 3. RETRO PIXEL TERMINAL WINDOW (Right: x: 205 to 585, y: 16 to 184)
  // Spacious window: width = 380, height = 168
  out += rect(205, 16, 380, 168, "#0c0f17")
  out += rect(207, 18, 376, 164, "#111622")

  // Titlebar: height 16 (y: 18 to 34)
  out += rect(207, 18, 376, 16, "#1a2234")
  out += rect(213, 23, 6, 6, "#ef4444")
  out += rect(222, 23, 6, 6, "#f59e0b")
  out += rect(231, 23, 6, 6, "#10b981")
  out += `<text x="245" y="28" font-family="'Press Start 2P', monospace" font-size="6" fill="#64748b">ROLESPEC OS // KERNEL v1.0.0</text>`

  // Inner Screen Body: y: 34 to 182
  out += rect(212, 38, 366, 140, "#080a10")
  out += rect(212, 38, 366, 1, "#1e293b")

  // LINE 1: ROLESPEC OS (Title) at y=64 (ample headroom!)
  out += `<text x="226" y="66" class="pixel-title" fill="#000000">ROLESPEC OS</text>`
  out += `<text x="225" y="65" class="pixel-title" fill="#7c3aed">ROLESPEC OS</text>`
  out += `<text x="224" y="64" class="pixel-title" fill="#ffffff">ROLESPEC OS</text>`

  // LINE 2: Neon Pixel Divider at y=74
  out += rect(224, 74, 342, 2, "#4c1d95")
  out += rect(224, 74, 120, 2, "#00ffcc")
  out += rect(344, 74, 80, 2, "#38bdf8")

  // LINE 3: Subtitle at y=92 (18px below divider!)
  out += `<text x="224" y="92" class="pixel-sub" fill="#38bdf8">AUTONOMOUS JOB-SEEKING AI OS</text>`

  // LINE 4: Description at y=109 (17px below subtitle!)
  out += `<text x="224" y="109" class="pixel-desc" fill="#94a3b8">Tailor Resumes • Radar Discovery • Kanban</text>`

  // LINE 5: Badges at y=122 (13px below description!)
  // Badge 1: AGPL-3.0 (w=90, h=16) -> x=224 to 314
  out += rect(224, 122, 90, 16, "#064e3b")
  out += rect(225, 123, 88, 14, "#022c22")
  out += rect(224, 122, 90, 1, "#10b981")
  out += `<text x="234" y="133" class="pixel-tag" fill="#34d399">◆ AGPL-3.0</text>`

  // Badge 2: ZERO-API CLI (w=112, h=16) -> x=322 to 434
  out += rect(322, 122, 112, 16, "#1e1b4b")
  out += rect(323, 123, 110, 14, "#0f172a")
  out += rect(322, 122, 112, 1, "#6366f1")
  out += `<text x="330" y="133" class="pixel-tag" fill="#818cf8">⚡ ZERO-API CLI</text>`

  // Badge 3: 100% PRIVATE (w=112, h=16) -> x=442 to 554
  out += rect(442, 122, 112, 16, "#581c87")
  out += rect(443, 123, 110, 14, "#2e1065")
  out += rect(442, 122, 112, 1, "#a855f7")
  out += `<text x="450" y="133" class="pixel-tag" fill="#c084fc">★ 100% PRIVATE</text>`

  // LINE 6: Terminal command prompt at y=158 (20px below badges!)
  out += rect(224, 150, 4, 10, "#10b981")
  out += `<text x="234" y="158" class="pixel-cli">guest@rolespec:~$ codex login &amp;&amp; npm run dev</text>`
  out += rect(542, 150, 5, 10, "#00ffcc") // blinking prompt cursor

  // 4. RETRO CORNER BRACKETS & OUTER PIXEL BORDER
  out += rect(4, 4, 592, 2, "#1e293b")
  out += rect(4, 194, 592, 2, "#1e293b")
  out += rect(4, 4, 2, 192, "#1e293b")
  out += rect(594, 4, 2, 192, "#1e293b")

  const corners = [[4, 4], [586, 4], [4, 186], [586, 186]]
  for (const [cx, cy] of corners) {
    out += rect(cx, cy, 10, 10, "#4338ca")
    out += rect(cx + 2, cy + 2, 6, 6, "#06b6d4")
    out += rect(cx + 4, cy + 4, 2, 2, "#ffffff")
  }

  out += `</svg>`
  return out
}

async function main() {
  const svgContent = generatePixelArtSvg()
  const svgPath = path.join(process.cwd(), "screenshots", "banner.svg")
  const pngPath = path.join(process.cwd(), "screenshots", "banner.png")

  fs.writeFileSync(svgPath, svgContent, "utf-8")
  console.log(`Saved pixel SVG to ${svgPath}`)

  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
  })

  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { background: #07080e; display: flex; align-items: center; justify-content: center; width: 100vw; height: 100vh; overflow: hidden; }
          svg { width: 1200px; height: 400px; image-rendering: pixelated; shape-rendering: crispEdges; }
        </style>
      </head>
      <body>
        ${svgContent}
      </body>
    </html>
  `, { waitUntil: "networkidle" })

  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(800)

  await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
  console.log(`Saved pixel PNG to ${pngPath}`)

  await browser.close()
  console.log("2D Pixel Art Banner regenerated successfully!")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
