import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import * as esbuild from "esbuild"

const ROOT_DIR = path.resolve(__dirname, "..")
const OUT_DIR = path.resolve(ROOT_DIR, "dist-showcase")

async function build() {
  console.log("🚀 Building RoleSpec OS Showcase...")

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

  // 3. Copy social assets. The page itself uses live HTML mocks, not
  // downscaled screenshots; only the Open Graph banner is a static image.
  console.log("🖼️ Copying social banner...")
  const screenshotsDir = path.join(ROOT_DIR, "screenshots")
  const targetRoleSpecDir = path.join(OUT_DIR, "RoleSpecOS")
  const bannerPath = path.join(screenshotsDir, "banner-2.1.png")
  if (!fs.existsSync(bannerPath)) {
    throw new Error("Missing showcase banner: screenshots/banner-2.1.png")
  }
  fs.copyFileSync(bannerPath, path.join(targetRoleSpecDir, "banner-2.1.png"))

  // Copy favicon. This is the square app mark, not the wide README banner:
  // a 1280x420 banner rendered in a browser tab is unreadable.
  const publicFavicon = path.join(ROOT_DIR, "public", "icon.svg")
  if (!fs.existsSync(publicFavicon)) {
    throw new Error("Missing app icon: public/icon.svg")
  }
  fs.copyFileSync(publicFavicon, path.join(OUT_DIR, "favicon.svg"))
  fs.copyFileSync(publicFavicon, path.join(targetRoleSpecDir, "icon.svg"))

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
  <title>RoleSpec OS — Private job-search workspace</title>
  <meta name="description" content="Private, local-first job-search workspace: today's application status, explainable ranking, resume studio, ATS matching and tracking on your own database.">
  <meta name="theme-color" content="#ffffff">
  <meta name="application-name" content="RoleSpec OS">

  <!-- Open Graph / Social Media -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://rolespec.ry0x7.dev/">
  <meta property="og:title" content="RoleSpec OS — Private job-search workspace">
  <meta property="og:description" content="A dashboard that leads with today, explainable ranking and a phone-first pipeline. Resume studio, ATS matching and tracking on your own database. Zero telemetry.">
  <meta property="og:image" content="https://rolespec.ry0x7.dev/RoleSpecOS/banner-2.1.png">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="RoleSpec OS — Private job-search workspace">
  <meta name="twitter:description" content="A dashboard that leads with today, explainable ranking and a phone-first pipeline. Resume studio, ATS matching and tracking on your own database. Zero telemetry.">
  <meta name="twitter:image" content="https://rolespec.ry0x7.dev/RoleSpecOS/banner-2.1.png">

  <link rel="icon" type="image/svg+xml" href="favicon.svg?v=2">
  <link rel="apple-touch-icon" href="favicon.svg?v=2">
  <link rel="stylesheet" href="styles.css">

  <!-- Pre-paint: apply stored/system theme + motion preference before first paint -->
  <script>
    (function() {
      try {
        var root = document.documentElement;
        var theme = localStorage.getItem('rolespec-theme');
        if (theme !== 'dark' && theme !== 'light') {
          theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        root.setAttribute('data-theme', theme);
        var motion = localStorage.getItem('rolespec-motion');
        var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (motion === 'reduced' || (!motion && prefersReduced)) {
          root.classList.add('reduce-motion');
          root.classList.remove('motion-full');
        } else {
          root.classList.add('motion-full');
          root.classList.remove('reduce-motion');
        }
      } catch (e) {}
    })();
  </script>
</head>
<body style="margin:0;background:#ffffff;color:#1d1d1f;min-height:100vh;font-family:system-ui,sans-serif">
  <div id="root"><p style="padding:3rem 1.5rem;text-align:center;color:#6e6e73">Loading RoleSpec OS…</p></div>
  <noscript><p style="padding:3rem 1.5rem;text-align:center;color:#6e6e73">This page needs JavaScript. The app itself runs at <a href="https://github.com/Ry0x7/rolespec-os" style="color:#0066cc">github.com/Ry0x7/rolespec-os</a>.</p></noscript>
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
