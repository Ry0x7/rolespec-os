import type { ThreeLayerResearch } from "../services/three-layer-research.service"
import { Badge } from "@/shared/ui/badge"

export function ResearchLayers({ layers }: { layers: ThreeLayerResearch }) {
  if (!Array.isArray(layers.requirements?.required) || !Array.isArray(layers.requirements?.preferred) || !Array.isArray(layers.requirements?.flags) || !Array.isArray(layers.requirements?.uncertainty) || !Array.isArray(layers.culture?.signals) || !Array.isArray(layers.culture?.conflicts) || !layers.sourceSummary) {
    return <p className="text-sm text-muted-foreground">Saved research layers are incomplete. Re-run research to load their sources and uncertainty.</p>
  }
  return <div className="space-y-5 border-t border-border pt-4 text-sm">
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><time dateTime={layers.researchedAt}>Researched {new Date(layers.researchedAt).toLocaleString()}</time><span>{layers.sourceSummary.independentSources} independent sources · {layers.sourceSummary.totalSources} sources total{layers.cached ? " · cached result" : ""}</span></div>
    <section aria-label="Posting requirements" className="space-y-3"><h3 className="font-semibold">What the posting asks for</h3>
      <div className="grid gap-4 sm:grid-cols-2">{([ ["Required", layers.requirements.required], ["Preferred", layers.requirements.preferred] ] as const).map(([label, items]) => <div key={label}><h4 className="text-xs font-medium text-muted-foreground">{label}</h4>{items.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-4">{items.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="mt-2 text-muted-foreground">Not specified in the posting.</p>}</div>)}</div>
      {layers.requirements.flags.length > 0 && <p>Posting flags: {layers.requirements.flags.map(flag => flag.replaceAll("_", " ").toLowerCase()).join(" · ")}</p>}
      {layers.requirements.uncertainty.length > 0 && <ul className="space-y-1 text-muted-foreground">{layers.requirements.uncertainty.map((item, i) => <li key={i}>{item}</li>)}</ul>}
    </section>
    <section aria-label="Culture evidence" className="space-y-3"><h3 className="font-semibold">How the company works</h3><p className="text-muted-foreground">{layers.culture.explanation}</p>
      <dl className="divide-y divide-border">{layers.culture.signals.map((signal, i) => <div key={i} className="py-3"><dt className="flex flex-wrap items-center gap-2 font-medium">{signal.label}<Badge variant={signal.state === "VERIFIED" ? "success" : "neutral"}>{signal.state === "STATED_IN_POSTING" ? "Posting statement" : signal.state === "VERIFIED" ? "Source verified" : "Unknown"}</Badge></dt><dd className="mt-1 space-y-2"><p>{signal.value ?? "No supporting evidence available."}</p>{signal.citations.map((cite, n) => <div key={n} className="space-y-1 text-xs text-muted-foreground">{/^https?:\/\//i.test(cite.url) ? <a className="break-words text-brand-400 underline underline-offset-4" href={cite.url} target="_blank" rel="noopener noreferrer">{cite.title || cite.url} (opens in new tab)</a> : <span>Source URL unavailable</span>}{cite.quote && <blockquote className="break-words">“{cite.quote}”</blockquote>}</div>)}</dd></div>)}</dl>
      {layers.culture.conflicts.length > 0 && <div className="rounded-md bg-muted p-3"><h4 className="font-medium">Conflicting evidence</h4><ul className="mt-1 space-y-1 text-muted-foreground">{layers.culture.conflicts.map((conflict, i) => <li key={i}>{conflict}</li>)}</ul></div>}
    </section>
  </div>
}
