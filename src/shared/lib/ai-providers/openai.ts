import { createOpenAI } from "@ai-sdk/openai"

// `apiKey` is the admin-entered key decrypted from AiSettings, when there is
// one; it takes precedence over OPENAI_API_KEY. Undefined falls back to the env.
export function getOpenAIModel(modelId?: string, apiKey?: string) {
  const openai = createOpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY })
  return openai(modelId ?? process.env.OPENAI_MODEL ?? "gpt-4o")
}

// LM Studio — OpenAI-compatible local endpoint
export function getLMStudioModel(modelId?: string) {
  const lmstudio = createOpenAI({
    baseURL: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
    apiKey: "lm-studio",
  })
  return lmstudio(modelId ?? process.env.LMSTUDIO_MODEL ?? "qwen3:8b")
}

// Ollama — OpenAI-compatible local endpoint
export function getOllamaModel(modelId?: string) {
  const ollama = createOpenAI({
    baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
    apiKey: "ollama",
  })
  return ollama(modelId ?? process.env.OLLAMA_MODEL ?? "qwen2.5vl:7b")
}
