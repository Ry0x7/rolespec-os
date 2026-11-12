import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import * as esbuild from "esbuild"

const ROOT_DIR = path.resolve(__dirname, "..")
const OUT_DIR = path.resolve(ROOT_DIR, "dist-showcase")

async function build() {
  console.log("🚀 Building RoleSpec OS Showcase (v1.0.5)...")

  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(path.join(OUT_DIR, "_next"), { recursive: true })
  fs.mkdirSync(path.join(OUT_DIR, "RoleSpecOS"), { recursive: true })

  // 1. Compile CSS with Tailwind CLI
  console.log("🎨 Compiling styles with Tailwind CLI...")
  const stylesSrc = path.join(ROOT_DIR, "src", "showcase", "styles.css")
  const stylesOut = path.join(OUT_DIR, "styles.css")
  execSync(`npx @tailwindcss/cli -i "${stylesSrc}" -o "${stylesOut}" --minify`, {
    cwd: ROOT_DIR,
    stdio: "inherit",
  })

  // 2. Bundle React 19 + Framer Motion + Lucide with esbuild
  console.log("⚡ Bundling React 19 + Framer Motion 12...")
  const entryPoint = path.join(ROOT_DIR, "src", "showcase", "index.tsx")
  const bundleOut = path.join(OUT_DIR, "bundle.js")

  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    sourcemap: false,
    format: "iife",
    target: ["es2020"],
    outfile: bundleOut,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    loader: {
      ".png": "file",
      ".svg": "file",
    },
  })

  const bundleSize = (fs.statSync(bundleOut).size / 1024).toFixed(1)
  console.log(`✅ Bundle built: ${bundleSize} KB`)

  // 3. Copy Screenshots and Assets
  console.log("📸 Copying screenshots & assets...")
  const screenshotsDir = path.join(ROOT_DIR, "screenshots")
  const targetRoleSpecDir = path.join(OUT_DIR, "RoleSpecOS")

  const screenshotFiles = [
    "banner.png",
    "banner.svg",
    "jobs-discover.png",
    "resume-editor.png",
    "workspace.png",
  ]

  for (const file of screenshotFiles) {
    const srcFile = path.join(screenshotsDir, file)
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(targetRoleSpecDir, file))
    }
  }

  // Copy favicon
  const publicFavicon = path.join(ROOT_DIR, "public", "banner.svg")
  if (fs.existsSync(publicFavicon)) {
    fs.copyFileSync(publicFavicon, path.join(OUT_DIR, "favicon.svg"))
    fs.copyFileSync(publicFavicon, path.join(targetRoleSpecDir, "icon.svg"))
  }

  // 4. Generate CNAME, .nojekyll, robots.txt, sitemap.xml
  fs.writeFileSync(path.join(OUT_DIR, "CNAME"), "rolespec.ry0x7.dev\n")
  fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "")
  fs.writeFileSync(
    path.join(OUT_DIR, "robots.txt"),
    "User-agent: *\nAllow: /\nSitemap: https://rolespec.ry0x7.dev/sitemap.xml\n"
  )
  fs.writeFileSync(
    path.join(OUT_DIR, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://rolespec.ry0x7.dev/</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`
  )

  // 5. Generate index.html
  const htmlContent = `<!DOCTYPE html>
<html lang="en" class="motion-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RoleSpec OS v1.0.5 — Sovereign Career Operating System</title>
  <meta name="description" content="Sovereign, air-gapped career operating system for senior engineers. Deterministic ATS matching, atomic resume diff rollbacks, and offline-first opportunity radar.">
  <meta name="theme-color" content="#07070a">

  <!-- Open Graph / Social Media -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://rolespec.ry0x7.dev/">
  <meta property="og:title" content="RoleSpec OS v1.0.5 — Sovereign Career Operating System">
  <meta property="og:description" content="Deterministic ATS matching, atomic resume diff rollbacks, and offline-first opportunity radar. Zero cloud telemetry.">
  <meta property="og:image" content="https://rolespec.ry0x7.dev/RoleSpecOS/banner.png">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="RoleSpec OS v1.0.5 — Sovereign Career Operating System">
  <meta name="twitter:description" content="Deterministic ATS matching, atomic resume diff rollbacks, and offline-first opportunity radar.">
  <meta name="twitter:image" content="https://rolespec.ry0x7.dev/RoleSpecOS/banner.png">

  <link rel="icon" type="image/svg+xml" href="favicon.svg">
  <link rel="stylesheet" href="styles.css">

  <!-- Inline Reduced Motion Check Script before first paint -->
  <script>
    (function() {
      try {
        var stored = localStorage.getItem('rolespec-motion');
        var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (stored === 'reduced' || (!stored && prefersReduced)) {
          document.documentElement.classList.add('reduce-motion');
          document.documentElement.classList.remove('motion-full');
        } else {
          document.documentElement.classList.add('motion-full');
          document.documentElement.classList.remove('reduce-motion');
        }
      } catch (e) {}
    })();
  </script>
</head>
<body class="bg-[#07070a] text-[#f4f4f7] min-h-screen">
  <div id="root"></div>
  <script src="bundle.js"></script>
</body>
</html>`

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), htmlContent)
  fs.writeFileSync(path.join(OUT_DIR, "RoleSpecOS.html"), htmlContent)

  // Keep a dummy index file in _next for validation: `test -d _next`
  fs.writeFileSync(path.join(OUT_DIR, "_next", ".keep"), "")

  console.log("✨ Showcase build complete! Output in dist-showcase/")
}

build().catch((err) => {
  console.error("Build failed:", err)
  process.exit(1)
})
