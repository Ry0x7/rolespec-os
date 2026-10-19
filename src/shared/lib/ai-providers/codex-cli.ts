import { createCodexExec } from "ai-sdk-provider-codex-cli"
import { resolveCodexModelId, resolveInstalledCodexPath } from "./codex-paths"

// ChatGPT subscription auth via OpenAI's Codex CLI (`ai-sdk-provider-codex-cli`).
// Auth is handled entirely by the Codex CLI itself — no key is passed to the
// factory. Run `npm i -g @openai/codex` then `codex login` on the machine running
// RoleSpec to sign in with a ChatGPT Plus/Pro account; the provider's subprocess
// reads the OAuth tokens the CLI wrote to ~/.codex/auth.json.
//
// The path is resolved explicitly because the provider otherwise prefers its own
// bundled (older) Codex build, which rejects current ChatGPT-account models.
//
// IMPORTANT: this provider spawns `codex exec` as a subprocess. It is
// local-development / self-host only — it will not run on Vercel serverless.
export function getCodexCliModel(modelId?: string) {
  // Constructed inside the getter (not at module scope) so importing this module
  // never spawns/initializes the provider unless the codex-cli provider is
  // actually selected — matches the sibling claude-code.ts / openai.ts getters.
  const codexPath = resolveInstalledCodexPath()
  const codex = createCodexExec({
    defaultSettings: {
      // The app is not a coding agent: forbid file writes and shell approvals so
      // a prompt can never mutate the host it runs on.
      sandboxMode: "read-only",
      approvalMode: "never",
      // RoleSpec's working directory is not necessarily a git repo (Docker image,
      // installed self-host), and Codex refuses to run outside one by default.
      skipGitRepoCheck: true,
      // Fall back to the bundled CLI only when no installed CLI can be found.
      ...(codexPath ? { codexPath } : {}),
    },
  })
  return codex(modelId?.trim() || resolveCodexModelId())
}
