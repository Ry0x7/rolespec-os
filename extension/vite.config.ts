import { build, defineConfig, type Plugin } from "vite"
import { resolve } from "node:path"

/**
 * The badge content script must be a classic script (content scripts cannot be ES
 * modules), and Rollup cannot emit an IIFE from a multi-entry build. So once the main
 * build has written dist/, a second, single-entry IIFE build appends
 * dist/assets/badge.js with every import inlined.
 */
function badgeContentScript(): Plugin {
  return {
    name: "rolespec-badge-content-script",
    apply: "build",
    async closeBundle() {
      await build({
        configFile: false,
        root: __dirname,
        publicDir: false,
        logLevel: "warn",
        build: {
          outDir: resolve(__dirname, "dist"),
          emptyOutDir: false,
          target: "esnext",
          minify: false,
          copyPublicDir: false,
          lib: {
            entry: resolve(__dirname, "src/badge.ts"),
            formats: ["iife"],
            name: "RoleSpecBadge",
            fileName: () => "assets/badge.js",
          },
        },
      })
    },
  }
}

// Two HTML entries (side panel, options) plus the background service worker, which is
// a bare JS entry emitted at assets/background.js to match manifest.json. `public/`
// holds manifest.json and is copied verbatim, so `dist/` is directly loadable via
// chrome://extensions.
// Minification stays off: the extractor is shipped to the page through
// `chrome.scripting.executeScript({ func })`, which stringifies the function, and
// readable injected source makes DevTools debugging on a job board tractable.
export default defineConfig({
  root: __dirname,
  plugins: [badgeContentScript()],
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "esnext",
    minify: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "sidepanel.html"),
        options: resolve(__dirname, "options.html"),
        background: resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
})
