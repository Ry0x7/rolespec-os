"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { AlertTriangle, ExternalLink, FileText, Lock, Search } from "lucide-react"
import { toast } from "sonner"

import { saveDiscoveredJob } from "@/features/discovery/actions/discovery.actions"
import { providerLabel } from "@/features/discovery/constants/providers"
import { Badge } from "@/shared/ui/badge"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { Input } from "@/shared/ui/input"
import { SegmentedControl } from "@/shared/ui/segmented-control"
import { Select } from "@/shared/ui/select"

import { findClientLeads, type FindClientLeadsResult } from "../actions/client-leads.actions"
import {
  CLIENT_SERVICE_GROUP_LABELS,
  CLIENT_SERVICES,
  customClientService,
  findClientService,
  type ClientServiceGroup,
} from "../data/services"
import {
  CLIENT_LINK_KIND_LABELS,
  buildClientSearchLinks,
  type ClientLinkKind,
} from "../lib/client-search-links"
import { LEAD_ENGAGEMENT_LABELS, type ClientArrangement, type LeadBand } from "../lib/lead-score"

const BAND_LABELS: Record<LeadBand, string> = {
  STRONG: "Strong lead",
  GOOD: "Worth a pitch",
  LONG_SHOT: "Long shot",
}

const BAND_VARIANTS: Record<LeadBand, "success" | "info" | "neutral"> = {
  STRONG: "success",
  GOOD: "info",
  LONG_SHOT: "neutral",
}

const GROUP_ORDER: ClientServiceGroup[] = ["ADMIN_SUPPORT", "AI_TECH", "MARKETING_CREATIVE", "FINANCE", "EDUCATION", "LOCAL"]
const LINK_KIND_ORDER: ClientLinkKind[] = ["MARKETPLACE", "HIRING_POSTS", "LOCAL"]

type Lead = FindClientLeadsResult["leads"][number]

function postedLabel(iso?: string): string | null {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return "Posted today"
  if (days === 1) return "Posted yesterday"
  return `Posted ${days} days ago`
}

