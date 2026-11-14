"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, memo, useCallback, useState, useTransition } from "react"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  Info,
  Link as LinkIcon,
  Search,
  Settings2,
  Telescope,
  UserRoundCheck,
  X,
} from "lucide-react"
import { toast } from "sonner"

import type { WorkType } from "@/generated/prisma/enums"
import type { JobRequirementFlag } from "@/features/jobs/services/job-requirements.service"
import type { AtsWatchlist } from "@/features/settings/schemas/preferences.schema"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Select } from "@/shared/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { cn, formatDate } from "@/shared/lib/utils"
import { jobDetailHref } from "@/features/jobs/lib/job-detail-href"

import {
  addJobByUrl,
  runDiscovery,
  saveDiscoveredJob,
  type DiscoveryCandidate,
  type DiscoverySourceReport,
  type DiscoverySourceStatus,
  type ListingSummary,
} from "../actions/discovery.actions"
import { providerLabel } from "../constants/providers"
import {
  groupCandidatesByRole,
  variantLocationLabels,
  type RoleGroup,
} from "../lib/group-locations"
import {
  isPostedWithin,
  POSTED_WITHIN_OPTIONS,
  type PostedWithin,
} from "../lib/posted-within"
import { QualificationSummary } from "./qualification-summary"
import { WatchlistDialog } from "./watchlist-dialog"

interface Props {
  /** Query terms derived from the profile's active target roles, in run order. */
  queries: string[]
  /**
   * How many ACTIVE target roles the profile has. More than `queries.length`
   * means the run was capped, which the user is told rather than left to
   * notice: the roles that missed out are theirs to reorder.
   */
  activeTargetRoleCount: number
  /** The user's saved ATS board watchlist, as the dialog should first show it. */
  atsWatchlist: AtsWatchlist
  /**
   * True only when the profile answered "yes" to needing sponsorship. An
   * unanswered question never puts a chip on a row.
   */
  requiresSponsorship: boolean
  /**
   * The country the profile's locations resolve to, or null when they name none
   * this build recognises. Only used to say what the ranking is doing.
   */
  marketCountry: string | null
}

/** How a resolved market reads in the results header. */
const MARKET_COUNTRY_LABEL: Record<string, string> = {
  PH: "Philippines-first",
}

/** The saved job a row links to once it is on the board. */
type SavedMap = Record<string, string>

function candidateKey(candidate: DiscoveryCandidate): string {
  return candidate.canonicalUrl || `${candidate.provider}:${candidate.externalId}`
}

/**
 * Work-mode wording for the collapsed card. Short on purpose — the chip sits in
 * a row that already carries the provider and the posted date.
 */
const WORK_MODE_CHIP: Record<WorkType, string> = {
  REMOTE: "Remote",
  HYBRID: "Hybrid",
  ONSITE: "On-site",
}

/** The posting statements that settle the sponsorship question either way. */
const SPONSORSHIP_FLAGS: JobRequirementFlag[] = [
  "SPONSORSHIP_AVAILABLE",
  "NO_SPONSORSHIP",
]

/**
 * True when the user needs sponsorship and this posting said nothing about it.
 * Silence is the answer the user has to chase themselves, so the row says so
 * rather than leaving it inside the collapsed "Why?".
 *
 * The qualification decides whether the question is live at all: a posting that
 * hires where the user already is does not raise one, and a chip on every such
 * row is noise the user has to learn to ignore.
 */
function isSponsorshipUnknown(
  candidate: DiscoveryCandidate,
  requiresSponsorship: boolean
): boolean {
  if (!requiresSponsorship) return false
  if (candidate.qualification.sponsorshipRelevant === false) return false
  return !candidate.qualification.requirementFlags.some((flag) =>
    SPONSORSHIP_FLAGS.includes(flag)
  )
}

/** Past this many the line counts the rest rather than naming them. */
const MAX_NAMED_VARIANT_LOCATIONS = 3

