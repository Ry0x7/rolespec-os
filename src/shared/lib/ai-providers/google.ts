import { createGoogleGenerativeAI } from "@ai-sdk/google"

// Google Gemini API — direct API-key access to the Generative Language API.
// Requires GOOGLE_GENERATIVE_AI_API_KEY. Works in serverless environments since
// it makes plain HTTPS calls. `apiKey` is the user-entered key decrypted from the
// DB, when there is one; it takes precedence over GOOGLE_GENERATIVE_AI_API_KEY.
// Undefined falls back to the env.
export function getGoogleModel(modelId?: string, apiKey?: string) {
  const google = createGoogleGenerativeAI({
    apiKey: apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  })
  return google(modelId ?? process.env.GOOGLE_MODEL ?? "gemini-2.5-flash")
}
