import { z } from "zod"
import { chatMessageSchema } from "../schemas/intake.schema"
import { extractChatFacts } from "../services/chat-extraction.service"
import { IntakeAdapterError } from "../types"
import type { IntakeAdapter, IntakeChatMessage } from "../types"

const transcriptSchema = z.array(chatMessageSchema).min(1).max(60)

export const chatIntakeAdapter: IntakeAdapter = {
  source: "CHAT",
  label: "Conversational chat",
  async run({ input, userId, signal, reportProgress }) {
    if (signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }
    const parsed = transcriptSchema.safeParse(input.transcript)
    if (!parsed.success) {
      throw new IntakeAdapterError(
        "INVALID_INPUT",
        "The conversation was empty or too long to read."
      )
    }
    const missingFields = Array.isArray(input.missingFields)
      ? input.missingFields.filter((value): value is string => typeof value === "string")
      : []

    await reportProgress(30, "Reading the conversation")
    const result = await extractChatFacts({
      userId,
      transcript: parsed.data as IntakeChatMessage[],
      missingFields,
      useAi: input.useAi === true,
      source: "CHAT",
    })
    if (signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }

    await reportProgress(100, "Conversation facts ready")
    return {
      patches: result.patches,
      warnings: result.warnings,
      meta: { mode: result.mode, nextQuestion: result.nextQuestion },
    }
  },
}
