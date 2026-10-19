/**
 * Plain-language AI setup choices for first-run onboarding and the guided
 * setup panel in Settings.
 *
 * This module is client-safe on purpose: it carries only labels, copy and the
 * mapping onto the runtime providers in `src/shared/lib/ai-providers/constants.ts`.
 * No filesystem, process or network access belongs here.
 */

import type { AiProvider } from "@/shared/lib/ai-providers/constants"

export type AiSetupGroupId = "chatgpt" | "claude" | "local" | "api"

/**
 * How the provider authenticates. Drives which setup fields the UI shows.
 *
 * - `cli-session`: the vendor's own CLI owns the login; RoleSpec never sees it.
 * - `local-server`: no account, only a local HTTP server and a downloaded model.
 * - `api-key`: a key the user pastes, stored encrypted by the existing settings service.
 */
export type AiCredentialKind = "cli-session" | "local-server" | "api-key"

export interface AiSetupProviderGuide {
  provider: AiProvider
  label: string
  /** One line for the choice card. */
  tagline: string
  credentialKind: AiCredentialKind
  /** What the user needs before RoleSpec can use it. Normal language. */
  requirement: string
  /** Ordered, non-technical setup guidance. */
  steps: string[]
  /** Official command to run, when the official flow is a CLI command. */
  command?: string
  /** Official install / sign-in documentation. */
  docsUrl?: string
  /** Official API-key page, for `api-key` providers. */
  keyUrl?: string
  keyPlaceholder?: string
  /** Extra caution shown in the panel. */
  note?: string
}

export interface AiSetupGroup {
  id: AiSetupGroupId
  label: string
  tagline: string
  description: string
  /** Provider chosen automatically when the group has exactly one. */
  providers: AiSetupProviderGuide[]
}