/**
 * What the collapsed group line says. Named locations are the point — a board
 * that posted the same role in ten cities is only worth one row, and the user
 * decides from the list whether any of them is theirs. A posting is only ever
 * folded when it brings a location the group has not shown, so the line always
 * has something to name.
 */
function variantSummary(group: RoleGroup<DiscoveryCandidate>): string {
  const locations = variantLocationLabels(group)
  const named = locations.slice(0, MAX_NAMED_VARIANT_LOCATIONS).join(", ")
  const rest = locations.length - MAX_NAMED_VARIANT_LOCATIONS
  return `Also posted in ${named}${rest > 0 ? `, +${rest} more` : ""}`
}

interface RowProps {
  candidate: DiscoveryCandidate
  /** Set once this candidate is on the board, so the row links to it. */
  savedJobId?: string
  isSaving: boolean
  /** Precomputed by the parent so the memoized row compares on a boolean. */
  sponsorshipUnknown: boolean
  /** `open` sends the user to the saved job once the save lands. */
  onSave: (candidate: DiscoveryCandidate, options?: { open?: boolean }) => void
}

/**
 * One candidate in the result list.
 *
 * Memoized because a run returns a couple of hundred of these and saving one
 * changes exactly one row: without this, every `saved`/`savingKey` update
 * re-renders the whole list. The props are the only things a row draws from, so
 * the default shallow compare is the correct one — `candidate` objects come
 * straight out of the result array and are never rebuilt, and `onSave` is
 * stable.
 */
