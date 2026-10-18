import { createOpenAI } from "@ai-sdk/openai"

// DeepSeek exposes an OpenAI-compatible REST API, so the OpenAI provider works
// against it with a different base URL. `apiKey` is the user- or admin-entered
// key decrypted from the DB, when there is one; it takes precedence over
// DEEPSEEK_API_KEY. Undefined falls back to the env.
export function getDeepSeekModel(modelId?: string, apiKey?: string) {
  const deepseek = createOpenAI({
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
    apiKey: apiKey ?? process.env.DEEPSEEK_API_KEY,
  })
  return deepseek(modelId ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat")
}
