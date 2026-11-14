import type { IntakeAdapter, IntakeSource } from "../types"
import { chatIntakeAdapter } from "./chat.adapter"
import { githubIntakeAdapter } from "./github.adapter"
import { linkedinIntakeAdapter } from "./linkedin.adapter"
import { resumeIntakeAdapter } from "./resume.adapter"
import { voiceIntakeAdapter } from "./voice.adapter"
import { webIntakeAdapter } from "./web.adapter"

const ADAPTERS: Record<IntakeSource, IntakeAdapter> = {
  RESUME: resumeIntakeAdapter,
  GITHUB: githubIntakeAdapter,
  LINKEDIN: linkedinIntakeAdapter,
  WEB: webIntakeAdapter,
  CHAT: chatIntakeAdapter,
  VOICE: voiceIntakeAdapter,
}

export function getIntakeAdapter(source: IntakeSource): IntakeAdapter {
  return ADAPTERS[source]
}
