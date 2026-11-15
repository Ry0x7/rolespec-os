import { AI_PROVIDER_META, type AiProvider } from "./constants"
import { resolveCodexModelId } from "./codex-paths"
import { resolveOpenCodeModelId } from "./opencode-models"
import { resolveAntigravityModelId } from "./antigravity-cli"

/** The model a provider uses when the user has not pinned one. */
export function defaultModelForProvider(provider: AiProvider): string {
  if (provider === "codex-cli") return resolveCodexModelId()
  if (provider === "opencode-cli") return resolveOpenCodeModelId()
  if (provider === "antigravity-cli") return resolveAntigravityModelId()
  return AI_PROVIDER_META[provider].defaultModel
}
