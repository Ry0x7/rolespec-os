import { extractChatFacts } from "../services/chat-extraction.service"
import { IntakeAdapterError } from "../types"
import type { IntakeAdapter, IntakeChatMessage } from "../types"

/**
 * Audio never leaves the client. The browser supplies either a live speech
 * transcript or text the user typed; both arrive here as text, so the desktop
 * app needs no microphone permission beyond the browser's own.
 */
export const voiceIntakeAdapter: IntakeAdapter = {
  source: "VOICE",
  label: "Voice transcript",
  async run({ input, userId, signal, reportProgress }) {
    if (signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }
    const transcript = typeof input.transcript === "string" ? input.transcript.trim() : ""
    if (!transcript) {
      throw new IntakeAdapterError(
        "INVALID_INPUT",
        "Record or paste a transcript before starting voice intake."
      )
    }
    const inputMode = input.inputMode === "MICROPHONE" ? "MICROPHONE" : "PASTED"

    await reportProgress(30, "Reading the transcript")
    const result = await extractChatFacts({
      userId,
      transcript: [{ role: "user", content: transcript }] as IntakeChatMessage[],
      useAi: input.useAi === true,
      source: "VOICE",
      inputMode,
    })
    if (signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }

    await reportProgress(100, "Voice facts ready")
    return {
      patches: result.patches,
      warnings: result.warnings,
      meta: { mode: result.mode, inputMode, nextQuestion: result.nextQuestion },
    }
  },
}
