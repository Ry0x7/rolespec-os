import { createAnthropic } from "@ai-sdk/anthropic"

// Anthropic API — direct API-key access (not the Claude Code CLI). Requires
// ANTHROPIC_API_KEY. Unlike the claude-code provider, this works in serverless
// environments since it makes plain HTTPS calls to the Anthropic API.
// `apiKey` is the admin-entered key decrypted from AiSettings, when there is one;
// it takes precedence over ANTHROPIC_API_KEY. Undefined falls back to the env.
export function getAnthropicModel(modelId?: string, apiKey?: string) {
  const anthropic = createAnthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY })
  return anthropic(modelId ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8")
}
