import Link from "next/link"
import { KeyRound } from "lucide-react"
import { buttonVariants } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"

interface ShouldShowAiKeyBannerInput {
  /** Session role. Admins fall back to the deployment config, so they never see it. */
  role: string | undefined
  /** `configured` from `getUserAiKeyStatus` — a key that fails to decrypt is false. */
  hasUsableKey: boolean
}

/**
 * Who needs the "bring your own key" nudge: any signed-in non-admin without a
 * usable personal key. Kept separate from the markup so the rule is testable.
 */
export function shouldShowAiKeyBanner({
  role,
  hasUsableKey,
}: ShouldShowAiKeyBannerInput): boolean {
  if (role === "ADMIN") return false
  return !hasUsableKey
}

/**
 * Dashboard nudge toward `/settings/ai`. Without it a new user's first AI action
 * is an `AiKeyRequiredError` toast with no path to a fix.
 */
export function AiKeyBanner() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-600/20 bg-amber-600/5 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-6 dark:border-amber-500/20 dark:bg-amber-500/5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-600/10 dark:bg-amber-500/10">
        <KeyRound
          className="h-5 w-5 text-amber-700 dark:text-amber-400"
          aria-hidden="true"
        />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">
          AI features need your own API key
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          RoleSpec is free during the beta — add an OpenAI, Anthropic, DeepSeek,
          or Google key to unlock resume enhancement, job matching, and email
          drafting.
        </p>
      </div>

      <Link
        href="/settings/ai"
        className={cn(buttonVariants({ size: "sm" }), "shrink-0 self-start sm:self-auto")}
      >
        Add your key
      </Link>
    </div>
  )
}
