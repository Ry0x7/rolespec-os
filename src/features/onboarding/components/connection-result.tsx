"use client"

import { AlertTriangle, CheckCircle2, ExternalLink, Terminal } from "lucide-react"
import { Button } from "@/shared/ui/button"
import type {
  AiConnectionTestFailure,
  AiConnectionTestResult,
} from "../lib/ai-connection-test"

interface ConnectionResultProps {
  result: AiConnectionTestResult
  /** Shown as a retry button when provided. */
  onRetry?: () => void
  retryLabel?: string
  retrying?: boolean
}

/**
 * Renders the outcome of a real connection test. Failures always name the
 * provider and the next step; there is no generic "something went wrong" path.
 */
export function ConnectionResult({
  result,
  onRetry,
  retryLabel = "Test again",
  retrying = false,
}: ConnectionResultProps) {
  if (result.ok) {
    return (
      <div
        className="rounded-lg border border-green-600/30 bg-green-600/5 p-4"
        role="status"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold">{result.providerLabel} is working.</p>
            <p className="text-sm text-muted-foreground">
              {result.message}{" "}
              <span className="font-mono text-xs">({result.model})</span>
            </p>
            <p className="text-xs text-muted-foreground">
              A tiny test request was sent through RoleSpec&apos;s normal AI path, so
              resume tailoring, ATS analysis and matching will use this provider.
            </p>
          </div>
        </div>
        {onRetry ? (
          <div className="mt-3 pl-8">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRetry}
              loading={retrying}
            >
              {retryLabel}
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  return <ConnectionFailure result={result} onRetry={onRetry} retrying={retrying} />
}

function ConnectionFailure({
  result,
  onRetry,
  retrying,
}: {
  result: AiConnectionTestFailure
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <div
      className="rounded-lg border border-error/40 bg-error/5 p-4"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-error" />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold">{result.title}</p>
          <p className="text-sm text-muted-foreground">{result.message}</p>

          {result.guidance.length > 0 ? (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {result.guidance.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}

          {result.command ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
              <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <code className="min-w-0 break-all font-mono text-xs">{result.command}</code>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {result.docsUrl ? (
              <a
                href={result.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 underline-offset-4 hover:underline"
              >
                Open the official setup guide
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            {result.keyUrl ? (
              <a
                href={result.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 underline-offset-4 hover:underline"
              >
                Open the provider&apos;s API keys page
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>

          {result.detail ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Provider response</summary>
              <p className="mt-1 break-words font-mono">{result.detail}</p>
            </details>
          ) : null}

          {onRetry ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRetry}
              loading={retrying}
            >
              Test again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
