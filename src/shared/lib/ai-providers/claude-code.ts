import { createClaudeCode } from "ai-sdk-provider-claude-code"

// Claude subscription auth via the Claude Agent SDK/CLI (`ai-sdk-provider-claude-code`).
// Auth is handled entirely by the Claude Code CLI itself — no token is passed to the
// factory. Run `claude setup-token` locally to generate a long-lived OAuth token, then
// set CLAUDE_CODE_OAUTH_TOKEN in the environment; the provider's subprocess inherits it
// automatically (it allowlists CLAUDE_*-prefixed env vars for the spawned CLI process).
//
// IMPORTANT: this provider spawns the `claude` CLI as a native-binary subprocess. It is
// local-development-only — it will not run on Vercel serverless/edge functions.
export function getClaudeCodeModel(modelId?: string) {
  // Constructed inside the getter (not at module scope) so importing this module never
  // spawns/initializes the provider unless AI_PROVIDER=claude-code actually selects it —
  // matches the lazy-construction pattern used by the sibling openai.ts getters.
  const claudeCode = createClaudeCode()
  return claudeCode(modelId ?? process.env.CLAUDE_CODE_MODEL ?? "sonnet")
}
