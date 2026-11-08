"use client"

import Link from "next/link"
import { useActionState } from "react"
import { GitBranch, Globe } from "lucide-react"

import { Button } from "@/shared/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"

import {
  scanCareerWebSource,
  type WebScanResult,
} from "../actions/web-presence.actions"

function summarize(result: WebScanResult | null): string | null {
  if (!result) return null
  if ("error" in result) return result.error

  const parts: string[] = []
  if (result.evidenceCreated > 0) {
    parts.push(
      `${result.evidenceCreated} ${result.evidenceCreated === 1 ? "project" : "projects"}`
    )
  }
  if (result.capabilitiesCreated > 0) {
    parts.push(
      `${result.capabilitiesCreated} ${result.capabilitiesCreated === 1 ? "skill" : "skills"}`
    )
  }

  const skipped = result.evidenceSkipped + result.capabilitiesSkipped
  const added =
    parts.length === 0 ? "Nothing new to add" : `Added ${parts.join(" and ")} to Evidence`
  return skipped === 0 ? added : `${added}; ${skipped} already existed`
}

function ResultNote({ result }: { result: WebScanResult | null }) {
  const text = summarize(result)
  if (!text || !result) return null

  if ("error" in result) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {text}
      </p>
    )
  }

  return (
    <p role="status" className="text-sm text-muted-foreground">
      {text}.{" "}
      <Link href="#evidence" className="text-brand-400 hover:underline">
        Review candidates
      </Link>
      .
    </p>
  )
}

function Consent({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-xs text-muted-foreground">
      <input
        id={id}
        name="confirm"
        type="checkbox"
        required
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-500"
      />
      <span>{children}</span>
    </label>
  )
}

/**
 * Opt-in scan of the owner's own public pages.
 *
 * Nothing is fetched on page load: each form needs an explicit address, an
 * ownership confirmation and a button press. The server requires the same
 * confirmation, so the checkbox is not merely a client-side courtesy.
 */
export function ImportWebSourcesCard({
  githubUrl,
  websiteUrl,
}: {
  githubUrl: string | null
  websiteUrl: string | null
}) {
  const [githubResult, githubAction, githubPending] = useActionState<
    WebScanResult | null,
    FormData
  >((_previous, formData) => scanCareerWebSource(formData), null)
  const [portfolioResult, portfolioAction, portfolioPending] = useActionState<
    WebScanResult | null,
    FormData
  >((_previous, formData) => scanCareerWebSource(formData), null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scan public profiles</CardTitle>
        <CardDescription>
          Turn your own GitHub repositories or portfolio page into projects and skills to
          review. Nothing is fetched until you press a scan button, and nothing is
          confirmed automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form action={githubAction} className="space-y-3">
          <input type="hidden" name="source" value="github" />
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-brand-400" aria-hidden="true" />
            <h3 className="text-sm font-medium">GitHub</h3>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="web-github-url">Profile address</Label>
            <Input
              id="web-github-url"
              name="url"
              type="url"
              inputMode="url"
              placeholder="https://github.com/your-handle"
              defaultValue={githubUrl ?? ""}
              maxLength={300}
              required
            />
          </div>
          <Consent id="web-github-consent">
            I own this GitHub account. RoleSpec may read its public profile and
            repositories through the GitHub API.
          </Consent>
          <ResultNote result={githubResult} />
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="secondary"
              loading={githubPending}
              disabled={githubPending}
            >
              {githubPending ? "Scanning…" : "Scan GitHub"}
            </Button>
          </div>
        </form>

        <div className="border-t border-border pt-5">
          <form action={portfolioAction} className="space-y-3">
            <input type="hidden" name="source" value="portfolio" />
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-brand-400" aria-hidden="true" />
              <h3 className="text-sm font-medium">Portfolio or personal site</h3>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="web-portfolio-url">Page address</Label>
              <Input
                id="web-portfolio-url"
                name="url"
                type="url"
                inputMode="url"
                placeholder="https://your-name.dev"
                defaultValue={websiteUrl ?? ""}
                maxLength={500}
                required
              />
            </div>
            <Consent id="web-portfolio-consent">
              I own this site. RoleSpec may fetch this one public page and copy what
              it says into unconfirmed candidates.
            </Consent>
            <ResultNote result={portfolioResult} />
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="secondary"
                loading={portfolioPending}
                disabled={portfolioPending}
              >
                {portfolioPending ? "Scanning…" : "Scan portfolio"}
              </Button>
            </div>
          </form>
        </div>
      </CardContent>
    </Card>
  )
}