export function ClientFinder({ defaultLocation }: { defaultLocation?: string | null }) {
  const [serviceId, setServiceId] = useState("virtual-assistant")
  const [customService, setCustomService] = useState("")
  const [arrangement, setArrangement] = useState<ClientArrangement>("REMOTE")
  const [location, setLocation] = useState(defaultLocation ?? "")
  const [result, setResult] = useState<FindClientLeadsResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, startSearch] = useTransition()
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedIds, setSavedIds] = useState<Record<string, string>>({})

  const service = serviceId === "custom" ? customClientService(customService) : findClientService(serviceId)
  const trimmedLocation = location.trim()
  // Links cost no request, so they update as the form changes.
  const links = service ? buildClientSearchLinks({ service, arrangement, location: trimmedLocation || undefined }) : []

  function search() {
    if (!service || searching) return
    setError(null)
    startSearch(async () => {
      const response = await findClientLeads({
        serviceId,
        ...(serviceId === "custom" ? { customService } : {}),
        arrangement,
        ...(trimmedLocation ? { location: trimmedLocation } : {}),
      })
      if ("error" in response) {
        setError(response.error)
        return
      }
      setResult(response)
    })
  }

  async function save(lead: Lead) {
    setSavingKey(lead.key)
    try {
      const response = await saveDiscoveredJob({
        provider: lead.provider,
        externalId: lead.externalId,
        title: lead.title,
        companyName: lead.companyName,
        url: lead.url,
        ...(lead.location && { location: lead.location }),
        ...(lead.workType && { workType: lead.workType }),
        ...(lead.fit.jobType && { jobType: lead.fit.jobType }),
        ...(lead.salaryText && { salaryText: lead.salaryText }),
        ...(lead.description && { description: lead.description }),
        ...(lead.postedAt && { postedAt: lead.postedAt }),
      })
      if ("error" in response) {
        toast.error(response.error)
        return
      }
      setSavedIds((current) => ({ ...current, [lead.key]: response.id }))
      toast.success(response.duplicate ? "Already in your saved opportunities" : "Lead saved to your opportunities")
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>What do you offer?</CardTitle>
          <CardDescription>
            Pick a service, say where you work, and RoleSpec searches public client posts and builds
            searches for the places clients hire. Nothing is sent to a client for you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1fr)_auto] xl:items-start"
            onSubmit={(event) => {
              event.preventDefault()
              search()
            }}
          >
            <div className="min-w-0 space-y-2">
              <label htmlFor="client-service" className="block text-sm font-medium">
                Service
              </label>
              <Select id="client-service" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
                {GROUP_ORDER.map((group) => (
                  <optgroup key={group} label={CLIENT_SERVICE_GROUP_LABELS[group]}>
                    {CLIENT_SERVICES.filter((item) => item.group === group).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value="custom">Something else…</option>
              </Select>
              {serviceId === "custom" ? (
                <Input
                  aria-label="Describe your service"
                  placeholder="e.g. Shopify store manager"
                  value={customService}
                  maxLength={80}
                  onChange={(event) => setCustomService(event.target.value)}
                />
              ) : (
                service && <p className="text-xs text-muted-foreground">{service.summary}</p>
              )}
            </div>

            <div className="space-y-2">
              <span className="block text-sm font-medium">
                Where you work
              </span>
              <SegmentedControl
                label="Where you work"
                size="sm"
                value={arrangement}
                onChange={setArrangement}
                options={[
                  { value: "REMOTE", label: "Remote" },
                  { value: "ONSITE", label: "On site" },
                  { value: "ANY", label: "Either" },
                ]}
              />
            </div>

            <div className="min-w-0 space-y-2">
              <label htmlFor="client-location" className="block text-sm font-medium">
                {arrangement === "REMOTE" ? "Your location (optional)" : "City or area"}
              </label>
              <Input
                id="client-location"
                placeholder={arrangement === "REMOTE" ? "Used only for local searches" : "e.g. Cebu City"}
                value={location}
                maxLength={100}
                onChange={(event) => setLocation(event.target.value)}
              />
            </div>

            <Button type="submit" loading={searching} disabled={!service} className="md:col-span-2 xl:col-span-1 xl:mt-7">
              <Search className="h-4 w-4" aria-hidden="true" />
              Find clients
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="rounded-md border border-error/40 p-3 text-sm">
          {error}
        </p>
      )}

      {result && (
        <section
          aria-labelledby="client-leads-heading"
          aria-busy={searching}
          // A new search keeps the old results on screen until it answers; dim
          // them so they are not mistaken for the new service's leads.
          className={`space-y-3 transition-opacity ${searching ? "pointer-events-none opacity-50" : ""}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="client-leads-heading" className="text-lg font-semibold">
              {result.leads.length > 0
                ? result.matchedCount > result.leads.length
                  ? `Best ${result.leads.length} of ${result.matchedCount} leads for ${result.serviceLabel.toLowerCase()}`
                  : `${result.leads.length} lead${result.leads.length === 1 ? "" : "s"} for ${result.serviceLabel.toLowerCase()}`
                : `No open leads for ${result.serviceLabel.toLowerCase()} right now`}
            </h2>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {result.sources
                .map((source) => `${source.label}: ${source.status === "ok" ? source.count : source.status === "timeout" ? "timed out" : "unavailable"}`)
                .join(" · ")}
              {result.unrelatedCount > 0 && ` · ${result.unrelatedCount} unrelated post${result.unrelatedCount === 1 ? "" : "s"} hidden`}
            </p>
          </div>
          {result.leads.length === 0 && (
            <p className="max-w-prose text-sm text-muted-foreground">
              Try another service wording, switch where you work, or use the searches below — most
              clients post on marketplaces and social media first.
            </p>
          )}
          <ul className="grid gap-3 lg:grid-cols-2">
            {result.leads.map((lead) => {
              const savedId = savedIds[lead.key] ?? lead.saved?.applicationId
              const posted = postedLabel(lead.postedAt)
              return (
                <li key={lead.key} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={BAND_VARIANTS[lead.fit.band]}>
                      {BAND_LABELS[lead.fit.band]} · {lead.fit.score}
                    </Badge>
                    <Badge variant="outline">{providerLabel(lead.provider)}</Badge>
                    {lead.fit.engagement !== "UNKNOWN" && <Badge>{LEAD_ENGAGEMENT_LABELS[lead.fit.engagement]}</Badge>}
                  </div>
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold">
                      <a href={lead.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {lead.title}
                      </a>
                    </h3>
                    <p className="break-words text-sm text-muted-foreground">
                      {[lead.companyName, lead.location, lead.salaryText, posted].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {lead.fit.reasons.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-5 text-sm">
                      {lead.fit.reasons.slice(0, 3).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  {lead.fit.cautions.length > 0 && (
                    <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
                      {lead.fit.cautions.slice(0, 3).map((caution) => (
                        <li key={caution} className="flex gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>{caution}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-auto flex flex-wrap gap-2">
                    {savedId ? (
                      <>
                        <Link href={`/jobs/${encodeURIComponent(savedId)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                          Open saved lead
                        </Link>
                        <Link
                          href={`/jobs/cover-letter/new?jobId=${encodeURIComponent(savedId)}`}
                          className={buttonVariants({ variant: "ghost", size: "sm" })}
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                          Draft a proposal
                        </Link>
                      </>
                    ) : (
                      <Button size="sm" loading={savingKey === lead.key} disabled={savingKey !== null} onClick={() => void save(lead)}>
                        Save lead
                      </Button>
                    )}
                    <a href={lead.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      Open post
                    </a>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Search where clients hire</CardTitle>
          <CardDescription>
            Ready-made searches for {service ? service.label.toLowerCase() : "your service"}. They open on
            the site itself, signed in as you; nothing is fetched until you open one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {links.length === 0 && <p className="text-sm text-muted-foreground">Describe your service to see searches.</p>}
          {LINK_KIND_ORDER.map((kind) => {
            const group = links.filter((link) => link.kind === kind)
            if (group.length === 0) return null
            return (
              <div key={kind} className="space-y-2">
                <h3 className="text-sm font-semibold">{CLIENT_LINK_KIND_LABELS[kind]}</h3>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {group.map((link) => (
                    <li key={link.id}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex h-full min-h-11 items-start gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block font-medium">{link.label}</span>
                          <span className="block text-xs text-muted-foreground">{link.hint}</span>
                          {link.signInRequired && (
                            <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              Needs your sign-in
                            </span>
                          )}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          <p className="text-xs text-muted-foreground">
            Lead scores read only the post itself: whether it asks for your service, how the work is
            paid, where it happens, how fresh it is, and common scam signals. A score is guidance, not
            a promise that a client will reply. Never pay a fee to get work.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
