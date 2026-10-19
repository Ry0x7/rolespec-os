import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-desktop/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated desktop runtime: staged standalone bundle, Rust build tree and
    // vendored PostgreSQL. Linting build output is slow and meaningless.
    "desktop/src-tauri/resources/**",
    "desktop/src-tauri/target/**",
    "desktop/src-tauri/gen/**",
    "desktop/vendor/**",
    // Standalone Chrome extension: own tsconfig, eslint-free.
    "extension/**",
    // local gitignored verification harness
    "scripts/verify-extension/**",
  ]),
]);

export default eslintConfig;