export const AI_SETUP_GROUPS: readonly AiSetupGroup[] = [
  {
    id: "chatgpt",
    label: "Use ChatGPT",
    tagline: "ChatGPT Plus or Pro subscription",
    description:
      "RoleSpec uses OpenAI's Codex CLI, which signs in with your own ChatGPT account. No API credits or extra payment.",
    providers: [
      {
        provider: "codex-cli",
        label: "ChatGPT via Codex CLI",
        tagline: "Uses your existing ChatGPT Plus or Pro plan",
        credentialKind: "cli-session",
        requirement:
          "You need a ChatGPT Plus or Pro subscription and OpenAI's free Codex CLI installed and signed in.",
        steps: [
          "Install the Codex CLI from OpenAI (one-time download).",
          "Sign in with the same account you use for ChatGPT.",
          "Come back here and test the connection.",
        ],
        command: "codex login",
        docsUrl: "https://developers.openai.com/codex/cli/",
        note: "RoleSpec never reads or copies your ChatGPT login. The Codex CLI keeps its own sign-in on this computer.",
      },
    ],
  },
  {
    id: "claude",
    label: "Use Claude",
    tagline: "Claude Pro or Team subscription",
    description:
      "RoleSpec uses Anthropic's Claude Code, which signs in with your own Claude subscription through Anthropic's official flow.",
    providers: [
      {
        provider: "claude-code",
        label: "Claude via Claude Code",
        tagline: "Uses your existing Claude Pro or Team plan",
        credentialKind: "cli-session",
        requirement:
          "You need a Claude Pro or Team subscription and Anthropic's Claude Code installed and signed in.",
        steps: [
          "Install Claude Code from Anthropic (one-time download).",
          "Sign in using Anthropic's official sign-in flow.",
          "Come back here and test the connection.",
        ],
        command: "claude auth login",
        docsUrl: "https://code.claude.com/docs/en/setup",
        note: "RoleSpec never reads or copies your Claude login. Claude Code keeps its own credentials on this computer.",
      },
    ],
  },
  {
    id: "local",
    label: "Use local AI",
    tagline: "Private and offline",
    description:
      "Run a model on this computer. Nothing is sent to a cloud provider, but the first download can be several gigabytes and quality depends on your hardware.",
    providers: [
      {
        provider: "ollama",
        label: "Ollama",
        tagline: "Simple local model runner",
        credentialKind: "local-server",
        requirement:
          "Ollama must be installed, running, and have at least one model downloaded.",
        steps: [
          "Install Ollama and start it.",
          "Download a model (for example qwen2.5vl:7b) in the Ollama app or with the command below.",
          "Come back here and test the connection.",
        ],
        command: "ollama pull qwen2.5vl:7b",
        docsUrl: "https://ollama.com/download",
        note: "RoleSpec never downloads a model without asking. Large models can take a long time and a lot of disk space.",
      },
      {
        provider: "lmstudio",
        label: "LM Studio",
        tagline: "Desktop app for local models",
        credentialKind: "local-server",
        requirement:
          "LM Studio must be running its local server and a model must be loaded.",
        steps: [
          "Install LM Studio and download a model in the app.",
          "Start the local server from LM Studio's Developer tab.",
          "Come back here and test the connection.",
        ],
        docsUrl: "https://lmstudio.ai/",
        note: "RoleSpec never downloads a model without asking. Large models can take a long time and a lot of disk space.",
      },
    ],
  },
  {
    id: "api",
    label: "Use an API key",
    tagline: "OpenAI, Anthropic, Google or DeepSeek",
    description:
      "Pay the provider directly for what you use. This is the most predictable option for older computers, but it needs an API key and billing set up with that provider.",
    providers: [
      {
        provider: "openai",
        label: "OpenAI API",
        tagline: "Pay-per-use OpenAI models",
        credentialKind: "api-key",
        requirement: "An OpenAI API key with billing enabled.",
        steps: ["Create an API key in the OpenAI dashboard.", "Paste it here and test."],
        keyUrl: "https://platform.openai.com/api-keys",
        keyPlaceholder: "sk-...",
        docsUrl: "https://platform.openai.com/docs",
      },
      {
        provider: "anthropic",
        label: "Anthropic API",
        tagline: "Pay-per-use Claude models",
        credentialKind: "api-key",
        requirement: "An Anthropic API key with billing enabled.",
        steps: [
          "Create an API key in the Anthropic console.",
          "Paste it here and test.",
        ],
        keyUrl: "https://console.anthropic.com/settings/keys",
        keyPlaceholder: "sk-ant-...",
        docsUrl: "https://docs.anthropic.com",
      },
      {
        provider: "google",
        label: "Google Gemini",
        tagline: "Pay-per-use Gemini models",
        credentialKind: "api-key",
        requirement: "A Google AI Studio API key. A free tier is available.",
        steps: [
          "Create an API key in Google AI Studio.",
          "Paste it here and test.",
        ],
        keyUrl: "https://aistudio.google.com/apikey",
        keyPlaceholder: "AIza...",
        docsUrl: "https://ai.google.dev/gemini-api/docs",
      },
      {
        provider: "deepseek",
        label: "DeepSeek",
        tagline: "Low-cost API models",
        credentialKind: "api-key",
        requirement: "A DeepSeek API key with credit on the account.",
        steps: [
          "Create an API key in the DeepSeek platform.",
          "Paste it here and test.",
        ],
        keyUrl: "https://platform.deepseek.com/api_keys",
        keyPlaceholder: "sk-...",
        docsUrl: "https://api-docs.deepseek.com",
      },
    ],
  },
] as const

const PROVIDER_GROUP = new Map<AiProvider, AiSetupGroupId>(
  AI_SETUP_GROUPS.flatMap((group) =>
    group.providers.map((guide) => [guide.provider, group.id] as const)
  )
)

const PROVIDER_GUIDE = new Map<AiProvider, AiSetupProviderGuide>(
  AI_SETUP_GROUPS.flatMap((group) =>
    group.providers.map((guide) => [guide.provider, guide] as const)
  )
)

export function aiSetupGroupForProvider(provider: AiProvider): AiSetupGroupId | null {
  return PROVIDER_GROUP.get(provider) ?? null
}

export function aiSetupGuideFor(provider: AiProvider): AiSetupProviderGuide | null {
  return PROVIDER_GUIDE.get(provider) ?? null
}

export function aiSetupGroupById(id: AiSetupGroupId): AiSetupGroup | null {
  return AI_SETUP_GROUPS.find((group) => group.id === id) ?? null
}

/** Providers whose key is stored encrypted by `saveUserAiSettings`. */
export function providerUsesApiKey(provider: AiProvider): boolean {
  return aiSetupGuideFor(provider)?.credentialKind === "api-key"
}
