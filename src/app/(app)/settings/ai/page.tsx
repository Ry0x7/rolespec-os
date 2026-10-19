import { redirect } from "next/navigation"
import { auth } from "@/features/auth/config"
import { getEffectiveAiConfigForUser } from "@/shared/lib/ai-provider"
import { AI_PROVIDER_META } from "@/shared/lib/ai-providers/constants"
import { UserAiKeyForm } from "@/features/settings/components/user-ai-key-form"
import { getUserAiKeyStatus } from "@/features/settings/services/user-ai-settings.service"
import { Badge } from "@/shared/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card"

export const dynamic = "force-dynamic"

export default async function SettingsAiPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  // Per-user resolution, not the deployment singleton: after onboarding this is
  // what every AI call will actually use, and a header naming a different
  // provider than the form beside it is worse than no header at all.
  const [keyStatus, effective] = await Promise.all([
    getUserAiKeyStatus(session.user.id),
    getEffectiveAiConfigForUser(session.user.id),
  ])

  const meta = AI_PROVIDER_META[effective.provider]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>AI Provider &amp; Model</CardTitle>
              <CardDescription>
                Choose which model powers ATS scoring, resume tailoring, cover letters, and outreach emails.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="brand" size="sm">
                Active: {meta?.label ?? effective.provider}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {effective.model}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <UserAiKeyForm
            status={{
              provider: keyStatus.provider,
              model: keyStatus.model,
              configured: keyStatus.configured,
              envConfigured: keyStatus.envConfigured,
              ...(keyStatus.last4 ? { last4: keyStatus.last4 } : {}),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Zero-Cost &amp; Local AI Options</CardTitle>
          <CardDescription>
            RoleSpec supports free local execution or existing subscriptions:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong className="text-foreground">Claude Code:</strong> Authenticate via <code className="font-mono text-xs">claude setup-token</code> on the host to use your Anthropic plan.
            </li>
            <li>
              <strong className="text-foreground">ChatGPT via Codex CLI:</strong> Run <code className="font-mono text-xs">npm i -g @openai/codex &amp;&amp; codex login</code> on the host to use your ChatGPT Plus/Pro quota at $0 extra cost.
            </li>
            <li>
              <strong className="text-foreground">Ollama / LM Studio:</strong> Run open models locally (e.g. Qwen 2.5, Llama 3) with full offline privacy.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
