import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // Scoped to `src/` so the standalone `extension/` package, `scripts/` and
    // scratch worktrees under `.claude/` are never collected.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // The jsdom component tests pay a lazy module-import cost on their first
    // async resolution, which under full-suite parallel load can exceed the
    // 5000ms default and time a test out that passes in isolation. A test's own
    // timeout also caps every wait nested inside it, so the 5000ms default made
    // the `{ timeout: 10_000 }` that `mobile-nav.test.tsx` already asks for
    // unreachable — the test aborted at 5s. 15s leaves that 10s budget room to
    // run to completion after the render and click ahead of it. The tradeoff is
    // that a genuinely hung test now takes 15s rather than 5s to report.
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
