import { Globe, ShieldCheck } from "lucide-react"

import { getFirecrawlStatus } from "@/features/settings/services/integration-settings.service"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card"
import { FirecrawlSettingsForm } from "./firecrawl-settings-form"

/**
 * Firecrawl is optional infrastructure, not a model provider. The key is now
 * entered and edited here — the desktop build has no `.env` workflow — and is
 * stored encrypted in the local database. The card never receives the key.
 */
export async function WebResearchCard() {
  const status = await getFirecrawlStatus()

  return (
    <Card id="web-research">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-brand-400" aria-hidden="true" />
              Web research
            </CardTitle>
            <CardDescription>
              Lets the agent read public company pages and search beyond the
              built-in job boards. Optional — the app works without it.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            Some company sites block ordinary visits or load their text with
            JavaScript. Firecrawl is a separate reading service (it has a free
            tier) that gets a clean copy of those pages. It is also what lets job
            discovery look outside the built-in boards.
          </p>
          <p className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
            <ShieldCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-success"
              aria-hidden="true"
            />
            <span>
              Paste your key below and it is encrypted on this computer. It is
              never shown again and never included in files you share. Get a key
              at{" "}
              <a
                href="https://firecrawl.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-400 underline underline-offset-4"
              >
                firecrawl.dev
              </a>
              .
            </span>
          </p>
        </div>
        <FirecrawlSettingsForm status={status} />
      </CardContent>
    </Card>
  )
}
