"use client"

import { useState } from "react"
import { Check, Copy, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { formatDate } from "@/shared/lib/utils"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import type { LinkedinSuggestionData } from "../services/linkedin.service"

interface LinkedinAssistResultsProps {
  data: LinkedinSuggestionData | null
}

export function LinkedinAssistResults({ data }: LinkedinAssistResultsProps) {
  if (!data) return null

  const { headline, about, experience, skillsToAdd, quickWins } = data.suggestions
  const positions = experience ?? []
  const skills = skillsToAdd ?? []
  const wins = quickWins ?? []

  return (
    <Card className="space-y-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-400" aria-hidden="true" />
          LinkedIn Assist
        </CardTitle>
        <CardDescription>
          Rewrites drawn only from your export — copy each block straight into
          LinkedIn. Generated {formatDate(data.createdAt)}.
        </CardDescription>
      </CardHeader>

      <div className="space-y-6">
        {headline && (
          <Section title="Headline">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                {/* h-8 matches the sibling's copy button so both boxes line up. */}
                <div className="flex h-8 items-center">
                  <p className="text-xs font-medium text-muted-foreground">Current</p>
                </div>
                <p className="rounded-md border border-border bg-background p-2.5 text-sm text-muted-foreground">
                  {headline.current?.trim() || "No headline found in your export."}
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex h-8 items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Suggested</p>
                  <CopyButton
                    value={headline.suggested}
                    label="suggested headline"
                  />
                </div>
                <p className="rounded-md border border-brand-700/60 bg-brand-700/5 p-2.5 text-sm text-foreground">
                  {headline.suggested}
                </p>
              </div>
            </div>
            <Rationale text={headline.rationale} />
          </Section>
        )}

        {about?.suggested && (
          <Section
            title="About"
            action={<CopyButton value={about.suggested} label="suggested about section" />}
          >
            <p className="whitespace-pre-line rounded-md border border-border bg-background p-3 text-sm text-foreground">
              {about.suggested}
            </p>
            <Rationale text={about.rationale} />
          </Section>
        )}

        {positions.length > 0 && (
          <Section title="Experience">
            <div className="space-y-3">
              {positions.map((position, idx) => {
                const bullets = position.suggestedBullets ?? []
                return (
                  <div
                    key={`${position.position}-${idx}`}
                    className="space-y-2 rounded-md border border-border bg-background p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-sm font-semibold text-foreground">
                        {position.position}
                      </p>
                      <CopyButton
                        value={bullets.join("\n")}
                        label={`suggested bullets for ${position.position}`}
                      />
                    </div>
                    <ul className="space-y-1.5">
                      {bullets.map((bullet, bulletIdx) => (
                        <li
                          key={bulletIdx}
                          className="flex gap-2 text-xs text-foreground"
                        >
                          <span
                            className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-400"
                            aria-hidden="true"
                          />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                    <Rationale text={position.rationale} />
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {skills.length > 0 && (
          <Section title="Skills to add">
            <div className="flex flex-wrap gap-1.5">
              {skills.map((skill, idx) => (
                <Badge key={`${skill}-${idx}`} variant="brand" size="sm">
                  {skill}
                </Badge>
              ))}
            </div>
          </Section>
        )}

        {wins.length > 0 && (
          <Section title="Quick wins">
            <ul className="space-y-2">
              {wins.map((win, idx) => (
                <li
                  key={idx}
                  className="flex gap-2 rounded-md border border-border bg-background p-2.5 text-xs"
                >
                  <Check
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-500"
                    aria-hidden="true"
                  />
                  <span className="text-foreground">{win}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </Card>
  )
}

/** Placeholder shown while a suggestion run is in flight. */
export function LinkedinAssistResultsSkeleton() {
  return (
    <Card className="space-y-4" aria-hidden="true">
      <div className="space-y-2">
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        <div className="h-2 w-56 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="h-16 animate-pulse rounded-md bg-muted" />
        <div className="h-16 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="h-24 animate-pulse rounded-md bg-muted" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-2 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
    </Card>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h4>
        {action}
      </div>
      {children}
    </div>
  )
}

function Rationale({ text }: { text?: string }) {
  if (!text?.trim()) return null
  return <p className="text-xs text-muted-foreground">{text}</p>
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      toast.success("Copied")
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy to clipboard")
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={copy}
      aria-label={`Copy ${label}`}
      className="shrink-0"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}