const CandidateRow = memo(function CandidateRow({
  candidate,
  savedJobId,
  isSaving,
  sponsorshipUnknown,
  onSave,
}: RowProps) {
  const workMode = candidate.workType ? WORK_MODE_CHIP[candidate.workType] : null

  return (
    <li className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-medium">{candidate.title}</p>
          <p className="truncate text-sm text-muted-foreground">
            {candidate.companyName}
            {candidate.location ? ` · ${candidate.location}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral" size="sm">
              {providerLabel(candidate.provider)}
            </Badge>
            {workMode && (
              <Badge variant="neutral" size="sm">
                {workMode}
              </Badge>
            )}
            {sponsorshipUnknown && (
              <Badge variant="neutral" size="sm">
                Sponsorship unknown
              </Badge>
            )}
            <Badge variant="neutral" size="sm" title={candidate.qualification.marketFit.reason}>
              {candidate.qualification.marketFit.label}
            </Badge>
            {candidate.postedAt && (
              <span className="text-xs text-muted-foreground">
                Posted {formatDate(candidate.postedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <a
            href={candidate.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-400 underline-offset-4 hover:underline"
          >
            View
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>

          {savedJobId ? (
            <span className="inline-flex items-center gap-2">
              <Badge variant="success" size="sm">
                <Check className="h-3 w-3" aria-hidden="true" />
                Saved
              </Badge>
              <Link
                href={jobDetailHref(savedJobId)}
                className="text-sm font-medium text-brand-400 underline-offset-4 hover:underline"
              >
                Open
              </Link>
              <Link
                href={jobDetailHref(savedJobId, "prepare")}
                className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
              >
                Tailor
              </Link>
            </span>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                loading={isSaving}
                onClick={() => onSave(candidate)}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isSaving}
                onClick={() => onSave(candidate, { open: true })}
              >
                Save &amp; open
              </Button>
            </>
          )}
        </div>
      </div>

      <QualificationSummary
        qualification={candidate.qualification}
        confidence={candidate.confidence}
      />
    </li>
  )
})

/** Per-provider detail, one line each — the evidence behind the summary. */
const SOURCE_STATUS_SUFFIX: Record<DiscoverySourceStatus, string> = {
  ok: "",
  timeout: " (timed out)",
  error: " (failed)",
  skipped: " (not set up)",
}

/** Past this many unconfigured sources the line names none of them. */
const MAX_NAMED_SKIPPED_SOURCES = 4

/** The length past which the one-line source summary stops naming them. */
const MAX_SOURCE_LINE_CHARS = 120

function sourcesTooltip(sources: DiscoverySourceReport[]): string {
  return sources
    .map(
      (source) =>
        `${source.label} — ${source.count === 1 ? "1 posting" : `${source.count} postings`} · ` +
        `${source.ms} ms${SOURCE_STATUS_SUFFIX[source.status]}`
    )
    .join("\n")
}

/**
 * One muted line saying how the run's sources actually went.
 *
 * Sources that answered normally are a count, not a list — the point is the
 * ones that did not, so those are named. A provider that ran fine and simply
 * had nothing appears only in the tooltip: "0 postings" is not a problem the
 * user needs to act on, and listing it would read as a failure.
 */
function SourceSummary({ sources }: { sources: DiscoverySourceReport[] }) {
  if (sources.length === 0) return null

  const ok = sources.filter((source) => source.status === "ok")
  const timedOut = sources.filter((source) => source.status === "timeout")
  const failed = sources.filter((source) => source.status === "error")
  const skipped = sources.filter((source) => source.status === "skipped")
  const names = (list: DiscoverySourceReport[]) =>
    list.map((source) => source.label).join(", ")

  const segments = [
    sources.length === 1 ? "1 source" : `${sources.length} sources`,
    `${ok.length} ok`,
  ]
  if (timedOut.length > 0) {
    segments.push(`${timedOut.length} timed out (${names(timedOut)})`)
  }
  if (failed.length > 0) {
    segments.push(`${failed.length} failed (${names(failed)})`)
  }
  if (skipped.length > 0) {
    // A short list of unconfigured boards is more useful named than counted —
    // the user can only act on a name. Past a handful, or past a line that
    // still reads at a glance, fall back to the count; the tooltip still lists
    // every one of them.
    const named = `${skipped.length} not set up (${names(skipped)})`
    const withNames = [...segments, named].join(" · ")
    segments.push(
      skipped.length <= MAX_NAMED_SKIPPED_SOURCES &&
        withNames.length <= MAX_SOURCE_LINE_CHARS
        ? named
        : `${skipped.length} not set up`
    )
  }

  return (
    <p
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={sourcesTooltip(sources)}
    >
      {timedOut.length + failed.length > 0 && (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{segments.join(" · ")}</span>
    </p>
  )
}

/**
 * The discovery surface: run the profile-derived searches, look at what came
 * back, save the ones worth tracking. Nothing here applies to anything — a
 * candidate only ever becomes an INTERESTED job the user chose to save.
 */
export function DiscoveryView({
  queries,
  activeTargetRoleCount,
  atsWatchlist,
  requiresSponsorship,
  marketCountry,
}: Props) {
  const [isSearching, startSearch] = useTransition()
  const [editingWatchlist, setEditingWatchlist] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([])
  // How the run's sources behaved. Cleared implicitly by the next run.
  const [sources, setSources] = useState<DiscoverySourceReport[]>([])
  const [saved, setSaved] = useState<SavedMap>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [showRuledOut, setShowRuledOut] = useState(false)
  // On by default for everyone: a posting that states it only hires somewhere
  // the user is not is noise in a list they are scanning, whether or not they
  // would relocate. Those postings are never dropped — the labelled count says
  // how many are hidden and one click puts them back. Client-side only:
  // nothing about this choice is stored.
  const [hideRestricted, setHideRestricted] = useState(true)
  // Freshness, off by default: a narrower window is the user's call, and it
  // hides every posting from a source that publishes no date.
  const [postedWithin, setPostedWithin] = useState<PostedWithin>("any")
  const [hideSaved, setHideSaved] = useState(false)
  const [isSavingAll, setIsSavingAll] = useState(false)
  // Which grouped roles have their other locations showing, keyed by the
  // primary row's key. Collapsed by default: the whole point of the fold is a
  // shorter list.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  // The ranking rule, on request. Collapsed by default so the header stays one
  // line for the user who already knows what the order means.
  const [showOrderHelp, setShowOrderHelp] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [isAdding, startAdd] = useTransition()
  const [addError, setAddError] = useState<string | null>(null)
  // Set only when the pasted URL turned out to be a careers index. `sourceUrl`
  // is what the user actually typed, so "Fetch more" asks the same question
  // again with an offset rather than re-deriving the page it landed on.
  const [listing, setListing] = useState<(ListingSummary & { sourceUrl: string }) | null>(null)

  const router = useRouter()

  // Stable, so the memoized rows do not all re-render on every state change.
  // Declared above the empty-state return: it is a hook, so it cannot be
  // reached conditionally.
  const handleSave = useCallback(
    (candidate: DiscoveryCandidate, options?: { open?: boolean }) => {
      const key = candidateKey(candidate)
      setSavingKey(key)

      void saveDiscoveredJob({
        provider: candidate.provider,
        externalId: candidate.externalId,
        title: candidate.title,
        companyName: candidate.companyName,
        url: candidate.url,
        location: candidate.location,
        workType: candidate.workType,
        salaryText: candidate.salaryText,
        description: candidate.description,
        postedAt: candidate.postedAt,
      })
        .then((result) => {
          if ("error" in result) {
            toast.error(result.error)
            return
          }
          setSaved((current) => ({ ...current, [key]: result.id }))
          toast.success(result.duplicate ? "Already on your board" : "Saved to your jobs")
          if (options?.open) router.push(jobDetailHref(result.id))
        })
        .finally(() => setSavingKey(null))
    },
    [router]
  )

  // One pasted URL joins the same list as a searched posting, at the top so the
  // user can see what came back without hunting for it. A careers index page
  // brings several at once and leaves a header saying where they came from.
  const runAddByUrl = useCallback((url: string, offset?: number) => {
    setAddError(null)
    startAdd(async () => {
      const result = await addJobByUrl(url, offset ? { offset } : undefined)

      if ("error" in result) {
        setAddError(result.error)
        return
      }

      setHasRun(true)

      if ("listing" in result) {
        const keys = new Set(result.candidates.map(candidateKey))
        setCandidates((current) => [
          ...result.candidates,
          ...current.filter((candidate) => !keys.has(candidateKey(candidate))),
        ])
        setExpandedGroups({})
        setSaved((current) => ({
          ...current,
          ...Object.fromEntries(
            result.candidates
              .filter((candidate) => candidate.savedJobId)
              .map((candidate) => [candidateKey(candidate), candidate.savedJobId as string])
          ),
        }))
        setListing({ ...result.listing, sourceUrl: url })
        setUrlInput("")
        toast.success(
          result.candidates.length === 1
            ? `Found 1 posting on ${result.listing.host}`
            : `Found ${result.candidates.length} postings on ${result.listing.host}`
        )
        return
      }

      const key = candidateKey(result.candidate)
      setCandidates((current) => [
        result.candidate,
        ...current.filter((candidate) => candidateKey(candidate) !== key),
      ])
      setExpandedGroups({})
      if (result.candidate.savedJobId) {
        setSaved((current) => ({ ...current, [key]: result.candidate.savedJobId as string }))
      }
      setUrlInput("")
      toast.success(
        result.extractionMethod === "ats-api"
          ? "Read the full posting from the company's job board"
          : result.extractionMethod === "json-ld"
            ? "Read the posting from the page"
            : "Added — the page had no posting data, so check the details"
      )
    })
  }, [])

  if (queries.length === 0) {
    return (
      <EmptyState
        icon={UserRoundCheck}
        title="No target roles yet"
        description="Discovery searches for the roles you set in your Career Profile. Add at least one active target role to get started."
        action={
          <Link
            href="/career-profile"
            className="text-sm font-medium text-brand-400 underline-offset-4 hover:underline"
          >
            Go to Career Profile
          </Link>
        }
      />
    )
  }

  const handleSearch = () => {
    startSearch(async () => {
      const result = await runDiscovery()
      setHasRun(true)

      if ("error" in result) {
        toast.error(result.error)
        return
      }

      setCandidates(result.candidates)
      setExpandedGroups({})
      setSources(result.sources ?? [])
      setSaved(
        Object.fromEntries(
          result.candidates
            .filter((candidate) => candidate.savedJobId)
            .map((candidate) => [candidateKey(candidate), candidate.savedJobId as string])
        )
      )

      toast.success(
        result.candidates.length === 1
          ? "Found 1 posting"
          : `Found ${result.candidates.length} postings`
      )
    })
  }


  const handleAddByUrl = () => {
    const url = urlInput.trim()
    if (!url) return
    runAddByUrl(url)
  }

  // One-click pipeline: save every unsaved posting currently visible.
  // Sequential so toasts stay accurate and the board never gets a half-run
  // the user cannot see; each save reuses the same `saveDiscoveredJob` path.
  const handleSaveAllVisible = () => {
    const unsaved = visible.filter((c) => !saved[candidateKey(c)])
    if (unsaved.length === 0) return
    setIsSavingAll(true)
    void (async () => {
      let done = 0
      for (const candidate of unsaved.slice(0, 25)) {
        const result = await saveDiscoveredJob({
          provider: candidate.provider,
          externalId: candidate.externalId,
          title: candidate.title,
          companyName: candidate.companyName,
          url: candidate.url,
          location: candidate.location,
          workType: candidate.workType,
          salaryText: candidate.salaryText,
          description: candidate.description,
          postedAt: candidate.postedAt,
        })
        if (!("error" in result)) {
          done += 1
          setSaved((current) => ({ ...current, [candidateKey(candidate)]: result.id }))
        }
      }
      setIsSavingAll(false)
      toast.success(done === 1 ? "Saved 1 posting" : `Saved ${done} postings`)
    })()
  }

  // Ruled-out postings stay in the result and out of the way: the verdict is a
  // heuristic, so the user must always be able to see what it hid.
  const ruledOutCount = candidates.filter(
    (candidate) => candidate.qualification.verdict === "BLOCKED"
  ).length
  const shortlist = showRuledOut
    ? candidates
    : candidates.filter((candidate) => candidate.qualification.verdict !== "BLOCKED")

  // Postings that stated they only hire somewhere else. Same rule as ruled-out:
  // they are filtered out of the way, never out of the result.
  const restrictedCount = shortlist.filter(
    (candidate) => candidate.qualification.marketFit.fit === "RESTRICTED"
  ).length
  const inMarket =
    hideRestricted && restrictedCount > 0
      ? shortlist.filter((candidate) => candidate.qualification.marketFit.fit !== "RESTRICTED")
      : shortlist

  // Freshness is a view choice, applied last so the counts above are unaffected.
  const fresh =
    postedWithin === "any"
      ? inMarket
      : inMarket.filter((candidate) => isPostedWithin(candidate.postedAt, postedWithin))
  const savedCount = fresh.filter((c) => saved[candidateKey(c)]).length
  const visible = hideSaved
    ? fresh.filter((candidate) => !saved[candidateKey(candidate)])
    : fresh
  // Some sources never publish a date (BambooHR/Freshteam list mode). A window
  // hides them, so say how many rather than let them disappear silently.
  const undatedHiddenCount =
    postedWithin === "any" ? 0 : inMarket.filter((candidate) => !candidate.postedAt).length

  // Grouping is the last step, after every filter, so a variant that a filter
  // removed is never folded back in and the counts above are unaffected.
  const groups = groupCandidatesByRole(visible)
  // How much the fold actually hid, counted over the rows on screen. The
  // posting count in the title is over every candidate, so the two never mix.
  const foldedVariantCount = groups.reduce((total, group) => total + group.variants.length, 0)
  const foldedGroupCount = groups.filter((group) => group.variants.length > 0).length

  return (
    <div className="space-y-6">
      {editingWatchlist && (
        <WatchlistDialog
          watchlist={atsWatchlist}
          onClose={() => setEditingWatchlist(false)}
        />
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle>Searches from your profile</CardTitle>
              <CardDescription>
                One search per active target role, in your priority order. Change these
                on your Career Profile.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={() => setEditingWatchlist(true)}
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              Watched companies
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {queries.map((query) => (
                <Badge key={query} variant="brand">
                  {query}
                </Badge>
              ))}
            </div>
            {activeTargetRoleCount > queries.length && (
              <p className="text-xs text-muted-foreground">
                Searching the top {queries.length} of {activeTargetRoleCount} target
                roles by priority —{" "}
                <Link
                  href="/career-profile#target-roles"
                  className="font-medium text-brand-400 underline-offset-4 hover:underline"
                >
                  reorder them in your Career Profile
                </Link>
              </p>
            )}
          </div>
          <Button onClick={handleSearch} loading={isSearching}>
            {isSearching ? null : <Search className="h-4 w-4" aria-hidden="true" />}
            {isSearching ? "Searching…" : "Search"}
          </Button>

          <div className="space-y-2 border-t border-border pt-4">
            <label htmlFor="add-by-url" className="text-sm font-medium">
              Have a link already?
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="add-by-url"
                type="url"
                inputMode="url"
                placeholder="https://company.com/careers/engineer"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleAddByUrl()
                }}
                disabled={isAdding}
              />
              <Button
                variant="secondary"
                className="shrink-0"
                onClick={handleAddByUrl}
                loading={isAdding}
                disabled={!urlInput.trim()}
              >
                {isAdding ? null : <LinkIcon className="h-4 w-4" aria-hidden="true" />}
                {isAdding ? "Reading…" : "Add by URL"}
              </Button>
            </div>
            {addError && (
              <p className="text-sm text-destructive" role="alert">
                {addError} If the page blocks automated access, use the browser
                extension to clip it.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {hasRun && candidates.length === 0 && (
        <EmptyState
          icon={Telescope}
          title="No postings came back"
          description="The sources had nothing for these roles right now. Try again later, or adjust your target roles."
        />
      )}

      {candidates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {candidates.length === 1 ? "1 posting" : `${candidates.length} postings`}
            </CardTitle>
            <CardDescription>
              Ranked against your Career Profile, best first
              {marketCountry && MARKET_COUNTRY_LABEL[marketCountry]
                ? ` · ${MARKET_COUNTRY_LABEL[marketCountry]}`
                : ""}
              . Saving a posting tracks it as Interested. Nothing is ever applied
              to for you.{" "}
              <button
                type="button"
                onClick={() => setShowOrderHelp((current) => !current)}
                aria-expanded={showOrderHelp}
                aria-controls="discovery-order-help"
                className="inline-flex items-center gap-1 font-medium text-brand-400 underline-offset-4 hover:underline"
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                How this is ordered
              </button>
            </CardDescription>
            {showOrderHelp && (
              <p id="discovery-order-help" className="text-xs text-muted-foreground">
                Fit first, then where the role is open (Philippines, APAC,
                worldwide, then elsewhere), then how much evidence the posting is
                current and actionable. A Strong fit with low confidence sorts
                with Worth-a-look.
              </p>
            )}
            <SourceSummary sources={sources} />
          </CardHeader>
          <CardContent className="space-y-3">
            {listing && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <p className="min-w-0 flex-1 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {listing.fetched === 1
                      ? `1 posting from ${listing.host}`
                      : `${listing.fetched} postings from ${listing.host}`}
                  </span>
                  {listing.remaining.length > 0 &&
                    ` · ${listing.remaining.length} more ${
                      listing.remaining.length === 1 ? "link" : "links"
                    } not fetched`}
                  {/* Links that were tried and answered with nothing — a 403, a
                      dead posting, or the page running out of the time budget. */}
                  {listing.skipped > 0 && ` · ${listing.skipped} could not be read`}
                </p>
                {listing.remaining.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => runAddByUrl(listing.sourceUrl, listing.fetched)}
                    loading={isAdding}
                  >
                    {isAdding ? "Reading…" : "Fetch more"}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => setListing(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss listing summary"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Posted
                <Select
                  aria-label="Posted within"
                  value={postedWithin}
                  onChange={(event) => setPostedWithin(event.target.value as PostedWithin)}
                  className="h-8 w-auto py-0 text-sm sm:h-8"
                >
                  {POSTED_WITHIN_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
              {restrictedCount > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={hideRestricted}
                    onChange={(event) => setHideRestricted(event.target.checked)}
                    className="h-4 w-4 rounded border-border accent-brand-500"
                  />
                  Hide postings limited to other regions ({restrictedCount})
                </label>
              )}
              {savedCount > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={hideSaved}
                    onChange={(event) => setHideSaved(event.target.checked)}
                    className="h-4 w-4 rounded border-border accent-brand-500"
                  />
                  Hide saved ({savedCount})
                </label>
              )}
              {visible.some((c) => !saved[candidateKey(c)]) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleSaveAllVisible}
                  loading={isSavingAll}
                  disabled={isSavingAll}
                >
                  {isSavingAll ? "Saving…" : `Save all visible (${visible.filter((c) => !saved[candidateKey(c)]).length})`}
                </Button>
              )}
            </div>
            {undatedHiddenCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {undatedHiddenCount} without a posted date hidden
              </p>
            )}
            {foldedVariantCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {foldedVariantCount === 1 ? "1 other location" : `${foldedVariantCount} other locations`}{" "}
                folded under {foldedGroupCount === 1 ? "1 role" : `${foldedGroupCount} roles`}
              </p>
            )}
            {ruledOutCount > 0 && (
              <button
                type="button"
                onClick={() => setShowRuledOut((current) => !current)}
                aria-pressed={showRuledOut}
                className="text-sm font-medium text-brand-400 underline-offset-4 hover:underline"
              >
                {showRuledOut
                  ? `Hide ${ruledOutCount} ruled out`
                  : `Show ${ruledOutCount} ruled out`}
              </button>
            )}
            <ul className="max-h-[min(60vh,520px)] space-y-3 overflow-y-auto overscroll-contain pr-1">
              {groups.map((group) => {
                const key = candidateKey(group.primary)
                const expanded = expandedGroups[key] ?? false

                return (
                  <Fragment key={key}>
                    <CandidateRow
                      candidate={group.primary}
                      savedJobId={saved[key]}
                      isSaving={savingKey === key}
                      sponsorshipUnknown={isSponsorshipUnknown(
                        group.primary,
                        requiresSponsorship
                      )}
                      onSave={handleSave}
                    />
                    {group.variants.length > 0 && (
                      <li className="space-y-3 pl-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedGroups((current) => ({
                              ...current,
                              [key]: !expanded,
                            }))
                          }
                          aria-expanded={expanded}
                          className="inline-flex items-center gap-1 text-left text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        >
                          <span className="min-w-0">{variantSummary(group)}</span>
                          <ChevronDown
                            className={cn(
                              "h-3 w-3 shrink-0 transition-transform",
                              expanded && "rotate-180"
                            )}
                            aria-hidden="true"
                          />
                        </button>
                        {expanded && (
                          <ul className="space-y-3 border-l border-border pl-3">
                            {group.variants.map((variant) => {
                              const variantKey = candidateKey(variant)

                              return (
                                <CandidateRow
                                  key={variantKey}
                                  candidate={variant}
                                  savedJobId={saved[variantKey]}
                                  isSaving={savingKey === variantKey}
                                  sponsorshipUnknown={isSponsorshipUnknown(
                                    variant,
                                    requiresSponsorship
                                  )}
                                  onSave={handleSave}
                                />
                              )
                            })}
                          </ul>
                        )}
                      </li>
                    )}
                  </Fragment>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
